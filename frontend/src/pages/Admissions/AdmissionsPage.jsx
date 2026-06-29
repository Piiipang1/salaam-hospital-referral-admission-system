import { useEffect, useState, useCallback } from 'react';
import { getAllAdmissions, createAdmission, dischargePatient } from '../../api/admissions.api';
import { formatDate } from '../../utils/formatDate';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import AdmissionForm from '../../components/forms/AdmissionForm';

const AdmissionsPage = () => {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [modal,   setModal]   = useState(false);
  const [confirm, setConfirm] = useState(null); // admission row
  const [saving,  setSaving]  = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getAllAdmissions().then((r) => { if (r.success) setData(r.data); }).catch(() => setError('Failed to load admissions.')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleAdmit = async (form) => {
    setSaving(true);
    try { await createAdmission(form); setSuccess('Patient admitted.'); setModal(false); load(); }
    catch (err) { setError(err.response?.data?.message || 'Admission failed.'); }
    finally { setSaving(false); }
  };

  const handleDischarge = async () => {
    if (!confirm) return;
    setSaving(true);
    try { await dischargePatient(confirm.admission_id); setSuccess('Patient discharged.'); setConfirm(null); load(); }
    catch (err) { setError(err.response?.data?.message || 'Discharge failed.'); }
    finally { setSaving(false); }
  };

  const columns = [
    { key: 'admission_id',   label: 'ID',      width: '60px' },
    { key: 'patient_name',   label: 'Patient', render: (r) => r.patient_name ?? `Patient #${r.patient_id}` },
    { key: 'doctor_name',    label: 'Doctor',  render: (r) => r.doctor_name  ?? `Doctor #${r.doctor_id}` },
    { key: 'room_type',      label: 'Room',    render: (r) => `${r.room_type} — ${r.bed_number}` },
    { key: 'admission_type', label: 'Type'     },
    { key: 'admission_date', label: 'Admitted', render: (r) => formatDate(r.admission_date) },
    { key: 'discharge_date', label: 'Discharged', render: (r) => formatDate(r.discharge_date) },
    { key: 'status',         label: 'Status',  render: (r) => <Badge status={r.status} /> },
    {
      key: 'actions', label: '', width: '120px', align: 'right',
      render: (r) => r.status === 'Active' && (
        <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); setConfirm(r); }}>Discharge</Button>
      ),
    },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-5)' }}>
      <div className="page-header">
        <div><h2 className="page-title">Admissions</h2><p className="page-subtitle">{data.filter(d=>d.status==='Active').length} active admission{data.filter(d=>d.status==='Active').length !== 1?'s':''}</p></div>
        <Button id="admit-patient-btn" variant="primary" onClick={() => setModal(true)}>+ Admit Patient</Button>
      </div>
      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}
      <Table columns={columns} data={data} loading={loading} emptyMessage="No admission records found." />
      <Modal isOpen={modal} onClose={() => setModal(false)} title="Admit Patient" size="md">
        <AdmissionForm onSubmit={handleAdmit} loading={saving} />
      </Modal>
      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={handleDischarge}
        title="Discharge Patient"
        message={`Discharge ${confirm?.patient_name ?? 'this patient'}? The room will be marked as available.`}
        confirmLabel="Discharge"
        loading={saving}
      />
    </div>
  );
};

export default AdmissionsPage;
