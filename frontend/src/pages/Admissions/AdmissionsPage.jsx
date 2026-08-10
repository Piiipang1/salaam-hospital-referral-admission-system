import { useEffect, useState, useCallback } from 'react';
import { getAllAdmissions, createAdmission, assignRoom, dischargePatient, confirmDischarge, cancelDischarge } from '../../api/admissions.api';
import { getAllRooms } from '../../api/rooms.api';
import { createExternalReferral } from '../../api/referrals.api';
import { useAuth } from '../../context/AuthContext';
import { useCapacity } from '../../context/CapacityContext';
import { canAssignRoom, canUserAdmit, canCreateExternalReferral } from '../../utils/roleGuard';
import { formatDate } from '../../utils/formatDate';
import { NO_ROOMS_MESSAGE, CLEARANCE_ITEMS } from '../../utils/constants';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import Spinner from '../../components/ui/Spinner';
import CapacityBanner from '../../components/ui/CapacityBanner';
import AdmissionForm from '../../components/forms/AdmissionForm';
import ExternalReferralForm from '../../components/forms/ExternalReferralForm';
import DischargeClearanceChecklist from '../../components/forms/DischargeClearanceChecklist';
import OpdFollowupFields from '../../components/forms/OpdFollowupFields';

// Ongoing (non-discharged) admission statuses — the doctor "Current" tab.
const CURRENT_STATUSES = ['Pending Room', 'Active', 'Pending Discharge'];

// The list query returns the cleared items as a GROUP_CONCAT string; a row is
// dischargeable only once every required item appears in it. The backend
// re-checks this inside the discharge transaction — this is purely so the
// button can be disabled before the user clicks it.
const clearedItemsOf = (row) =>
  (row?.cleared_items ? String(row.cleared_items).split(',') : []);

const isFullyCleared = (row) => {
  const cleared = clearedItemsOf(row);
  return CLEARANCE_ITEMS.every((item) => cleared.includes(item));
};

const LIMIT = 20; // rows per page — matches the backend default

// Inline pill-style pagination button (matches Patients / Referrals pages)
const PillBtn = ({ onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      display: 'inline-flex', alignItems: 'center',
      padding: 'var(--space-2) var(--space-5)',
      borderRadius: 'var(--radius-full)',
      border: '1px solid var(--color-border)',
      background: 'transparent',
      color: disabled ? 'var(--color-text-disabled)' : 'var(--color-text-muted)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: 'var(--font-size-sm)', fontWeight: 500,
      opacity: disabled ? 0.4 : 1, transition: 'all 0.15s',
    }}
  >
    {children}
  </button>
);

