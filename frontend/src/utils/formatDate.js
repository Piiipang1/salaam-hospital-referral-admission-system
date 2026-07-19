/**
 * Format an ISO datetime string for display
 * @param {string} dateStr  — ISO date or datetime string
 * @param {boolean} includeTime — whether to show hours:minutes
 */
export const formatDate = (dateStr, includeTime = false) => {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date)) return '—';
  const opts = { year: 'numeric', month: 'short', day: 'numeric' };
  if (includeTime) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
  }
  return date.toLocaleDateString('en-PH', opts);
};

/** Format datetime string to relative time (e.g. "2 hours ago") */
export const timeAgo = (dateStr) => {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'just now'; // future timestamp / clock skew
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins} min${mins > 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
};

/** Format a date for an HTML date input (YYYY-MM-DD) */
export const toInputDate = (dateStr) => {
  if (!dateStr) return '';
  // Already a plain date string (the backend now returns DATE columns this way):
  // use it verbatim — never round-trip through Date/toISOString, which UTC-shifts
  // the day in UTC+ timezones.
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10);
  // Fallback for datetime values: build from LOCAL components, not toISOString.
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Today's date in YYYY-MM-DD (local time) — for pre-filling date filters. */
export const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Format age from date of birth as a human-readable string.
 * Returns: '—' | 'Invalid DOB' | '23' (years) | '3 mos' | '12 days' | 'Newborn'
 */
export const calcAge = (dob) => {
  if (!dob) return '—';
  const birth = new Date(dob);
  if (isNaN(birth)) return '—';
  const now = new Date();
  if (birth > now) return 'Invalid DOB';

  const y = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth()    - birth.getMonth();
  const d = now.getDate()     - birth.getDate();

  const years = y - (m < 0 || (m === 0 && d < 0) ? 1 : 0);
  if (years >= 1) return String(years);

  const months = y * 12 + m - (d < 0 ? 1 : 0);
  if (months >= 1) return `${months} mos`;

  const days = Math.floor((now - birth) / 86400000);
  if (days === 0) return 'Newborn';
  return `${days} day${days !== 1 ? 's' : ''}`;
};
