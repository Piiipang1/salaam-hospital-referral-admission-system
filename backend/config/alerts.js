// ── Alert channel configuration ──────────────────────────────────────────────
// Read once at startup. A channel is "configured" only when every credential it
// needs is present, so a half-filled .env disables the channel cleanly instead
// of failing on the first real alert.

const bool = (v, fallback = false) =>
  v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());

const emailConfigured = !!(
  process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.ALERT_EMAIL_FROM
);

const smsConfigured = !!(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_FROM_NUMBER
);

const config = {
  // Master switch. Off → nothing leaves the building; in-app notifications are
  // unaffected, and every skip is still recorded so the gap is visible.
  enabled: bool(process.env.ALERTS_ENABLED, false),

  // Renders and records the message without contacting the provider. The way
  // to exercise routing end-to-end without spending an SMS.
  dryRun: bool(process.env.ALERTS_DRY_RUN, false),

  email: {
    configured: emailConfigured,
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: bool(process.env.SMTP_SECURE, false),
    user:   process.env.SMTP_USER,
    pass:   process.env.SMTP_PASS,
    from:   process.env.ALERT_EMAIL_FROM,
  },

  sms: {
    configured: smsConfigured,
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken:  process.env.TWILIO_AUTH_TOKEN,
    from:       process.env.TWILIO_FROM_NUMBER,
  },

  // Default country code for local mobile numbers held as 09XXXXXXXXX.
  // Twilio requires E.164, and every number in this database is Philippine.
  defaultCountryCode: process.env.ALERT_DEFAULT_COUNTRY_CODE || '+63',

  // Prefixed to every outbound message so a recipient knows the source.
  hospitalName: process.env.HOSPITAL_NAME || 'Salaam Hospital',
};

// Which channels each priority uses. Normal stays in-app: an alert that fires
// for everything is an alert nobody reads.
const PRIORITY_CHANNELS = {
  Normal:    [],
  High:      ['email'],
  Emergency: ['email', 'sms'],
};

module.exports = { config, PRIORITY_CHANNELS };
