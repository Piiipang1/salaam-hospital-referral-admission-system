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
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Spinner from '../../components/ui/Spinner';
import AdmissionForm from '../../components/forms/AdmissionForm';

const AdmissionsPage = () => {
  const { user } = useAuth();
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [modal,   setModal]   = useState(false);
  const [confirm, setConfirm] = useState(null); // admission row — doctor initiates discharge
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

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (fromDate) params.from_date = fromDate;
    if (toDate)   params.to_date   = toDate;
    getAllAdmissions(params).then((r) => { if (r.success) setData(r.data); }).catch(() => setError('Failed to load admissions.')).finally(() => setLoading(false));
  }, [fromDate, toDate]);
  useEffect(() => { load(); }, [load]);

  const handleAdmit = async (form) => {
    setSaving(true);
    try { await createAdmission(form); setSuccess('Patient admitted.'); setModal(false); load(); }
    catch (err) { setError(err.response?.data?.message || 'Admission failed.'); }
    finally { setSaving(false); }
  };

  // Step 1 — doctor initiates: status becomes Pending Discharge, nurses notified
  const handleInitiateDischarge = async () => {
    if (!confirm) return;
    setSaving(true);
    try { await dischargePatient(confirm.admission_id); setSuccess('Discharge initiated — awaiting nurse confirmation.'); setConfirm(null); load(); }
    catch (err) { setError(err.response?.data?.message || 'Discharge failed.'); setConfirm(null); }
    finally { setSaving(false); }
  };

  // Step 2 — nurse confirms: Discharged, discharge_date set, room freed
  const handleConfirmDischarge = async () => {
    if (!nurseConfirm) return;
    setSaving(true);
    try { await confirmDischarge(nurseConfirm.admission_id); setSuccess('Discharge confirmed. Room is now available.'); setNurseConfirm(null); load(); }
    catch (err) { setError(err.response?.data?.message || 'Confirmation failed.'); setNurseConfirm(null); }
    finally { setSaving(false); }
  };

  const handleCancelDischarge = async (row) => {
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
    setSaving(true);
    try { await assignRoom(assignRow.admission_id, selectedRoom); setSuccess('Room assigned.'); setAssignRow(null); load(); }
    catch (err) { setError(err.response?.data?.message || 'Room assignment failed.'); }
    finally { setSaving(false); }
  };

  const columns = [
    { key: 'patient_name',   label: 'Patient', render: (r) => r.patient_name ?? 'Unknown Patient' },
    { key: 'doctor_name',    label: 'Doctor',  hideMobile: true, render: (r) => r.doctor_name  ?? '—' },
    { key: 'room_type',      label: 'Room',    render: (r) => r.room_id ? `${r.room_type} — ${r.bed_number}` : '—' },
    { key: 'admission_type', label: 'Type',    hideMobile: true },
    { key: 'admission_date', label: 'Admitted', hideMobile: true, render: (r) => formatDate(r.admission_date) },
    { key: 'discharge_date', label: 'Discharged', hideMobile: true, render: (r) => formatDate(r.discharge_date) },
    { key: 'status',         label: 'Status',  render: (r) => <Badge status={r.status} /> },
    {
      key: 'actions', label: '', width: '190px', align: 'right',
      render: (r) => (
        <>
          {r.status === 'Pending Room' && canAssignRoom(user?.role) && (
            <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); openAssignRoom(r); }}>Assign Room</Button>
          )}
          {r.status === 'Active' && user?.role === 'doctor' && user?.linked_id === r.doctor_id && (
            <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); setConfirm(r); }}>Initiate Discharge</Button>
          )}
          {r.status === 'Pending Discharge' && user?.role === 'nurse' && (
            <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setNurseConfirm(r); }}>Confirm Discharge</Button>
          )}
          {r.status === 'Pending Discharge' && (user?.role === 'admin' || (user?.role === 'doctor' && user?.linked_id === r.doctor_id)) && (
            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleCancelDischarge(r); }}>Cancel</Button>
          )}
        </>
      ),
    },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-5)' }}>
      <div className="page-header">
        <div><h2 className="page-title">Admissions</h2><p className="page-subtitle">{data.filter(d=>d.status==='Active').length} active admission{data.filter(d=>d.status==='Active').length !== 1?'s':''}</p></div>
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

      <Table columns={columns} data={data} loading={loading} emptyMessage="No admission records found." />
      <Modal isOpen={modal} onClose={() => setModal(false)} title="Admit Patient" size="md">
        <AdmissionForm onSubmit={handleAdmit} loading={saving} />
      </Modal>
      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={handleInitiateDischarge}
        title="Initiate Discharge"
        message={`Request discharge for ${confirm?.patient_name ?? 'this patient'}? A nurse must confirm before the room is freed.`}
        confirmLabel="Initiate Discharge"
        loading={saving}
      />
      <ConfirmDialog
        isOpen={!!nurseConfirm}
        onClose={() => setNurseConfirm(null)}
        onConfirm={handleConfirmDischarge}
        title="Confirm Discharge"
        message={`Confirm discharge for ${nurseConfirm?.patient_name ?? 'this patient'}? This finalizes the discharge and frees ${nurseConfirm?.room_id ? `${nurseConfirm.room_type} — ${nurseConfirm.bed_number}` : 'the room'}.`}
        confirmLabel="Confirm Discharge"
        loading={saving}
      />
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
