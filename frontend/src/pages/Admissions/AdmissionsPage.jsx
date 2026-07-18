import { useEffect, useState, useCallback } from 'react';
import { getAllAdmissions, createAdmission, assignRoom, dischargePatient, confirmDischarge, cancelDischarge } from '../../api/admissions.api';
import { getAllRooms } from '../../api/rooms.api';
import { useAuth } from '../../context/AuthContext';
import { canAssignRoom, canUserAdmit } from '../../utils/roleGuard';
import { formatDate } from '../../utils/formatDate';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import Spinner from '../../components/ui/Spinner';
import AdmissionForm from '../../components/forms/AdmissionForm';

// Ongoing (non-discharged) admission statuses — the doctor "Current" tab.
const CURRENT_STATUSES = ['Pending Room', 'Active', 'Pending Discharge'];

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
  const isDoctor = user?.role === 'doctor';
  const isNurse  = user?.role === 'nurse';
  const isStaff  = user?.role === 'staff';
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
  const [saving,  setSaving]  = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate,   setToDate]   = useState('');

  // Assign-room modal: which admission row is being assigned, the available
  // rooms to choose from, and the currently selected room_id
  const [assignRow,   setAssignRow]   = useState(null);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [roomsLoading, setRoomsLoading] = useState(false);

  // The active view maps to a server-side status filter, so pagination + total
  // are correct per view (the server returns exactly the rows the tab shows).
  //   doctor      → Current: the three ongoing statuses · History: Discharged
  //   nurse/staff → Admissions: all · Discharge History: Discharged
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
    try { await confirmDischarge(nurseConfirm.admission_id); setSuccess('Discharge confirmed. Room is now available.'); setNurseConfirm(null); load(); }
    catch (err) { setError(err.response?.data?.message || 'Confirmation failed.'); setNurseConfirm(null); }
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
    try { await assignRoom(assignRow.admission_id, selectedRoom); setSuccess('Room assigned.'); setAssignRow(null); load(); }
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
      {r.status === 'Active' && user?.role === 'doctor' && user?.linked_id === r.doctor_id && (
        <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); openInitiateDischarge(r); }}>Initiate Discharge</Button>
      )}
      {r.status === 'Pending Discharge' && (isNurse || isStaff) && (
        <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setNurseConfirm(r); }}>Confirm Discharge</Button>
      )}
      {r.status === 'Pending Discharge' && user?.role === 'doctor' && user?.linked_id === r.doctor_id && (
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleCancelDischarge(r); }}>Cancel</Button>
      )}
    </>
  );

  // Default table (nurse / staff)
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
        {canUserAdmit(user) && (
          <Button id="admit-patient-btn" variant="primary" onClick={() => setModal(true)}>+ Admit Patient</Button>
        )}
      </div>
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
              <button key={t} onClick={() => setTab(t)} style={tabButtonStyle(tab === t)}>
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
              <button key={k} onClick={() => setNurseTab(k)} style={tabButtonStyle(nurseTab === k)}>
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
        <AdmissionForm onSubmit={handleAdmit} loading={saving} />
      </Modal>
      {/* Step 1 — doctor initiates discharge with optional notes */}
      <Modal isOpen={!!confirm} onClose={() => setConfirm(null)} title="Initiate Discharge" size="sm">
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
          Request discharge for <strong>{confirm?.patient_name ?? 'this patient'}</strong>? A nurse or staff must confirm before the room is freed.
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

      {/* Step 2 — nurse confirms discharge, sees the doctor's notes */}
      <Modal isOpen={!!nurseConfirm} onClose={() => setNurseConfirm(null)} title="Confirm Discharge" size="sm">
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
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={() => setNurseConfirm(null)}>Cancel</Button>
          <Button type="button" variant="primary" onClick={handleConfirmDischarge} loading={saving}>Confirm Discharge</Button>
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
