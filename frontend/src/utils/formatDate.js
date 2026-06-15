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
  return new Date(dateStr).toISOString().split('T')[0];
};

/** Calculate age from date of birth */
export const calcAge = (dob) => {
  if (!dob) return '—';
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 3600000));
};
