import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllTriages, createTriage } from '../../api/triages.api';
import { useAuth } from '../../context/AuthContext';
import { formatDate } from '../../utils/formatDate';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import TriageForm from '../../components/forms/TriageForm';

const TriagePage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [modal,   setModal]   = useState(false);
  const [saving,  setSaving]  = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getAllTriages().then((r) => { if (r.success) setData(r.data); }).catch(() => setError('Failed to load triages.')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async (form) => {
    setSaving(true);
    try {
      await createTriage(form);
      setSuccess('Triage recorded.');
      setModal(false);
      load();
    } catch (err) { setError(err.response?.data?.message || 'Failed to save triage.'); }
    finally { setSaving(false); }
  };

  const columns = [
    { key: 'triage_id',       label: 'ID',       width: '60px' },
    { key: 'patient_name',    label: 'Patient',  render: (r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || `Patient #${r.patient_id}` },
    { key: 'triage_level',    label: 'Level',    render: (r) => <Badge status={r.triage_level} /> },
    { key: 'triage_datetime', label: 'Date/Time', render: (r) => formatDate(r.triage_datetime, true) },
    { key: 'notes',           label: 'Notes',    render: (r) => <span style={{ color:'var(--color-text-muted)', fontSize:'var(--font-size-sm)' }}>{r.notes ? r.notes.substring(0, 60) + (r.notes.length > 60 ? '…' : '') : '—'}</span> },
    { key: 'actions', label: '', width: '80px', align: 'right', render: (r) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/triage/${r.triage_id}`); }}>View</Button> },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-5)' }}>
      <div className="page-header">
        <div><h2 className="page-title">Triage</h2><p className="page-subtitle">{data.length} triage record{data.length !== 1 ? 's' : ''}</p></div>
        <Button id="create-triage-btn" variant="primary" onClick={() => setModal(true)}>+ Record Triage</Button>
      </div>
      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}
      <Table columns={columns} data={data} loading={loading} emptyMessage="No triage records found." onRowClick={(r) => navigate(`/triage/${r.triage_id}`)} />
      <Modal isOpen={modal} onClose={() => setModal(false)} title="Record Triage" size="md">
        <TriageForm onSubmit={handleCreate} loading={saving} />
      </Modal>
    </div>
  );
};

export default TriagePage;
