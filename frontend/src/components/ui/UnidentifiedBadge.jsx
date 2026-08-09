// Shown next to a placeholder patient created by Emergency Triage, so clinicians know
// the real identity still has to be registered. Shared across the patients list,
// patient detail, and triage detail so the marker looks the same everywhere.
const UnidentifiedBadge = () => (
  <span style={{
    fontSize: 'var(--font-size-xs)', padding: '2px 8px',
    borderRadius: 'var(--radius-full)',
    background: 'var(--color-danger-muted)', color: 'var(--color-danger)',
    border: '1px solid var(--color-danger)', fontWeight: 600, whiteSpace: 'nowrap',
    flexShrink: 0,
  }}>⚠ Unidentified</span>
);

export default UnidentifiedBadge;
