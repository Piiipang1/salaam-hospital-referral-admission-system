/** Philippine mobile number — exactly 11 digits starting with 09 (e.g. 09171234567). */
export const PH_MOBILE_REGEX = /^09\d{9}$/;

/** True when `value` is a valid PH mobile number. Empty values are NOT valid — callers decide whether empty is allowed. */
export const isValidPHMobile = (value) => PH_MOBILE_REGEX.test(value);

/** Sanitize live input for a PH mobile field: digits only, capped at 11. */
export const sanitizePHMobileInput = (value) => value.replace(/\D/g, '').slice(0, 11);