const AdmissionsPage = () => {
  const { user } = useAuth();
  // No free bed → new admissions are closed. Room assignment and both discharge
  // steps stay enabled: they are how beds get freed again.
  const { atCapacity, refreshCapacity } = useCapacity();
  const isDoctor = user?.role === 'doctor';
  const isNurse  = user?.role === 'nurse';
  const [tab,      setTab]      = useState('Current');    // doctor "My Patients" tab
  const [nurseTab, setNurseTab] = useState('Admissions'); // nurse view tab
  const [data,    setData]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [modal,   setModal]   = useState(false);
  const [confirm, setConfirm] = useState(null); // admission row — doctor initiates discharge
  const [dischargeNotes, setDischargeNotes] = useState(''); // optional notes for the initiate-discharge modal
  const [nurseConfirm, setNurseConfirm] = useState(null); // admission row — nurse confirms discharge
  // Pre-discharge clearance: the row whose checklist is open, and the live
  // state the checklist reports back so the modal's own button can react
  // without waiting for a list refresh.
  const [clearanceRow,   setClearanceRow]   = useState(null);
  const [clearanceState, setClearanceState] = useState(null);
  // OPD follow-up captured in the discharge dialog. Required — the API refuses
  // the discharge without a date, so the Confirm button waits on `valid`.
  const [followup, setFollowup] = useState({ valid: false });
  const [saving,  setSaving]  = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate,   setToDate]   = useState('');

  // External-referral modal. `referOut` is null when closed, or the admission
  // row being diverted — `{}` opens it with a searchable patient picker.
  const [referOut, setReferOut] = useState(null);

  // Assign-room modal: which admission row is being assigned, the available
  // rooms to choose from, and the currently selected room_id
  const [assignRow,   setAssignRow]   = useState(null);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [roomsLoading, setRoomsLoading] = useState(false);

  // The active view maps to a server-side status filter, so pagination + total
  // are correct per view (the server returns exactly the rows the tab shows).
  //   doctor      → Current: the three ongoing statuses · History: Discharged
  //   nurse → Admissions: all · Discharge History: Discharged
  const statusParam = isDoctor
    ? (tab === 'Current' ? CURRENT_STATUSES.join(',') : 'Discharged')
    : (nurseTab === 'Discharge History' ? 'Discharged' : '');

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  // Reset to page 1 whenever the effective view or date range changes
  useEffect(() => { setPage(1); }, [statusParam, fromDate, toDate]);

  const load = useCallback(() => {
    setLoading(true);
    const params = { page, limit: LIMIT };
    if (statusParam) params.status    = statusParam;
    if (fromDate)    params.from_date = fromDate;
    if (toDate)      params.to_date   = toDate;
    getAllAdmissions(params)
      .then((r) => { if (r.success) { setData(r.data); setTotal(r.total ?? r.data.length); } })
      .catch(() => setError('Failed to load admissions.'))
      .finally(() => setLoading(false));
  }, [page, statusParam, fromDate, toDate]);
  useEffect(() => { load(); }, [load]);

  // Auto-dismiss success alerts so a stale one can't linger above a later message
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 4000);
    return () => clearTimeout(t);
  }, [success]);

  const handleAdmit = async (form) => {
    setError(''); setSuccess('');
    setSaving(true);
    try { await createAdmission(form); setSuccess('Patient admitted.'); setModal(false); load(); }
    catch (err) { setError(err.response?.data?.message || 'Admission failed.'); }
    finally { setSaving(false); }
  };

  // Refer a patient out to another facility. Does NOT touch the admission row:
  // the patient may still be waiting on a bed here until the transfer is
  // confirmed, and a nurse still needs to see them in the queue meanwhile.
  const handleReferOut = async (formData) => {
    setError(''); setSuccess('');
    setSaving(true);
    try {
      const res = await createExternalReferral(formData);
      setSuccess(res.message || 'Patient referred to external hospital.');
      setReferOut(null);
      load();
    } catch (err) { setError(err.response?.data?.message || 'External referral failed.'); }
    finally { setSaving(false); }
  };

  // Doctor opens the initiate-discharge modal (resets the notes field)
  const openInitiateDischarge = (row) => { setConfirm(row); setDischargeNotes(''); };

  // Step 1 — doctor initiates: status becomes Pending Discharge, nurses notified.
  // Optional discharge notes / final assessment are saved for the nurse to see.
  const handleInitiateDischarge = async () => {
    if (!confirm) return;
    setError(''); setSuccess('');
    setSaving(true);
    try { await dischargePatient(confirm.admission_id, dischargeNotes); setSuccess('Discharge initiated — awaiting confirmation.'); setConfirm(null); load(); }
    catch (err) { setError(err.response?.data?.message || 'Discharge failed.'); setConfirm(null); }
    finally { setSaving(false); }
  };

  // Step 2 — nurse confirms: Discharged, discharge_date set, room freed
  const handleConfirmDischarge = async () => {
    if (!nurseConfirm) return;
    setError(''); setSuccess('');
    setSaving(true);
    // Confirming frees a bed — refresh capacity so the banner clears immediately
    // instead of waiting for the next poll.
    try {
      // The follow-up travels with the discharge — the API books it in the same
      // transaction and reports which clinic the patient was routed to.
      const res = await confirmDischarge(nurseConfirm.admission_id, {
        followup_date:  followup.followup_date,
        clinic_id:      followup.clinic_id,
        followup_notes: followup.followup_notes,
      });
      setSuccess(res.message || 'Discharge confirmed. Room is now available.');
      setNurseConfirm(null);
      setFollowup({ valid: false });
      load();
      refreshCapacity();
    }
    // Keep the dialog open on failure: a rejected follow-up date is fixable
    // right there, and closing would throw away what was typed.
    catch (err) { setError(err.response?.data?.message || 'Confirmation failed.'); }
    finally { setSaving(false); }
  };

  const handleCancelDischarge = async (row) => {
    setError(''); setSuccess('');
    setSaving(true);
    try { await cancelDischarge(row.admission_id); setSuccess('Discharge cancelled.'); load(); }
    catch (err) { setError(err.response?.data?.message || 'Cancel failed.'); }
    finally { setSaving(false); }
  };

  const openAssignRoom = (row) => {
    setAssignRow(row);
    setSelectedRoom('');
    setRoomsLoading(true);
    getAllRooms()
      .then((r) => { if (r.success) setAvailableRooms(r.data.filter((rm) => rm.availability_status === 'available')); })
      .catch(() => setError('Failed to load available rooms.'))
      .finally(() => setRoomsLoading(false));
  };

  const handleAssignRoom = async () => {
    if (!assignRow || !selectedRoom) return;
    setError(''); setSuccess('');
    setSaving(true);
    // Assigning claims a bed — this can be the one that takes the hospital to
    // capacity, so refresh rather than waiting for the next poll.
    try { await assignRoom(assignRow.admission_id, selectedRoom); setSuccess('Room assigned.'); setAssignRow(null); load(); refreshCapacity(); }
    catch (err) { setError(err.response?.data?.message || 'Room assignment failed.'); }
    finally { setSaving(false); }
  };

  // Row actions — shared by the default table and the doctor "Current" tab.
  // Initiate Discharge stays exactly as before (Active + own admission).
  const renderRowActions = (r) => (
    <>
      {r.status === 'Pending Room' && canAssignRoom(user?.role) && (
        <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); openAssignRoom(r); }}>Assign Room</Button>
      )}
      {/* Patients stuck awaiting a bed with none free are exactly who gets
          diverted, so the action sits on their row. */}
      {r.status === 'Pending Room' && atCapacity && canCreateExternalReferral(user?.role) && (
        <Button size="sm" variant="secondary"
          title="No beds are free — refer this patient to another hospital"
          onClick={(e) => { e.stopPropagation(); setReferOut(r); }}>
          Refer Out
        </Button>
      )}
      {r.status === 'Active' && user?.role === 'doctor' && user?.linked_id === r.doctor_id && (
        <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); openInitiateDischarge(r); }}>Initiate Discharge</Button>
      )}
      {/* Clearance is where the outstanding items get ticked, so it stays
          available even while Confirm Discharge is disabled. */}
      {r.status === 'Pending Discharge' && isNurse && (
        <Button size="sm" variant="secondary"
          title="Open the pre-discharge clearance checklist"
          onClick={(e) => { e.stopPropagation(); setClearanceRow(r); }}>
          Clearance ({clearedItemsOf(r).length}/{CLEARANCE_ITEMS.length})
        </Button>
      )}
      {r.status === 'Pending Discharge' && isNurse && (
        <Button
          size="sm"
          variant="primary"
          // Hard requirement: no discharge until all three clearances are in.
          // The API refuses it too — this only stops the user wasting a click.
          disabled={!isFullyCleared(r)}
          title={isFullyCleared(r)
            ? 'Finalize the discharge and free the bed'
            : `Blocked — ${CLEARANCE_ITEMS.length - clearedItemsOf(r).length} clearance item(s) outstanding. Open Clearance to complete them.`}
          onClick={(e) => { e.stopPropagation(); setNurseConfirm(r); }}
        >
          Confirm Discharge
        </Button>
      )}
      {r.status === 'Pending Discharge' && user?.role === 'doctor' && user?.linked_id === r.doctor_id && (
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleCancelDischarge(r); }}>Cancel</Button>
      )}
    </>
  );

  // Default table (nurse)
  const columns = [
    { key: 'patient_name',   label: 'Patient', render: (r) => r.patient_name ?? 'Unknown Patient' },
    { key: 'doctor_name',    label: 'Doctor',  hideMobile: true, render: (r) => r.doctor_name  ?? '—' },
    { key: 'room_type',      label: 'Room',    render: (r) => r.room_id ? `${r.room_type} — ${r.bed_number}` : '—' },
    { key: 'admission_type', label: 'Type',    hideMobile: true },
    { key: 'admission_date', label: 'Admitted', hideMobile: true, render: (r) => formatDate(r.admission_date) },
    { key: 'discharge_date', label: 'Discharged', hideMobile: true, render: (r) => formatDate(r.discharge_date) },
    { key: 'status',         label: 'Status',  render: (r) => <Badge status={r.status} /> },
    { key: 'actions', label: '', width: '190px', align: 'right', render: renderRowActions },
  ];

  // Doctor "My Patients" — Current tab: ongoing admissions with room + actions
  const doctorCurrentColumns = [
    { key: 'patient_name',   label: 'Patient', render: (r) => r.patient_name ?? 'Unknown Patient' },
    { key: 'room',           label: 'Room',    render: (r) => r.room_id ? `${r.room_type} — ${r.bed_number}` : (r.status === 'Pending Room' ? 'Awaiting room' : '—') },
    { key: 'admission_type', label: 'Type',    hideMobile: true },
    { key: 'admission_date', label: 'Admitted', hideMobile: true, render: (r) => formatDate(r.admission_date) },
    { key: 'status',         label: 'Status',  render: (r) => <Badge status={r.status} /> },
    { key: 'actions', label: '', width: '190px', align: 'right', render: renderRowActions },
  ];

  // Doctor "My Patients" — History tab: discharged, with admission + discharge dates
  const doctorHistoryColumns = [
    { key: 'patient_name',   label: 'Patient', render: (r) => r.patient_name ?? 'Unknown Patient' },
    { key: 'room_type',      label: 'Room',    render: (r) => r.room_id ? `${r.room_type} — ${r.bed_number}` : '—' },
    { key: 'admission_type', label: 'Type',    hideMobile: true },
    { key: 'admission_date', label: 'Admitted', render: (r) => formatDate(r.admission_date) },
    { key: 'discharge_date', label: 'Discharged', render: (r) => formatDate(r.discharge_date) },
    { key: 'status',         label: 'Status',  render: (r) => <Badge status={r.status} /> },
  ];

  // Nurse "Discharge History" tab — who confirmed each discharge, with the
  // doctor's discharge notes (from the earlier discharge-notes feature).
  const nurseHistoryColumns = [
    { key: 'patient_name',   label: 'Patient', render: (r) => r.patient_name ?? 'Unknown Patient' },
    { key: 'room',           label: 'Room',    render: (r) => r.room_type ? `${r.room_type} — ${r.bed_number}` : '—' },
    { key: 'doctor_name',    label: 'Doctor',  hideMobile: true, render: (r) => r.doctor_name ?? '—' },
    { key: 'discharge_date', label: 'Discharged', render: (r) => formatDate(r.discharge_date) },
    { key: 'discharge_notes', label: "Doctor's Notes", hideMobile: true, render: (r) => (
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', whiteSpace: 'pre-wrap' }}>
          {r.discharge_notes ? (r.discharge_notes.length > 80 ? r.discharge_notes.slice(0, 80) + '…' : r.discharge_notes) : '—'}
        </span>
      ),
    },
    { key: 'confirmed_by', label: 'Confirmed By', render: (r) => r.confirmed_by_name ?? '—' },
  ];

  // `data` is already the current page for the active view — the server applies
  // the role scope, the tab's status filter, and pagination. No client-side
  // splitting (that would only ever see one page's worth of rows).

  const tabButtonStyle = (active) => ({
    padding: 'var(--space-2) var(--space-5)',
    borderRadius: 'var(--radius-full)',
    border: '1px solid',
    cursor: 'pointer',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 600,
    color:       active ? '#fff' : 'var(--color-text-muted)',
    background:  active ? 'var(--color-primary)' : 'transparent',
    borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
  });

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-5)' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">{isDoctor ? 'My Patients' : 'Admissions'}</h1>
          <p className="page-subtitle">
            {isDoctor
              ? `${total} ${tab === 'Current' ? 'current' : 'discharged'} record${total !== 1 ? 's' : ''}`
              : `${total} admission${total !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          {/* Surfaced only at zero availability — the alternative to admitting
              when there is nowhere to put the patient. */}
          {atCapacity && canCreateExternalReferral(user?.role) && (
            <Button id="refer-external-btn" variant="secondary"
              title="Refer a patient to a hospital outside this system"
              onClick={() => setReferOut({})}>
              Refer to External Hospital
            </Button>
          )}
          {canUserAdmit(user) && (
            <Button id="admit-patient-btn" variant="primary"
              disabled={atCapacity}
              title={atCapacity ? NO_ROOMS_MESSAGE : undefined}
              onClick={() => setModal(true)}>+ Admit Patient</Button>
          )}
        </div>
      </div>
      <CapacityBanner />
      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      {/* Date range filter */}
      <div style={{ display:'flex', gap:'var(--space-2)', flexWrap:'wrap', alignItems:'center' }}>
        <div className="filter-date-group">
          <span className="filter-date-label">From</span>
          <input
            id="admission-from-date"
            type="date"
            className="filter-date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="Admission from date"
          />
        </div>
        <div className="filter-date-group">
          <span className="filter-date-label">To</span>
          <input
            id="admission-to-date"
            type="date"
            className="filter-date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="Admission to date"
          />
        </div>
        {(fromDate || toDate) && (
          <button
            className="filter-clear-btn"
            onClick={() => { setFromDate(''); setToDate(''); }}
            title="Clear all filters"
          >
            ✕ Clear
          </button>
        )}
      </div>

      {isDoctor ? (
        <>
          {/* Current / History tabs */}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {['Current', 'History'].map((t) => (
              <button key={t} className="pill-tab" onClick={() => setTab(t)} style={tabButtonStyle(tab === t)}>
                {t}
              </button>
            ))}
          </div>
          <Table
            columns={tab === 'Current' ? doctorCurrentColumns : doctorHistoryColumns}
            data={data}
            loading={loading}
            emptyMessage={tab === 'Current' ? 'No current admissions.' : 'No discharge history.'}
          />
        </>
      ) : (
        <>
          {/* Admissions / Discharge History tabs */}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {['Admissions', 'Discharge History'].map((k) => (
              <button key={k} className="pill-tab" onClick={() => setNurseTab(k)} style={tabButtonStyle(nurseTab === k)}>
                {k}
              </button>
            ))}
          </div>
          <Table
            columns={nurseTab === 'Discharge History' ? nurseHistoryColumns : columns}
            data={data}
            loading={loading}
            emptyMessage={nurseTab === 'Discharge History' ? 'No discharge history yet.' : 'No admission records found.'}
          />
        </>
      )}

      {/* ── Pagination (server-driven, matches Patients / Referrals) ── */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            Page <strong style={{ color: 'var(--color-text)' }}>{page}</strong> of <strong style={{ color: 'var(--color-text)' }}>{totalPages}</strong>
            &nbsp;·&nbsp;{total} total
          </span>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <PillBtn onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>← Previous</PillBtn>
            <PillBtn onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>Next →</PillBtn>
          </div>
        </div>
      )}
      <Modal isOpen={modal} onClose={() => setModal(false)} title="Admit Patient" size="md">
        <AdmissionForm onSubmit={handleAdmit} loading={saving} disabled={atCapacity} />
      </Modal>
      {/* External referral — opened either from a Pending Room row (patient
          fixed) or from the header button (patient picker). */}
      <Modal isOpen={!!referOut} onClose={() => setReferOut(null)} title="Refer to External Hospital" size="md">
        {referOut && (
          <ExternalReferralForm
            patientId={referOut.patient_id}
            patientName={referOut.patient_name}
            onSubmit={handleReferOut}
            loading={saving}
          />
        )}
      </Modal>
      {/* Step 1 — doctor initiates discharge with optional notes */}
      <Modal isOpen={!!confirm} onClose={() => setConfirm(null)} title="Initiate Discharge" size="sm">
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
          Request discharge for <strong>{confirm?.patient_name ?? 'this patient'}</strong>? A nurse must confirm before the room is freed.
        </p>
        <div className="form-group">
          <label htmlFor="discharge-notes">Discharge notes / final assessment (optional)</label>
          <textarea
            id="discharge-notes"
            rows={4}
            value={dischargeNotes}
            onChange={(e) => setDischargeNotes(e.target.value)}
            placeholder="e.g. Stable for discharge. Continue oral antibiotics for 5 days, follow up in 1 week."
          />
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button type="button" variant="danger" onClick={handleInitiateDischarge} loading={saving}>Initiate Discharge</Button>
        </div>
      </Modal>

      {/* Pre-discharge clearance checklist — where the outstanding items get
          ticked. Closing it reloads the list so the row's Confirm Discharge
          button reflects whatever changed. */}
      <Modal
        isOpen={!!clearanceRow}
        onClose={() => { setClearanceRow(null); setClearanceState(null); load(); }}
        title={clearanceRow ? `Discharge Clearance — ${clearanceRow.patient_name ?? 'Patient'}` : ''}
        size="md"
      >
        {clearanceRow && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
              All three clearances must be verified before this patient can be discharged.
            </p>

            <DischargeClearanceChecklist
              admissionId={clearanceRow.admission_id}
              role={user?.role}
              onChange={setClearanceState}
            />

            <div className="form-actions">
              <Button variant="secondary"
                onClick={() => { setClearanceRow(null); setClearanceState(null); load(); }}>
                Close
              </Button>
              {/* Straight from checklist to discharge once it is complete */}
              <Button
                variant="primary"
                disabled={!clearanceState?.complete}
                title={clearanceState?.complete
                  ? 'Finalize the discharge and free the bed'
                  : 'Complete all three clearances first'}
                onClick={() => {
                  const row = clearanceRow;
                  setClearanceRow(null); setClearanceState(null);
                  setNurseConfirm(row);
                }}
              >
                Continue to Discharge
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Step 2 — nurse confirms discharge, sees the doctor's notes, and books
          the OPD follow-up that discharge now requires */}
      <Modal
        isOpen={!!nurseConfirm}
        onClose={() => { setNurseConfirm(null); setFollowup({ valid: false }); }}
        title="Confirm Discharge"
        size="md"
      >
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
          Confirm discharge for <strong>{nurseConfirm?.patient_name ?? 'this patient'}</strong>? This finalizes the discharge and frees {nurseConfirm?.room_id ? `${nurseConfirm.room_type} — ${nurseConfirm.bed_number}` : 'the room'}.
        </p>
        <div className="form-group">
          <span className="info-label">Doctor's discharge notes</span>
          <p style={{
            marginTop: 'var(--space-1)',
            padding: 'var(--space-3)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            whiteSpace: 'pre-wrap',
            color: nurseConfirm?.discharge_notes ? 'var(--color-text)' : 'var(--color-text-muted)',
            fontSize: 'var(--font-size-sm)',
          }}>
            {nurseConfirm?.discharge_notes || 'No notes provided by the doctor.'}
          </p>
        </div>

        {/* Required OPD booking — the discharge is refused without it */}
        {nurseConfirm && (
          <div style={{
            marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--color-border)',
          }}>
            <OpdFollowupFields admissionId={nurseConfirm.admission_id} onChange={setFollowup} />
          </div>
        )}

        {/* Two gates, both mirrored server-side: clearances complete, and a
            follow-up booked. */}
        <div className="form-actions">
          <Button type="button" variant="secondary"
            onClick={() => { setNurseConfirm(null); setFollowup({ valid: false }); }}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirmDischarge}
            loading={saving}
            disabled={!isFullyCleared(nurseConfirm) || !followup.valid}
            title={
              !isFullyCleared(nurseConfirm) ? 'Pre-discharge clearance is incomplete.'
                : !followup.valid ? 'Set a follow-up date before discharging.'
                : undefined
            }
          >
            Confirm Discharge
          </Button>
        </div>
      </Modal>
      <Modal isOpen={!!assignRow} onClose={() => setAssignRow(null)} title="Assign Room" size="sm">
        <div className="form-group">
          <label htmlFor="assign-room-select">
            Available room for {assignRow?.patient_name ?? 'this patient'}
          </label>
          {roomsLoading ? (
            <Spinner />
          ) : (
            <>
              <select id="assign-room-select" value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)} required>
                <option value="">— Select room —</option>
                {availableRooms.map((rm) => (
                  <option key={rm.room_id} value={rm.room_id}>
                    {rm.room_type} — {rm.bed_number}
                  </option>
                ))}
              </select>
              {availableRooms.length === 0 && (
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)' }}>
                  No available rooms. Discharge a patient first.
                </span>
              )}
            </>
          )}
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={() => setAssignRow(null)}>Cancel</Button>
          <Button type="button" variant="primary" onClick={handleAssignRoom} loading={saving} disabled={!selectedRoom}>
            Confirm
          </Button>
        </div>
      </Modal>
    </div>
  );
};

export default AdmissionsPage;
