import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTriageById, updateTriage, addVitalSigns } from '../../api/triages.api';
import { useAuth } from '../../context/AuthContext';
import { canManageTriage } from '../../utils/roleGuard';
import { isUnidentifiedName } from '../../utils/patientLabels';
import { formatDate } from '../../utils/formatDate';
import Badge from '../../components/ui/Badge';
import UnidentifiedBadge from '../../components/ui/UnidentifiedBadge';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import Alert from '../../components/ui/Alert';
import TriageForm from '../../components/forms/TriageForm';
import VitalSignsForm from '../../components/forms/VitalSignsForm';

const TriageDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [triage,  setTriage]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [modal,   setModal]   = useState(null);
  const [saving,  setSaving]  = useState(false);

  const load = () => {
    setLoading(true);
    getTriageById(id).then((r) => { if (r.success) setTriage(r.data); }).catch(() => setError('Failed to load triage.')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [id]);

  const act = (fn) => async (data) => {
    setSaving(true);
    try { await fn(data); setSuccess('Saved.'); setModal(null); load(); }
    catch (err) { setError(err.response?.data?.message || 'Save failed.'); }
    finally { setSaving(false); }
  };

  if (loading) return <Spinner />;
  if (!triage)  return <Alert type="error" message="Triage not found." />;
  // getTriageById returns the vitals columns flattened onto the triage row
  const vs = triage.blood_pressure ? triage : null;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-5)' }}>
      <button className="back-link" onClick={() => navigate('/triage')}>← Back to Triage</button>
      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      {/* Reads are open to all nurses, but only the recording employee may
          edit or add vitals (backend enforces the same rule) — hide the buttons otherwise */}
      <Card title={triage.patient_name ? `Triage — ${triage.patient_name}` : 'Triage Details'} action={
        canManageTriage(user?.role) && triage.employee_id === user?.linked_id && (
          <div style={{ display:'flex', gap:'var(--space-2)' }}>
            <Button size="sm" variant="outline" onClick={() => setModal('edit')}>Edit Triage</Button>
            <Button size="sm" variant="primary" onClick={() => setModal('vitals')}>Update Vitals</Button>
          </div>
        )
      }>
        <div className="patient-info-grid">
          <div><span className="info-label">Patient</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>{triage.patient_name ?? '—'}{isUnidentifiedName(triage.patient_name) && <UnidentifiedBadge />}</span></div>
          <div><span className="info-label">Triage Level</span><Badge status={triage.triage_level} /></div>
          <div><span className="info-label">Chief Complaint</span><span>{triage.chief_complaint || '—'}</span></div>
          <div><span className="info-label">Date/Time</span><span>{formatDate(triage.triage_datetime, true)}</span></div>
          <div><span className="info-label">Recorded By</span><span>{triage.employee_name ?? '—'}</span></div>
          <div><span className="info-label">Attending Doctor</span><span>{triage.attending_doctor_name ?? '—'}</span></div>
          <div><span className="info-label">Visit Type</span><span>{triage.visit_type ? <Badge status={triage.visit_type} /> : '—'}</span></div>
          <div><span className="info-label">Visit Room</span><span>{triage.visit_room_label ?? '—'}</span></div>
        </div>
        {triage.notes && <p style={{ marginTop:'var(--space-4)', color:'var(--color-text-muted)', fontSize:'var(--font-size-sm)' }}>{triage.notes}</p>}
      </Card>

      <Card title="Vital Signs">
        {vs ? (
          <div className="vitals-grid">
            <div><span className="info-label">Blood Pressure</span><span>{vs.blood_pressure}</span></div>
            <div><span className="info-label">Heart Rate</span><span>{vs.heart_rate} bpm</span></div>
            <div><span className="info-label">Temperature</span><span>{vs.temperature}°C</span></div>
            <div><span className="info-label">Respiratory Rate</span><span>{vs.respiratory_rate}/min</span></div>
            <div><span className="info-label">Date Recorded</span><span>{formatDate(vs.recorded_at, true)}</span></div>
            <div><span className="info-label">Last Updated</span><span>{vs.updated_at ? formatDate(vs.updated_at, true) : '—'}</span></div>
          </div>
        ) : <p className="text-muted text-sm">No vital signs recorded yet.</p>}
      </Card>

      <Modal isOpen={modal === 'edit'}   onClose={() => setModal(null)} title="Edit Triage"      size="md"><TriageForm    initial={triage} onSubmit={act((d) => updateTriage(id, d))} loading={saving} /></Modal>
      <Modal isOpen={modal === 'vitals'} onClose={() => setModal(null)} title="Update Vital Signs" size="md"><VitalSignsForm triageId={id} initial={vs ?? {}} onSubmit={act((d) => addVitalSigns(id, d))} loading={saving} /></Modal>
    </div>
  );
};

export default TriageDetailPage;
