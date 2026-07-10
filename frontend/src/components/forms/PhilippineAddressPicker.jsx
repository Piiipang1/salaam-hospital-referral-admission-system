import { useEffect, useRef, useState } from 'react';

/**
 * PhilippineAddressPicker — cascading Province → City/Municipality → Barangay
 * selector plus a free-text house/street/purok line, with a manual-entry
 * fallback for addresses the PSGC list can't express.
 *
 * Data: bundled PSGC 2Q-2025 JSON under public/psgc/ (fully offline).
 * provinces.json is fetched eagerly on mount (4 KB); cities and barangays are
 * fetched per selection so the 42k-barangay dataset never loads at once.
 *
 * Emits on every user change:
 *   onChange({ parts: {province, city, barangay, street}, composed, error })
 * `composed` is the display string stored in patients.address (minimal
 * approach — no schema change). In manual mode composed = the raw text.
 */

// Module-level cache so switching back and forth never refetches.
const listCache = new Map();
const fetchList = async (path) => {
  if (listCache.has(path)) return listCache.get(path);
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  const data = await res.json();
  listCache.set(path, data);
  return data;
};

const composeAddress = ({ street, barangay, city, province }) =>
  [street.trim(), barangay && `Brgy. ${barangay}`, city, province]
    .filter(Boolean)
    .join(', ');

