import { useEffect, useState, useCallback } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  getIncomingEndorsements, getOutgoingEndorsements, getEndorsementById,
  createEndorsement, acknowledgeEndorsement, cancelEndorsement,
} from '../../api/endorsements.api';
import { getMyNursingContext } from '../../api/nursing.api';
import { formatDate } from '../../utils/formatDate';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import Spinner from '../../components/ui/Spinner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EndorsementForm from '../../components/forms/EndorsementForm';

const TABS = ['Incoming', 'Outgoing'];

/**
 * EndorsementsPage — shift handoffs in and out.
 *
 * Incoming: handoffs waiting on this nurse. Acknowledging is what actually
 * transfers the patients, so a Pending row means responsibility still sits with
 * the outgoing nurse.
 * Outgoing: what this nurse handed over, and whether it has been picked up.
 */
const EndorsementsPage = () => {
  const [tab,      setTab]      = useState(TABS[0]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [context,  setContext]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');
  const [noDepartment, setNoDepartment] = useState(false);

  const [detail,    setDetail]    = useState(null);   // full endorsement being viewed
  const [detailBusy, setDetailBusy] = useState(false);
  const [creating,  setCreating]  = useState(false);  // create modal open
  const [saving,    setSaving]    = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getIncomingEndorsements(), getOutgoingEndorsements(), getMyNursingContext()])
      .then(([inc, out, ctx]) => {
        if (inc.success) setIncoming(inc.data);
        if (out.success) setOutgoing(out.data);
        if (ctx.success) setContext(ctx.data);
        setNoDepartment(false);
      })
      .catch((err) => {
        if (err.response?.data?.no_department) setNoDepartment(true);
        else setError(err.response?.data?.message || 'Failed to load endorsements.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (row) => {
    setError('');
    try {
      const res = await getEndorsementById(row.endorsement_id);
      if (res.success) setDetail(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to open endorsement.');
    }
  };

  const handleCreate = async (payload) => {
    setError(''); setSuccess('');
    setSaving(true);
    try {
      const res = await createEndorsement(payload);
      setSuccess(res.message || 'Shift endorsed.');
      setCreating(false);
      setTab('Outgoing');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Endorsement failed.');
    } finally { setSaving(false); }
  };

  const handleAcknowledge = async (id) => {
    setError(''); setSuccess('');
    setDetailBusy(true);
    try {
      const res = await acknowledgeEndorsement(id);
      setSuccess(res.message || 'Endorsement acknowledged.');
      setDetail(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Acknowledgement failed.');
    } finally { setDetailBusy(false); }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setError(''); setSuccess('');
    setDetailBusy(true);
    try {
      const res = await cancelEndorsement(cancelTarget.endorsement_id);
      setSuccess(res.message || 'Endorsement withdrawn.');
      setCancelTarget(null);
      setDetail(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Withdrawal failed.');
      setCancelTarget(null);
    } finally { setDetailBusy(false); }
  };

  const isIncoming = tab === 'Incoming';
  const rows = isIncoming ? incoming : outgoing;
  const pendingIncoming = incoming.filter((e) => e.status === 'Pending').length;

  const columns = [
    { key: 'shift', label: 'Shift', render: (e) => (
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 600 }}>{e.shift}</span>
          <span className="text-xs text-muted">{formatDate(e.shift_date)}</span>
          {e.derived_shift && e.derived_shift !== e.shift && (
            <span className="text-xs" style={{ color: 'var(--color-primary)', marginTop: '2px' }}>
              Submitted during {e.derived_shift}
            </span>
          )}
        </span>
      ) },
    { key: 'nurse', label: isIncoming ? 'From' : 'To',
      render: (e) => (isIncoming ? e.from_nurse_name : e.to_nurse_name) },
    { key: 'department_name', label: 'Ward', hideMobile: true },
    { key: 'patient_count', label: 'Patients', align: 'center' },
    { key: 'status', label: 'Status', render: (e) => (
        <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <Badge status={e.status === 'Acknowledged' ? 'Completed' : 'Pending'} label={e.status} />
          <span className="text-xs text-muted">
            {formatDate(e.created_at, true)}
          </span>
          {e.status === 'Acknowledged' && (
            <span className="text-xs text-muted">Ack: {formatDate(e.acknowledged_at, true)}</span>
          )}
        </span>
      ) },
    {
      key: 'actions', label: '', width: '200px', align: 'right',
      render: (e) => (
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" onClick={(ev) => { ev.stopPropagation(); openDetail(e); }}>
            View
          </Button>
          {isIncoming && e.status === 'Pending' && (
            <Button size="sm" variant="primary"
              onClick={(ev) => { ev.stopPropagation(); handleAcknowledge(e.endorsement_id); }}>
              Acknowledge
            </Button>
          )}
          {!isIncoming && e.status === 'Pending' && (
            <Button size="sm" variant="danger"
              title="Withdraw this handoff — it has not been acknowledged yet"
              onClick={(ev) => { ev.stopPropagation(); setCancelTarget(e); }}>
              Withdraw
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (loading) return <Spinner />;

  if (noDepartment) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <div className="page-header">
          <div>
            <h1 className="page-title">Shift Endorsements</h1>
            <p className="page-subtitle">No department assigned</p>
          </div>
        </div>
        <Alert
          type="warning"
          message="You have not been assigned to a department yet. Ask an administrator to set your ward under User Management, then reload this page."
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Shift Endorsements</h1>
          <p className="page-subtitle">
            {context?.department_name ?? 'Your ward'} · {context?.my_patients ?? 0} patient
            {context?.my_patients !== 1 ? 's' : ''} currently assigned to you
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>+ Endorse Shift</Button>
      </div>

      {pendingIncoming > 0 && (
        <Alert
          type="info"
          message={`${pendingIncoming} endorsement${pendingIncoming !== 1 ? 's are' : ' is'} waiting for you. The patients stay with the outgoing nurse until you acknowledge.`}
        />
      )}
      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <div className="detail-tabs">
        {TABS.map((t) => (
          <button key={t} className={`detail-tab${tab === t ? ' detail-tab--active' : ''}`} onClick={() => setTab(t)}>
            {t} ({t === 'Incoming' ? incoming.length : outgoing.length})
          </button>
        ))}
      </div>

      <Table
        columns={columns}
        data={rows}
        onRowClick={openDetail}
        emptyMessage={isIncoming
          ? 'No shift has been endorsed to you.'
          : 'You have not endorsed a shift yet.'}
      />

      {/* ── Create ── */}
      <Modal isOpen={creating} onClose={() => setCreating(false)} title="Endorse Shift" size="md">
        {creating && <EndorsementForm onSubmit={handleCreate} loading={saving} />}
      </Modal>

      {/* ── Detail ── */}
      <Modal
        isOpen={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.shift} Shift — ${formatDate(detail.shift_date)}` : ''}
        size="md"
      >
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <strong>{detail.from_nurse_name}</strong>
              <ArrowRight size={16} />
              <strong>{detail.to_nurse_name}</strong>
              <Badge status={detail.status === 'Acknowledged' ? 'Completed' : 'Pending'} label={detail.status} />
              {detail.department_name && <span className="text-sm text-muted">{detail.department_name}</span>}
            </div>

            {detail.general_notes && (
              <div>
                <span className="text-xs text-muted">WARD NOTES</span>
                <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{detail.general_notes}</p>
              </div>
            )}

            <div>
              <span className="text-xs text-muted">
                PATIENTS ({detail.patients?.length ?? 0})
              </span>
              {(detail.patients ?? []).length === 0 ? (
                <p className="text-sm text-muted">No patients were attached to this endorsement.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                  {detail.patients.map((p) => (
                    <div key={p.patient_id} style={{
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-3)',
                    }}>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                        {p.bed_number && <span style={{ fontWeight: 600 }}>{p.bed_number}</span>}
                        <span>{p.patient_name}</span>
                        {p.admission_status && <Badge status={p.admission_status} />}
                      </div>
                      <p className="text-sm" style={{ marginTop: 'var(--space-1)', whiteSpace: 'pre-wrap' }}>
                        {p.notes || <span className="text-muted">No note recorded.</span>}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
              <p className="text-xs text-muted">
                <strong>Declared shift:</strong> {detail.shift} ({formatDate(detail.shift_date)})
              </p>
              {detail.derived_shift && (
                <p className="text-xs text-muted">
                  <strong>Submitted during:</strong> {detail.derived_shift} period
                </p>
              )}
              <p className="text-xs text-muted">
                <strong>Submitted at:</strong> {formatDate(detail.created_at, true)}
                {detail.acknowledged_at ? ` · Acknowledged ${formatDate(detail.acknowledged_at, true)}` : ''}
              </p>
            </div>

            {/* Acknowledge only appears for the receiving nurse on a Pending row */}
            {detail.status === 'Pending' && Number(detail.to_nurse_id) === Number(context?.employee_id) && (
              <div className="form-actions">
                <Button variant="primary" loading={detailBusy}
                  onClick={() => handleAcknowledge(detail.endorsement_id)}>
                  Acknowledge & Take Over
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancel}
        title="Withdraw Endorsement"
        message={cancelTarget
          ? `Withdraw the ${cancelTarget.shift} shift endorsement to ${cancelTarget.to_nurse_name}? Nothing has transferred yet, so your patients stay with you.`
          : ''}
        confirmLabel="Withdraw"
        loading={detailBusy}
      />
    </div>
  );
};

export default EndorsementsPage;
