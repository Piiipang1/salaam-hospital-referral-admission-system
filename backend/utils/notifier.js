const db = require('../config/db');
const { config, PRIORITY_CHANNELS } = require('../config/alerts');

// ── Multi-channel alert delivery ─────────────────────────────────────────────
// In-app notifications only reach someone already looking at the screen. This
// module mirrors High and Emergency alerts out to email and SMS.
//
// NON-NEGOTIABLE: nothing here may break a clinical write. Every send is
// wrapped, every failure is recorded rather than thrown, and callers are
// expected to fire this AFTER responding to the request. A texting outage must
// never stop a nurse recording a triage.
//
// Every attempt — including the ones not made — lands in
// notification_deliveries, so "no address on file" and "the provider rejected
// it" are distinguishable after the fact instead of both looking like silence.

// Providers are required lazily so the app still boots with the packages absent
// or the channel unconfigured.
let transporter = null;
let twilioClient = null;

const getTransporter = () => {
  if (transporter || !config.email.configured) return transporter;
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    ...(config.email.user ? { auth: { user: config.email.user, pass: config.email.pass } } : {}),
  });
  return transporter;
};

const getTwilio = () => {
  if (twilioClient || !config.sms.configured) return twilioClient;
  const twilio = require('twilio');
  twilioClient = twilio(config.sms.accountSid, config.sms.authToken);
  return twilioClient;
};

/**
 * Local mobile → E.164, which is what Twilio requires.
 * '09171234567' → '+639171234567'. Already-E.164 numbers pass through.
 * Returns null when the value cannot be made into a sendable number, so the
 * caller records a Skip rather than handing the provider something malformed.
 */
const toE164 = (raw) => {
  if (!raw) return null;
  const trimmed = String(raw).trim().replace(/[\s()-]/g, '');
  if (/^\+\d{8,15}$/.test(trimmed)) return trimmed;
  if (/^0\d{9,12}$/.test(trimmed)) return config.defaultCountryCode + trimmed.slice(1);
  if (/^\d{8,15}$/.test(trimmed))  return config.defaultCountryCode + trimmed;
  return null;
};

const isEmail = (v) => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());

// Delivery audit. Never throws: a logging failure must not escalate into a
// failed alert, so it degrades to a console warning.
const recordDelivery = async (row) => {
  try {
    await db.query(
      `INSERT INTO notification_deliveries
         (notification_id, user_id, channel, destination, status, provider_ref, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.notificationId ?? null, row.userId ?? null, row.channel,
       row.destination ?? null, row.status, row.providerRef ?? null,
       row.detail ? String(row.detail).slice(0, 255) : null]
    );
  } catch (err) {
    console.warn('notifier: could not record delivery:', err.message);
  }
};

// ── Channel senders ──────────────────────────────────────────────────────────
// Each returns { status, providerRef?, detail? } and never throws.

const sendEmail = async ({ to, subject, text }) => {
  if (!config.email.configured) return { status: 'Skipped', detail: 'Email channel not configured' };
  if (!isEmail(to))             return { status: 'Skipped', detail: 'No valid email address on file' };
  if (config.dryRun)            return { status: 'Skipped', detail: 'Dry run — email not sent' };

  try {
    const info = await getTransporter().sendMail({
      from: config.email.from, to, subject, text,
    });
    return { status: 'Sent', providerRef: info?.messageId };
  } catch (err) {
    return { status: 'Failed', detail: err.message };
  }
};

const sendSms = async ({ to, body }) => {
  if (!config.sms.configured) return { status: 'Skipped', detail: 'SMS channel not configured' };
  const number = toE164(to);
  if (!number)                return { status: 'Skipped', detail: 'No valid phone number on file' };
  // Report the E.164 form back so the audit records the number the provider was
  // actually given, not the local form it was stored as.
  if (config.dryRun)          return { status: 'Skipped', detail: 'Dry run — SMS not sent', destination: number };

  try {
    // SMS is charged per segment, so a long clinical note would silently cost
    // several messages. One segment, with the detail available in-app.
    const msg = await getTwilio().messages.create({
      from: config.sms.from, to: number, body: body.slice(0, 320),
    });
    return { status: 'Sent', providerRef: msg?.sid, destination: number };
  } catch (err) {
    return { status: 'Failed', detail: err.message, destination: number };
  }
};

/**
 * Fan a single alert out to its recipients on the channels its priority calls for.
 *
 * @param {object}   alert
 * @param {string}   alert.message      — body text (also the in-app message)
 * @param {string}   alert.priority     — 'Normal' | 'High' | 'Emergency'
 * @param {string}  [alert.subject]     — email subject; defaults from priority
 * @param {Array}    alert.recipients   — [{ user_id, email, phone, alerts_opt_out }]
 * @param {Map}     [alert.notificationIds] — user_id → notification_id, to tie
 *                                       each delivery row to its in-app record
 * @returns {Promise<{attempted:number, sent:number, failed:number, skipped:number}>}
 */
const dispatchAlert = async ({ message, priority = 'Normal', subject, recipients = [], notificationIds }) => {
  const channels = PRIORITY_CHANNELS[priority] ?? [];
  const summary = { attempted: 0, sent: 0, failed: 0, skipped: 0 };
  if (channels.length === 0 || recipients.length === 0) return summary;

  const emailSubject = subject
    || `[${config.hospitalName}] ${priority === 'Emergency' ? 'EMERGENCY' : 'High priority'} alert`;
  const body = `[${config.hospitalName}] ${message}`;

  for (const r of recipients) {
    for (const channel of channels) {
      summary.attempted += 1;
      const notificationId = notificationIds?.get?.(r.user_id) ?? null;

      // Master switch and opt-out are recorded as Skips, not silence — the
      // point of the audit table is that a non-delivery is always explained.
      let result;
      if (!config.enabled) {
        result = { status: 'Skipped', detail: 'Alert dispatch disabled (ALERTS_ENABLED)' };
      } else if (r.alerts_opt_out) {
        result = { status: 'Skipped', detail: 'Recipient opted out of out-of-band alerts' };
      } else if (channel === 'email') {
        result = await sendEmail({ to: r.email, subject: emailSubject, text: body });
      } else {
        result = await sendSms({ to: r.phone, body });
      }

      summary[result.status.toLowerCase()] += 1;
      await recordDelivery({
        notificationId,
        userId: r.user_id,
        channel,
        // Prefer what the sender actually used (e.g. the E.164 number) and fall
        // back to the stored value when it never got that far.
        destination: result.destination ?? (channel === 'email' ? r.email : r.phone),
        status: result.status,
        providerRef: result.providerRef,
        detail: result.detail,
      });
    }
  }

  return summary;
};

// Startup banner: a channel that is silently off is the failure mode worth
// spending three log lines on.
const logAlertConfig = () => {
  if (!config.enabled) {
    console.log('  Alerts  : disabled (set ALERTS_ENABLED=true to send email/SMS)');
    return;
  }
  const bits = [
    `email ${config.email.configured ? 'ready' : 'NOT configured'}`,
    `sms ${config.sms.configured ? 'ready' : 'NOT configured'}`,
  ];
  console.log(`  Alerts  : enabled — ${bits.join(', ')}${config.dryRun ? ' (DRY RUN)' : ''}`);
};

module.exports = { dispatchAlert, sendEmail, sendSms, toE164, isEmail, logAlertConfig };
