import { useEffect, useState, useCallback } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import {
  getAllExternalHospitals, createExternalHospital,
  updateExternalHospital, deleteExternalHospital,
} from '../../api/externalHospitals.api';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

const EMPTY = { name: '', contact_number: '', address: '' };

/**
 * ExternalHospitalsPage — the admin-maintained directory of facilities this
 * hospital refers patients OUT to when it has no free bed.
 *
 * Retiring (is_active = 0) rather than deleting is the normal way to remove a
 * hospital: the entry disappears from the referral form but every past referral
 * that named it stays intact. The API only permits a hard delete for an entry
 * no referral has ever used.
 */
const ExternalHospitalsPage = () => {
  const [hospitals, setHospitals] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [modal,     setModal]     = useState(null); // null | 'new' | hospital object
  const [form,      setForm]      = useState(EMPTY);
  const [saving,    setSaving]    = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting,     setDeleting]     = useState(false);

  // Always include retired entries — this is the screen where they are revived.
  const load = useCallback(() => {
    setLoading(true);
    getAllExternalHospitals(true)
      .then((r) => { if (r.success) setHospitals(r.data); })
      .catch(() => setError('Failed to load external hospitals.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const openNew  = () => { setForm(EMPTY); setModal('new'); };
  const openEdit = (h) => {
    setForm({ name: h.name, contact_number: h.contact_number ?? '', address: h.address ?? '' });
    setModal(h);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Hospital name is required.'); return; }
    setError(''); setSuccess('');
    setSaving(true);
    try {
      const payload = {
        name:           form.name.trim(),
        contact_number: form.contact_number.trim(),
        address:        form.address.trim(),
      };
      if (modal === 'new') await createExternalHospital(payload);
      else                 await updateExternalHospital(modal.hospital_id, payload);
      setSuccess('Hospital saved.');
      setModal(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed.');
    } finally { setSaving(false); }
  };

  const toggleActive = async (h) => {
    setError(''); setSuccess('');
    try {
      await updateExternalHospital(h.hospital_id, { is_active: h.is_active ? 0 : 1 });
      setSuccess(h.is_active
        ? `${h.name} deactivated — it no longer appears in the referral form.`
        : `${h.name} reactivated.`);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Update failed.');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteExternalHospital(deleteTarget.hospital_id);
      setSuccess('Hospital deleted.');
      setDeleteTarget(null);
      load();
    } catch (err) {
      // 409 when referrals already point at it — the message tells the admin to
      // deactivate instead, so it belongs on screen verbatim.
      setError(err.response?.data?.message || 'Delete failed.');
      setDeleteTarget(null);
    } finally { setDeleting(false); }
  };

  const activeCount = hospitals.filter((h) => h.is_active).length;

  const columns = [
    { key: 'name', label: 'Hospital', render: (h) => (
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ opacity: h.is_active ? 1 : 0.6 }}>{h.name}</span>
          {!h.is_active && <span className="text-xs text-muted">Retired — hidden from the referral form</span>}
        </span>
      ) },
    { key: 'contact_number', label: 'Contact', hideMobile: true },
    { key: 'address',        label: 'Address', hideMobile: true },
    { key: 'referral_count', label: 'Referrals', align: 'center', hideMobile: true,
      render: (h) => h.referral_count ?? 0 },
    { key: 'is_active', label: 'Status',
      render: (h) => <Badge status={h.is_active ? 'Active' : 'Inactive'} /> },
    {
      key: 'actions', label: '', width: '260px', align: 'right',
      render: (h) => (
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" onClick={() => openEdit(h)} title="Edit details">
            <Pencil size={14} />
          </Button>
          <Button
            size="sm"
            variant={h.is_active ? 'outline' : 'primary'}
            onClick={() => toggleActive(h)}
            title={h.is_active ? 'Hide from the referral form' : 'Show in the referral form again'}
          >
            {h.is_active ? 'Deactivate' : 'Reactivate'}
          </Button>
          {/* Only offered where it can succeed — the API refuses to delete a
              hospital any referral points at. */}
          {(h.referral_count ?? 0) === 0 && (
            <Button size="sm" variant="danger" onClick={() => setDeleteTarget(h)} title="Delete permanently">
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">External Hospitals</h1>
          <p className="page-subtitle">
            {activeCount} active of {hospitals.length} — the facilities nurses can refer patients out to
          </p>
        </div>
        <Button variant="primary" onClick={openNew}>+ Add Hospital</Button>
      </div>

      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <Table
        columns={columns}
        data={hospitals}
        loading={loading}
        emptyMessage="No external hospitals yet. Add one so nurses can refer patients out when the hospital is full."
      />

      <Modal
        isOpen={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'new' ? 'Add External Hospital' : 'Edit External Hospital'}
        size="sm"
      >
        <form onSubmit={handleSave} noValidate>
          <div className="form-group">
            <label htmlFor="eh-name">Hospital Name *</label>
            <input
              id="eh-name"
              value={form.name}
              onChange={set('name')}
              placeholder="e.g. Zamboanga City Medical Center"
              maxLength={200}
              required
            />
          </div>
          <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
            <label htmlFor="eh-contact">Contact Number</label>
            <input
              id="eh-contact"
              value={form.contact_number}
              onChange={set('contact_number')}
              placeholder="Landline or mobile"
              maxLength={50}
            />
          </div>
          <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
            <label htmlFor="eh-address">Address</label>
            <input
              id="eh-address"
              value={form.address}
              onChange={set('address')}
              placeholder="City / full address"
              maxLength={255}
            />
          </div>
          <p className="text-xs text-muted" style={{ marginTop: 'var(--space-3)' }}>
            Referrals already recorded keep the details that were in force when they were made —
            editing here only affects new ones.
          </p>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving}>Save Hospital</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete External Hospital"
        message={deleteTarget ? `Delete ${deleteTarget.name}? No referrals point at it, so this cannot be undone.` : ''}
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
};

export default ExternalHospitalsPage;