const PhilippineAddressPicker = ({ value, onChange, required = false, disabled = false }) => {
  // A non-empty plain-string value is a legacy free-text address (all
  // pre-existing patients) — start in manual mode pre-filled so editing an
  // old record never loses data.
  const legacyString = typeof value === 'string' && value.trim() ? value : '';
  const parts = (value && typeof value === 'object') ? value : null;

  const [manual, setManual]         = useState(!!legacyString);
  const [manualText, setManualText] = useState(legacyString);

  const [provinces, setProvinces]   = useState([]);
  const [cities, setCities]         = useState([]);
  const [barangays, setBarangays]   = useState([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingBrgys, setLoadingBrgys]   = useState(false);
  const [loadError, setLoadError]   = useState('');

  const [provCode, setProvCode]     = useState('');
  const [cityCode, setCityCode]     = useState('');
  const [brgyCode, setBrgyCode]     = useState('');
  const [street, setStreet]         = useState(parts?.street ?? '');

  // Structured initial value (unused by PatientForm today, supported per API):
  // match names against each list as it loads.
  const pendingRef = useRef(parts ? { ...parts } : null);

  // ── Eager province load ────────────────────────────────────────────────────
  useEffect(() => {
    fetchList('/psgc/provinces.json')
      .then((list) => {
        setProvinces(list);
        const want = pendingRef.current?.province;
        if (want) {
          const hit = list.find((p) => p.name === want);
          if (hit) setProvCode(hit.code);
        }
      })
      .catch(() => setLoadError('Address data failed to load — use manual entry.'));
  }, []);

  // ── Cities load on province change ────────────────────────────────────────
  useEffect(() => {
    setCities([]);
    if (!provCode) return undefined;
    let stale = false;
    setLoadingCities(true);
    fetchList(`/psgc/cities/${provCode}.json`)
      .then((list) => {
        if (stale) return;
        setCities(list);
        const want = pendingRef.current?.city;
        if (want) {
          const hit = list.find((c) => c.name === want);
          if (hit) setCityCode(hit.code);
          pendingRef.current.city = null;
        }
      })
      .catch(() => !stale && setLoadError('Address data failed to load — use manual entry.'))
      .finally(() => !stale && setLoadingCities(false));
    return () => { stale = true; };
  }, [provCode]);

  // ── Barangays load on city change ─────────────────────────────────────────
  useEffect(() => {
    setBarangays([]);
    if (!cityCode) return undefined;
    let stale = false;
    setLoadingBrgys(true);
    fetchList(`/psgc/barangays/${cityCode}.json`)
      .then((list) => {
        if (stale) return;
        setBarangays(list);
        const want = pendingRef.current?.barangay;
        if (want) {
          const hit = list.find((b) => b.name === want);
          if (hit) setBrgyCode(hit.code);
          pendingRef.current.barangay = null;
        }
      })
      .catch(() => !stale && setLoadError('Address data failed to load — use manual entry.'))
      .finally(() => !stale && setLoadingBrgys(false));
    return () => { stale = true; };
  }, [cityCode]);

  // ── Emit helper — only ever called from user-driven handlers, so an
  // untouched picker never overwrites the parent's existing value. ───────────
  const nameOf = (list, code) => list.find((x) => x.code === code)?.name ?? '';

  const emit = (next) => {
    const s = {
      manual:   next.manual   ?? manual,
      text:     next.text     ?? manualText,
      provCode: next.provCode ?? provCode,
      cityCode: next.cityCode ?? cityCode,
      brgyCode: next.brgyCode ?? brgyCode,
      street:   next.street   ?? street,
      cities:   next.cities   ?? cities,
      barangays: next.barangays ?? barangays,
    };
    if (s.manual) {
      onChange?.({
        parts: { province: '', city: '', barangay: '', street: '' },
        composed: s.text,
        error: required && !s.text.trim() ? 'Address is required.' : '',
      });
      return;
    }
    const partsOut = {
      province: nameOf(provinces, s.provCode),
      city:     nameOf(s.cities, s.cityCode),
      barangay: nameOf(s.barangays, s.brgyCode),
      street:   s.street,
    };
    const anyPicked = !!(s.provCode || s.cityCode || s.brgyCode);
    // Self-consistency: once any dropdown is used, all levels are required
    // (a city with zero barangays — the PSGC has one — waives the barangay).
    const incomplete = anyPicked
      && (!s.provCode || !s.cityCode || (!s.brgyCode && s.barangays.length > 0));
    let error = '';
    if (incomplete) error = 'Select province, city/municipality, and barangay to complete the address.';
    else if (required && !anyPicked) error = 'Address is required.';
    onChange?.({ parts: partsOut, composed: incomplete ? '' : composeAddress(partsOut), error });
  };

  // ── Handlers ───────────────────────────────────────────────────────────────
  const pickProvince = (e) => {
    const v = e.target.value;
    setProvCode(v); setCityCode(''); setBrgyCode('');
    emit({ provCode: v, cityCode: '', brgyCode: '', cities: [], barangays: [] });
  };
  const pickCity = (e) => {
    const v = e.target.value;
    setCityCode(v); setBrgyCode('');
    emit({ cityCode: v, brgyCode: '', barangays: [] });
  };
  const pickBarangay = (e) => { setBrgyCode(e.target.value); emit({ brgyCode: e.target.value }); };
  const editStreet   = (e) => { setStreet(e.target.value);   emit({ street: e.target.value }); };
  const editManual   = (e) => { setManualText(e.target.value); emit({ text: e.target.value }); };
  const toggleManual = (e) => {
    const on = e.target.checked;
    setManual(on);
    if (on && !manualText) {
      // Carry whatever was picked so far into the textarea as a starting point
      const carried = composeAddress({
        street,
        barangay: nameOf(barangays, brgyCode),
        city:     nameOf(cities, cityCode),
        province: nameOf(provinces, provCode),
      });
      setManualText(carried);
      emit({ manual: true, text: carried });
    } else {
      emit({ manual: on });
    }
  };

  const selectStyle = { width: '100%' };

  return (
    <div className="ph-address-picker">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <label style={{ marginBottom: 0 }}>Address{required ? ' *' : ''}</label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', cursor: 'pointer', marginBottom: 0 }}>
          <input type="checkbox" checked={manual} onChange={toggleManual} disabled={disabled} />
          Enter address manually
        </label>
      </div>

      {loadError && !manual && (
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)', margin: 'var(--space-1) 0' }}>{loadError}</p>
      )}

      {/* Legacy free-text address stays visible while re-picking structurally */}
      {legacyString && !manual && (
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', margin: 'var(--space-1) 0' }}>
          Current address on file: {legacyString}
        </p>
      )}

      {manual ? (
        <textarea
          id="pap-manual"
          value={manualText}
          onChange={editManual}
          placeholder="Full address"
          rows={2}
          disabled={disabled}
          style={{ marginTop: 'var(--space-2)' }}
        />
      ) : (
        <>
          <div className="form-row" style={{ marginTop: 'var(--space-2)' }}>
            <div className="form-group">
              <label htmlFor="pap-province" style={{ fontSize: 'var(--font-size-xs)' }}>Province</label>
              <select id="pap-province" value={provCode} onChange={pickProvince} disabled={disabled || provinces.length === 0} style={selectStyle}>
                <option value="">— Select province —</option>
                {provinces.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="pap-city" style={{ fontSize: 'var(--font-size-xs)' }}>City / Municipality</label>
              <select id="pap-city" value={cityCode} onChange={pickCity} disabled={disabled || !provCode || loadingCities} style={selectStyle}>
                <option value="">{loadingCities ? 'Loading…' : '— Select city/municipality —'}</option>
                {cities.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="pap-barangay" style={{ fontSize: 'var(--font-size-xs)' }}>Barangay</label>
              <select id="pap-barangay" value={brgyCode} onChange={pickBarangay} disabled={disabled || !cityCode || loadingBrgys} style={selectStyle}>
                <option value="">{loadingBrgys ? 'Loading…' : '— Select barangay —'}</option>
                {barangays.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 'var(--space-2)' }}>
            <label htmlFor="pap-street" style={{ fontSize: 'var(--font-size-xs)' }}>House No. / Street / Purok</label>
            <input id="pap-street" value={street} onChange={editStreet} placeholder="e.g. 123 Purok 2, Mahogany St." disabled={disabled} />
          </div>
        </>
      )}
    </div>
  );
};

export default PhilippineAddressPicker;
