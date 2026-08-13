import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getWardPatients, getMyNursingContext, assignPatient, releasePatient } from '../../api/nursing.api';
import { formatDate } from '../../utils/formatDate';
import { formatPatientAge, formatPatientSex } from '../../utils/patientLabels';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import Spinner from '../../components/ui/Spinner';
import UnidentifiedBadge from '../../components/ui/UnidentifiedBadge';

const TABS = ['Ward Patients', 'My Patients'];

/**
 * MyWardPage — the patients currently in this nurse's department.
 *
 * The ward list is derived, never hand-maintained: patient → admission → room →
 * department. Sitting on top of it is an explicit assignment saying which nurse
 * is personally responsible this shift, which is what an endorsement hands over.
 */
const MyWardPage = () => {
  const navigate = useNavigate();

  const [context,  setContext]  = useState(null);
  const [patients, setPatients] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');
  const [tab,      setTab]      = useState(TABS[0]);
  const [busyId,   setBusyId]   = useState(null);
  // Set once the API reports no department — the page then explains rather
  // than showing an empty table with no reason.
  const [noDepartment, setNoDepartment] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getMyNursingContext(), getWardPatients(false)])
      .then(([ctx, ward]) => {
        if (ctx.success) setContext(ctx.data);
        if (ward.success) setPatients(ward.data);
        setNoDepartment(false);
      })
      .catch((err) => {
        if (err.response?.data?.no_department) setNoDepartment(true);
        else setError(err.response?.data?.message || 'Failed to load your ward.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, patientId) => {
    setError(''); setSuccess('');
    setBusyId(patientId);
    try {
      const res = await fn();
      setSuccess(res.message || 'Done.');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Action failed.');
    } finally { setBusyId(null); }
  };

  const myEmployeeId = context?.employee_id;
  const shown = tab === 'My Patients'
    ? patients.filter((p) => Number(p.assigned_nurse_id) === Number(myEmployeeId))
    : patients;

  const columns = [
    { key: 'bed_number', label: 'Bed', width: '90px',
      render: (r) => <span style={{ fontWeight: 600 }}>{r.bed_number}</span> },
    { key: 'patient_name', label: 'Patient', render: (r) => (
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {r.patient_name}
            {r.is_unidentified ? <UnidentifiedBadge /> : null}
          </span>
          <span className="text-xs text-muted">
            {formatPatientSex(r)} · {formatPatientAge(r)}
          </span>
        </span>
      ) },
    // Triage level stays visible on mobile: on a phone a nurse is scanning for
    // "who is Critical", and the badge is narrow. Condition and admission
    // status are the ones that cost width without changing what you do next.
    { key: 'triage_level', label: 'Triage',
      render: (r) => (r.triage_level ? <Badge status={r.triage_level} /> : '—') },
    // The API nulls medical_condition on rows this nurse does not hold, so the
    // two cases read differently: "no diagnosis recorded" vs "not yours to see".
    { key: 'medical_condition', label: 'Condition', hideMobile: true,
      render: (r) => {
        const mine = Number(r.assigned_nurse_id) === Number(myEmployeeId);
        if (!mine) return <span className="text-muted">— not assigned to you</span>;
        return r.medical_condition || <span className="text-muted">No diagnosis yet</span>;
      } },
    { key: 'admission_status', label: 'Status', hideMobile: true,
      render: (r) => <Badge status={r.admission_status} /> },
    // Hidden on mobile: the action button already states ownership — "Release"
    // means it is yours, "Take Over" means it is not — so this column costs
    // 140px to repeat what the row already says.
    { key: 'assigned_nurse_name', label: 'Assigned Nurse', hideMobile: true, render: (r) => {
        if (!r.assigned_nurse_id) return <span className="text-muted">Unassigned</span>;
        const mine = Number(r.assigned_nurse_id) === Number(myEmployeeId);
        return (
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: mine ? 600 : 400 }}>{mine ? 'You' : r.assigned_nurse_name}</span>
            <span className="text-xs text-muted">since {formatDate(r.assigned_at)}</span>
          </span>
        );
      } },
    {
      key: 'actions', label: '', width: '190px', align: 'right',
      render: (r) => {
        const mine = Number(r.assigned_nurse_id) === Number(myEmployeeId);
        const busy = busyId === r.patient_id;
        return (
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {mine ? (
              <Button size="sm" variant="outline" loading={busy}
                title="Give up responsibility for this patient"
                onClick={(e) => { e.stopPropagation(); act(() => releasePatient(r.patient_id), r.patient_id); }}>
                Release
              </Button>
            ) : (
              // Claiming a patient another nurse holds reassigns them — the API
              // releases the incumbent in the same transaction.
              <Button size="sm" variant="primary" loading={busy}
                title={r.assigned_nurse_id ? `Take over from ${r.assigned_nurse_name}` : 'Take responsibility for this patient'}
                onClick={(e) => { e.stopPropagation(); act(() => assignPatient(r.patient_id), r.patient_id); }}>
                {r.assigned_nurse_id ? 'Take Over' : 'Assign to Me'}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  if (loading) return <Spinner />;

  // No ward set: a nurse cannot fix this themselves, so name who can.
  if (noDepartment) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <div className="page-header">
          <div>
            <h1 className="page-title">My Ward</h1>
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

  const mineCount = patients.filter((p) => Number(p.assigned_nurse_id) === Number(myEmployeeId)).length;
  const unassignedCount = patients.filter((p) => !p.assigned_nurse_id).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">{context?.department_name ?? 'My Ward'}</h1>
          <p className="page-subtitle">
            {patients.length} patient{patients.length !== 1 ? 's' : ''} in the ward · {mineCount} assigned to you
            {unassignedCount > 0 ? ` · ${unassignedCount} unassigned` : ''}
          </p>
        </div>
        <Button variant="primary" onClick={() => navigate('/endorsements')}>
          Shift Endorsements
          {context?.pending_endorsements > 0 ? ` (${context.pending_endorsements})` : ''}
        </Button>
      </div>

      {/* A handoff waiting on this nurse is surfaced here too — the ward list is
          where they start their shift, not the endorsements page. */}
      {context?.pending_endorsements > 0 && (
        <Alert
          type="info"
          message={`You have ${context.pending_endorsements} shift endorsement${context.pending_endorsements !== 1 ? 's' : ''} waiting to be acknowledged. The patients stay with the outgoing nurse until you do.`}
        />
      )}
      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <div className="detail-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={`detail-tab${tab === t ? ' detail-tab--active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}{t === 'My Patients' ? ` (${mineCount})` : ` (${patients.length})`}
          </button>
        ))}
      </div>

      <Table
        columns={columns}
        data={shown}
        // Presence is visible for every ward patient, but the RECORD follows the
        // active assignment — so only rows this nurse holds navigate through.
        // Tapping another nurse's row would otherwise land on a 403 screen.
        onRowClick={(r) => {
          if (Number(r.assigned_nurse_id) === Number(myEmployeeId)) {
            navigate(`/patients/${r.patient_id}`);
          }
        }}
        emptyMessage={
          tab === 'My Patients'
            ? 'No patients are assigned to you. Take one from the Ward Patients tab.'
            : 'No patients are currently admitted to your ward.'
        }
      />
    </div>
  );
};

export default MyWardPage;
