import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { searchPatients } from '../../api/patients.api';
import { formatPatientAge, formatPatientSex, isUnidentifiedPatient } from '../../utils/patientLabels';
import { formatDate } from '../../utils/formatDate';
import { PATIENT_SEARCH_DEBOUNCE_MS } from '../../utils/constants';

/**
 * PatientTypeahead — searchable patient picker.
 *
 * Replaces the "load every patient into a <select>" pattern: it queries
 * /api/patients/search as the nurse types, so the browser never holds more than
 * a page of results and the list stays usable at any patient count.
 *
 * Accepts a name in any token order ("racman hanan") or a patient ID typed
 * straight from a chart or wristband. Per the project's display policy, IDs are
 * a search key only — they are never rendered back (see utils/patientLabels).
 *
 * Keyboard: ↑/↓ move, Enter selects, Esc closes. The listbox/option roles and
 * aria-activedescendant let a screen reader follow the highlight.
 *
 * @param {number|string} value        — selected patient_id ('' when none)
 * @param {function}      onChange     — (patient|null) => void
 * @param {string}        initialLabel — preselected patient's name, if any
 */
const PatientTypeahead = ({
  value, onChange, initialLabel = '', disabled = false,
  id = 'patient-typeahead', required = false,
  placeholder = 'Search by patient name or ID…',
}) => {
  const [query,     setQuery]     = useState(initialLabel);
  const [results,   setResults]   = useState([]);
  const [open,      setOpen]      = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selected,  setSelected]  = useState(null);
  const [error,     setError]     = useState('');

  const wrapRef  = useRef(null);
  const inputRef = useRef(null);
  // Tracks the in-flight request so a slow early keystroke can never overwrite
  // the results of a later one.
  const abortRef = useRef(null);

  const runSearch = useCallback((q) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    searchPatients(q, 10, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.success) { setResults(res.data); setHighlight(0); setError(''); }
      })
      .catch((err) => {
        // A cancelled keystroke is not a failure — only report real ones.
        if (controller.signal.aborted || err.code === 'ERR_CANCELED') return;
        setResults([]);
        setError('Search failed. Check your connection and try again.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, []);

  // Debounced query — one request per pause, not per keystroke.
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => runSearch(query.trim()), PATIENT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, open, runSearch]);

  // Abort any in-flight request when the component goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Click outside closes the list. If nothing was chosen, the typed text is
  // discarded rather than left looking like a selection.
  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery(selected ? patientName(selected) : (value ? query : ''));
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [selected, value, query]);

  const choose = (p) => {
    setSelected(p);
    setQuery(patientName(p));
    setResults([]);
    setOpen(false);
    setError('');
    onChange?.(p);
  };

  const clear = () => {
    setSelected(null);
    setQuery('');
    setResults([]);
    setError('');
    onChange?.(null);
    inputRef.current?.focus();
    setOpen(true);
  };

  const onKeyDown = (e) => {
    if (!open && ['ArrowDown', 'ArrowUp'].includes(e.key)) { setOpen(true); return; }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      // Only swallow Enter when it is actually picking something, so the key
      // still submits the form once a patient is chosen.
      if (results[highlight]) { e.preventDefault(); choose(results[highlight]); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search
          size={15}
          aria-hidden="true"
          style={{
            position: 'absolute', left: 'var(--space-3)', top: '50%',
            transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none',
          }}
        />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          aria-activedescendant={open && results[highlight] ? `${id}-opt-${results[highlight].patient_id}` : undefined}
          autoComplete="off"
          value={query}
          disabled={disabled}
          required={required && !value}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Typing after a selection invalidates it — the parent must not be
            // left holding an id that no longer matches what is on screen.
            if (selected) { setSelected(null); onChange?.(null); }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          style={{ paddingLeft: 'var(--space-8)', paddingRight: value ? 'var(--space-8)' : undefined, width: '100%' }}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear selected patient"
            title="Clear"
            style={{
              position: 'absolute', right: 'var(--space-2)', top: '50%',
              transform: 'translateY(-50%)', background: 'none', border: 'none',
              cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex',
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          style={{
            position: 'absolute', zIndex: 50, top: 'calc(100% + 4px)', left: 0, right: 0,
            maxHeight: '260px', overflowY: 'auto', margin: 0, padding: 'var(--space-1)',
            listStyle: 'none', background: 'var(--color-surface)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-md, 0 4px 16px rgba(0,0,0,.12))',
          }}
        >
          {loading && (
            <li style={{ padding: 'var(--space-3)', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
              Searching…
            </li>
          )}

          {!loading && error && (
            <li style={{ padding: 'var(--space-3)', color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}>
              {error}
            </li>
          )}

          {!loading && !error && results.length === 0 && (
            <li style={{ padding: 'var(--space-3)', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
              {query.trim()
                ? `No patient matches “${query.trim()}”.`
                : 'Start typing a patient name or ID.'}
            </li>
          )}

          {!loading && !error && results.map((p, i) => {
            const active = i === highlight;
            return (
              <li
                key={p.patient_id}
                id={`${id}-opt-${p.patient_id}`}
                role="option"
                aria-selected={active}
                // onMouseDown, not onClick: mousedown fires before the input's
                // blur, so the click is never lost to the outside-click handler.
                onMouseDown={(e) => { e.preventDefault(); choose(p); }}
                onMouseEnter={() => setHighlight(i)}
                style={{
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  background: active ? 'var(--color-surface-2)' : 'transparent',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>{patientName(p)}</span>
                  {isUnidentifiedPatient(p) && (
                    <span style={{
                      fontSize: 'var(--font-size-xs)', fontWeight: 600,
                      padding: '1px var(--space-2)', borderRadius: 'var(--radius-full)',
                      background: 'var(--color-warning-muted)', color: 'var(--color-warning)',
                    }}>
                      Unidentified
                    </span>
                  )}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                  {formatPatientSex(p)} · {formatPatientAge(p)}
                  {!isUnidentifiedPatient(p) && p.date_of_birth ? ` · DOB ${formatDate(p.date_of_birth)}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const patientName = (p) => `${p.first_name} ${p.last_name}`;

export default PatientTypeahead;
