import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Stethoscope, Building2, ClipboardList, FlaskConical,
  Siren, BedDouble, Users, Repeat, UserPlus, DoorOpen, ChevronRight, UserCheck,
} from 'lucide-react';
import { getDashboardStats, getDashboardRecentActivity, getDashboardMyStats } from '../../api/dashboard.api';
import { getMyPendingAssignments, acceptAssignment, declineAssignment } from '../../api/assignments.api';
import { useAuth } from '../../context/AuthContext';
import StatCard from '../../components/ui/StatCard';
import Badge   from '../../components/ui/Badge';
import Alert   from '../../components/ui/Alert';
import Button  from '../../components/ui/Button';
import Modal   from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import { formatDate } from '../../utils/formatDate';
import './DashboardPage.css';

// ── Admin workflow stepper ─────────────────────────────────────────────────
// Registration → Triage → Diagnosis → Referral → Admission → Discharge. Each
// step shows a live aggregate count. Read-only: admins are oversight-only and
// have no access to the clinical pages behind these numbers.
const WORKFLOW_STEPS = [
  { key: 'registration', label: 'Registration', icon: UserPlus,    statKey: 'patients_today',          caption: 'registered today' },
  { key: 'triage',       label: 'Triage',       icon: Siren,       statKey: 'todays_triages',          caption: 'triaged today'    },
  { key: 'diagnosis',    label: 'Diagnosis',    icon: Stethoscope, statKey: 'todays_diagnoses',        caption: 'diagnosed today'  },
  { key: 'referral',     label: 'Referral',     icon: Repeat,      statKey: 'pending_referrals',       caption: 'pending'          },
  { key: 'admission',    label: 'Admission',    icon: BedDouble,   statKey: 'pending_room_admissions', caption: 'awaiting room'    },
  { key: 'discharge',    label: 'Discharge',    icon: DoorOpen,    statKey: 'pending_discharges',      caption: 'pending'          },
];

const WorkflowStepper = ({ stats }) => (
  <section className="workflow-stepper" aria-label="Patient workflow overview">
    {WORKFLOW_STEPS.map((step, i) => {
      const Icon = step.icon;
      const count = stats?.[step.statKey] ?? 0;
      return (
        <div className="workflow-step-wrap" key={step.key}>
          <div
            className="workflow-step workflow-step--static"
            title={`${count} ${step.caption}`}
          >
            <span className="workflow-step__icon"><Icon size={18} /></span>
            <span className="workflow-step__count">{count}</span>
            <span className="workflow-step__label">{step.label}</span>
            <span className="workflow-step__caption">{step.caption}</span>
          </div>
          {i < WORKFLOW_STEPS.length - 1 && (
            <span className="workflow-step__arrow" aria-hidden="true"><ChevronRight size={18} /></span>
          )}
        </div>
      );
    })}
  </section>
);

// ── Helpers ──────────────────────────────────────────────────────────────────
const timeAgo = (dateStr) => {
  if (!dateStr) return '—';
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60)     return 'Just now';
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(dateStr);
};

// ── Shared sub-components ─────────────────────────────────────────────────────
const SkeletonRow = () => (
  <div className="activity-item activity-item--skeleton">
    <div className="skeleton skeleton--avatar" />
    <div className="activity-item__body">
      <div className="skeleton skeleton--line skeleton--line-lg" />
      <div className="skeleton skeleton--line skeleton--line-sm" />
    </div>
  </div>
);

const ActivityPanel = ({ title, icon, loading, items, emptyMsg, renderItem, count }) => (
  <div className="activity-panel">
    <div className="activity-panel__header">
      <span className="activity-panel__icon">{icon}</span>
      <h3 className="activity-panel__title">{title}</h3>
      {count !== undefined && (
        <span className="activity-panel__badge">{count}</span>
      )}
    </div>
    <div className="activity-panel__body">
      {loading
        ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
        : items.length === 0
          ? <p className="activity-empty">{emptyMsg}</p>
          : items.map(renderItem)
      }
    </div>
  </div>
);

// ── Pending attending-doctor assignments (doctor only) ──────────────────────
// Proposals from a Doctor-in-Charge awaiting THIS doctor's response. The
// doctor can open the chart (read access while Pending), then Accept —
// becoming the attending doctor — or Decline with a reason, which returns the
// patient to the coordination queue and notifies the proposing DIC.
const PendingAssignmentsPanel = ({ navigate, onResponded }) => {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [acting,  setActing]  = useState(false);
  const [declineTarget, setDeclineTarget] = useState(null); // row being declined
  const [declineReason, setDeclineReason] = useState('');

  const loadPending = () => {
    getMyPendingAssignments()
      .then((r) => { if (r.success) setItems(r.data); })
      .catch(() => {}) // non-critical
      .finally(() => setLoading(false));
  };
  useEffect(() => { loadPending(); }, []);

  const respond = async (fn, successFallback) => {
    setActing(true);
    try {
      const res = await fn();
      setSuccess(res.message || successFallback);
      setDeclineTarget(null);
      setDeclineReason('');
      loadPending();
      onResponded(); // refresh dashboard stats
    } catch (err) {
      setError(err.response?.data?.message || 'Action failed.');
      setDeclineTarget(null);
      loadPending(); // proposal may have been cancelled meanwhile
    } finally { setActing(false); }
  };

  // Hide the section entirely when there is nothing to respond to.
  if (!loading && items.length === 0 && !success && !error) return null;

  return (
    <section className="role-section">
      <div className="role-section__header">
        <span className="role-section__badge role-section__badge--doctor"><UserCheck size={16} /> Action Required</span>
        <h3 className="role-section__title">Pending Assignments</h3>
      </div>

      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <ActivityPanel
        title="Patients proposed to you"
        icon={<UserCheck size={18} />}
        loading={loading}
        items={items}
        emptyMsg="No assignments awaiting your response."
        count={items.length}
        renderItem={(a) => (
          <div key={a.dic_id} className="activity-item" style={{ cursor: 'default' }}>
            <div className="activity-item__avatar activity-item__avatar--triage"><UserCheck size={18} /></div>
            <div className="activity-item__body">
              <p className="activity-item__name">{a.patient_name || 'Unknown Patient'}</p>
              <p className="activity-item__meta">
                Proposed {timeAgo(a.assigned_at)}
                {a.assigned_by_name ? ` by ${a.assigned_by_name}` : ''}
                {' · '}
                <button
                  type="button"
                  onClick={() => navigate(`/patients/${a.patient_id}`)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                           color: 'var(--color-primary)', font: 'inherit', textDecoration: 'underline' }}
                >
                  Review chart
                </button>
              </p>
            </div>
            <div className="activity-item__right" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {a.triage_level && <Badge status={a.triage_level} />}
              <Button size="sm" variant="primary" loading={acting}
                onClick={() => respond(() => acceptAssignment(a.patient_id), 'Assignment accepted.')}>
                Accept
              </Button>
              <Button size="sm" variant="danger"
                onClick={() => { setDeclineReason(''); setDeclineTarget(a); }}>
                Decline
              </Button>
            </div>
          </div>
        )}
      />

      {/* Decline-with-reason modal */}
      <Modal isOpen={!!declineTarget} onClose={() => setDeclineTarget(null)} title="Decline Assignment" size="sm">
        <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-4)' }}>
          Decline the attending-doctor assignment for <strong>{declineTarget?.patient_name || 'this patient'}</strong>?
          The patient returns to the coordination queue and the proposing coordinator is notified with your reason.
        </p>
        <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
          <label htmlFor="decline-reason">Reason *</label>
          <textarea
            id="decline-reason"
            rows={3}
            maxLength={255}
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            placeholder="e.g. At capacity — please route to another internist."
            required
          />
        </div>
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setDeclineTarget(null)}>Cancel</Button>
          <Button variant="danger" loading={acting} disabled={!declineReason.trim()}
            onClick={() => respond(() => declineAssignment(declineTarget.patient_id, declineReason.trim()), 'Assignment declined.')}>
            Decline Assignment
          </Button>
        </div>
      </Modal>
    </section>
  );
};

// ── Role panel: Doctor ────────────────────────────────────────────────────────
const DoctorPanel = ({ myData, loading, navigate }) => {
  if (!myData && !loading) return null;
  const pendingRefs  = myData?.my_pending_referrals ?? [];
  const todayDiag    = myData?.my_todays_diagnoses  ?? [];
  const stats        = myData?.stats ?? {};

  return (
    <section className="role-section">
      <div className="role-section__header">
        <span className="role-section__badge role-section__badge--doctor"><Stethoscope size={16} /> My Dashboard</span>
        <h3 className="role-section__title">Doctor Overview</h3>
      </div>

      {/* Mini stats — clickable, replacing the removed top StatCard row */}
      <div className="role-stats-row">
        <button type="button" className="role-stat role-stat--link" onClick={() => navigate('/referrals')}>
          <span className="role-stat__value role-stat__value--warning">{stats.my_pending_referrals ?? 0}</span>
          <span className="role-stat__label">Pending Referrals</span>
        </button>
        <button type="button" className="role-stat role-stat--link" onClick={() => navigate('/patients')}>
          <span className="role-stat__value role-stat__value--primary">{stats.my_active_patients ?? 0}</span>
          <span className="role-stat__label">Active Patients</span>
        </button>
        <button type="button" className="role-stat role-stat--link" onClick={() => navigate('/triage')}>
          <span className="role-stat__value role-stat__value--info">{stats.my_todays_diagnoses ?? 0}</span>
          <span className="role-stat__label">Today's Diagnoses</span>
        </button>
      </div>

      {/* Action lists */}
      <div className="activity-grid">
        <ActivityPanel
          title="My Pending Referrals"
          icon={<ClipboardList size={18} />}
          loading={loading}
          items={pendingRefs}
          emptyMsg="No pending referrals assigned to you."
          count={stats.my_pending_referrals}
          renderItem={(r) => (
            <button
              key={r.referral_id}
              className="activity-item"
              onClick={() => navigate('/referrals')}
            >
              <div className="activity-item__avatar activity-item__avatar--referral"><ClipboardList size={18} /></div>
              <div className="activity-item__body">
                <p className="activity-item__name">{r.patient_name || 'Unknown Patient'}</p>
                <p className="activity-item__meta">
                  {r.medical_condition || 'No condition noted'}
                  {r.referring_doctor_name ? ` · from Dr. ${r.referring_doctor_name}` : ''}
                </p>
              </div>
              <div className="activity-item__right">
                <Badge status={r.status} />
                <span className="activity-item__time">{timeAgo(r.referral_date)}</span>
              </div>
            </button>
          )}
        />

        <ActivityPanel
          title="Today's Diagnoses"
          icon={<FlaskConical size={18} />}
          loading={loading}
          items={todayDiag}
          emptyMsg="No diagnoses recorded today."
          count={stats.my_todays_diagnoses}
          renderItem={(d) => (
            <button
              key={d.diagnosis_id}
              className="activity-item"
              onClick={() => navigate(`/patients/${d.patient_id}`)}
            >
              <div className="activity-item__avatar activity-item__avatar--diagnosis"><FlaskConical size={18} /></div>
              <div className="activity-item__body">
                <p className="activity-item__name">{d.patient_name || 'Unknown Patient'}</p>
                <p className="activity-item__meta">{d.medical_condition || '—'}</p>
              </div>
              <div className="activity-item__right">
                <span className="activity-item__time">{timeAgo(d.diagnosis_date)}</span>
              </div>
            </button>
          )}
        />
      </div>
    </section>
  );
};

// ── Role panel: Nurse / Staff ─────────────────────────────────────────────────
const NurseStaffPanel = ({ myData, loading, navigate }) => {
  if (!myData && !loading) return null;
  const triages    = myData?.todays_triages     ?? [];
  const admissions = myData?.pending_admissions ?? [];
  const stats      = myData?.stats ?? {};

  return (
    <section className="role-section">
      <div className="role-section__header">
        <span className="role-section__badge role-section__badge--nurse"><Building2 size={16} /> My Dashboard</span>
        <h3 className="role-section__title">Today's Workload</h3>
      </div>

      {/* Mini stats — clickable, replacing the removed top StatCard row */}
      <div className="role-stats-row">
        <button type="button" className="role-stat role-stat--link" onClick={() => navigate('/triage')}>
          <span className="role-stat__value role-stat__value--danger">{stats.todays_triages ?? 0}</span>
          <span className="role-stat__label">Today's Triages</span>
        </button>
        <button type="button" className="role-stat role-stat--link" onClick={() => navigate('/rooms')}>
          <span className="role-stat__value role-stat__value--success">{stats.available_rooms ?? 0}</span>
          <span className="role-stat__label">Available Rooms</span>
        </button>
        <button type="button" className="role-stat role-stat--link" onClick={() => navigate('/admissions')}>
          <span className="role-stat__value role-stat__value--warning">{stats.pending_admissions ?? 0}</span>
          <span className="role-stat__label">Pending Admissions</span>
        </button>
      </div>

      {/* Action lists */}
      <div className="activity-grid">
        <ActivityPanel
          title="Today's Triages"
          icon={<Siren size={18} />}
          loading={loading}
          items={triages}
          emptyMsg="No triages recorded today."
          count={stats.todays_triages}
          renderItem={(t) => (
            <button
              key={t.triage_id}
              className="activity-item"
              onClick={() => navigate(`/patients/${t.patient_id}`)}
            >
              <div className="activity-item__avatar activity-item__avatar--triage"><Siren size={18} /></div>
              <div className="activity-item__body">
                <p className="activity-item__name">{t.patient_name || 'Unknown Patient'}</p>
                <p className="activity-item__meta">{t.notes ? t.notes.substring(0, 60) + (t.notes.length > 60 ? '…' : '') : 'No notes'}</p>
              </div>
              <div className="activity-item__right">
                <Badge status={t.triage_level} />
                <span className="activity-item__time">{timeAgo(t.triage_datetime)}</span>
              </div>
            </button>
          )}
        />

        <ActivityPanel
          title="Pending Admissions"
          icon={<BedDouble size={18} />}
          loading={loading}
          items={admissions}
          emptyMsg="No pending admissions."
          count={stats.pending_admissions}
          renderItem={(a) => (
            <button
              key={a.admission_id}
              className="activity-item"
              onClick={() => navigate('/admissions')}
            >
              <div className="activity-item__avatar activity-item__avatar--admission"><BedDouble size={18} /></div>
              <div className="activity-item__body">
                <p className="activity-item__name">{a.patient_name || 'Unknown Patient'}</p>
                <p className="activity-item__meta">
                  {a.room_type && a.bed_number ? `${a.room_type} · Bed ${a.bed_number}` : 'Room TBD'}
                  {` · ${a.admission_type || 'Admission'}`}
                </p>
              </div>
              <div className="activity-item__right">
                <Badge status={a.status} />
                <span className="activity-item__time">{timeAgo(a.admission_date)}</span>
              </div>
            </button>
          )}
        />
      </div>
    </section>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
const DashboardPage = () => {
  const navigate     = useNavigate();
  const { user }     = useAuth();
  const role         = user?.role ?? 'staff';

  const [stats,    setStats]    = useState(null);
  const [activity, setActivity] = useState(null);
  const [myData,   setMyData]   = useState(null);
  const [loadStat, setLoadStat] = useState(true);
  const [loadAct,  setLoadAct]  = useState(true);
  const [loadMy,   setLoadMy]   = useState(true);
  const [error,    setError]    = useState('');
  const [lastUpdated, setLastUpdated] = useState(null); // latest live refresh

  useEffect(() => {
    // All requests run in parallel — independent loading states.
    // Doctors never call the hospital-wide stats endpoint (backend 403s it);
    // their dashboard is my-stats + their own scoped recent activity.
    if (role !== 'doctor') {
      getDashboardStats()
        .then((r) => { if (r.success) { setStats(r.data); setLastUpdated(new Date()); } })
        .catch(() => setError('Failed to load stats.'))
        .finally(() => setLoadStat(false));
    } else {
      setLoadStat(false);
    }

    // Admins are oversight-only — no row-level clinical activity feed
    // (the backend returns empty lists for them anyway).
    if (role !== 'admin') {
      getDashboardRecentActivity()
        .then((r) => { if (r.success) setActivity(r.data); })
        .catch(() => {}) // non-critical — don't surface this error
        .finally(() => setLoadAct(false));
    } else {
      setLoadAct(false);
    }

    getDashboardMyStats()
      .then((r) => { if (r.success) { setMyData(r.data); setLastUpdated(new Date()); } })
      .catch(() => {}) // non-critical
      .finally(() => setLoadMy(false));
  }, [role]);

  // Re-fetch my-stats whenever a referral status changes (issue #12)
  useEffect(() => {
    const handleReferralUpdate = () => {
      getDashboardMyStats()
        .then((r) => { if (r.success) setMyData(r.data); })
        .catch(() => {});
      if (role !== 'doctor') {
        getDashboardStats()
          .then((r) => { if (r.success) setStats(r.data); })
          .catch(() => {});
      }
    };
    window.addEventListener('referral-status-updated', handleReferralUpdate);
    return () => window.removeEventListener('referral-status-updated', handleReferralUpdate);
  }, [role]);

  // Live refresh every 15s — keeps the "Available Rooms" widget (and other
  // counts) current. Silent: no spinners, transient errors ignored.
  useEffect(() => {
    const id = setInterval(() => {
      if (role !== 'doctor') {
        getDashboardStats().then((r) => { if (r.success) { setStats(r.data); setLastUpdated(new Date()); } }).catch(() => {});
      }
      getDashboardMyStats().then((r) => { if (r.success) { setMyData(r.data); setLastUpdated(new Date()); } }).catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [role]);

  if (loadStat && !stats) return <Spinner />;

  const recentAdmissions = activity?.recent_admissions ?? [];
  const recentReferrals  = activity?.recent_referrals  ?? [];

  // ── Greeting based on role — prefer the real name, fall back to username ──
  const greetings = {
    admin:  'Hospital Operations Overview',
    doctor: `Welcome back, Dr. ${user?.last_name ?? user?.username ?? ''}`,
    nurse:  `Welcome back, ${user?.first_name ?? user?.username ?? ''}`,
    staff:  `Welcome back, ${user?.first_name ?? user?.username ?? ''}`,
  };

  return (
    <div className="dashboard-page">

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{greetings[role] ?? 'Overview'}</h1>
          <p className="page-subtitle">Real-time snapshot of hospital operations</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-2)' }}>
          <span className={`role-badge role-badge--${role}`}>{role.charAt(0).toUpperCase() + role.slice(1)}</span>
          {lastUpdated && (
            <span className="live-indicator" title="Auto-refreshes every 15 seconds">
              <span className="live-dot" aria-hidden="true" /> Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {error && <Alert type="error" message={error} />}

      {/* ── Admin workflow overview (Registration → … → Discharge) ── */}
      {role === 'admin' && (
        <>
          <h3 className="workflow-heading">Patient Workflow</h3>
          <WorkflowStepper stats={stats} />
        </>
      )}

      {/* ── Stat cards — admin only. Doctor/nurse/staff numbers render once,
          in their role section below (mini-stats + record lists). ── */}
      {/* Admin cards are read-only aggregates (oversight) — only Rooms, which
          admin can actually open, navigates. */}
      {role === 'admin' && (
        <div className="dashboard-grid">
          <StatCard icon={Users}      label="Total Patients"    value={stats?.total_patients    ?? 0} color="info"    />
          <StatCard icon={Building2}  label="Active Admissions" value={stats?.active_admissions  ?? 0} color="primary" />
          <StatCard icon={BedDouble}  label="Available Rooms"   value={stats?.available_rooms    ?? 0} color="success" onClick={() => navigate('/rooms')} />
          <StatCard icon={Repeat}     label="Pending Referrals" value={stats?.pending_referrals  ?? 0} color="warning" />
          <StatCard icon={Siren}      label="Today's Triages"   value={stats?.todays_triages     ?? 0} color="danger"  />
          <StatCard icon={Users}      label="Active Doctors"   value={stats?.total_doctors      ?? 0} color="info"    />
        </div>
      )}

      {/* ── Role-specific focus panel ── */}
      {role === 'doctor' && (
        <>
          <PendingAssignmentsPanel
            navigate={navigate}
            onResponded={() => {
              // Accepting/declining changes my patient set — refresh my-stats.
              getDashboardMyStats().then((r) => { if (r.success) setMyData(r.data); }).catch(() => {});
            }}
          />
          <DoctorPanel myData={myData} loading={loadMy} navigate={navigate} />
        </>
      )}
      {(role === 'nurse' || role === 'staff') && (
        <NurseStaffPanel myData={myData} loading={loadMy} navigate={navigate} />
      )}

      {/* ── Recent Activity (clinical roles only — admins see aggregates above) ── */}
      {role !== 'admin' && (
      <section className="activity-section">
        <h3 className="activity-section__heading">Recent Activity</h3>
        <div className="activity-grid">
          <ActivityPanel
            title="Recent Admissions" icon={<Building2 size={18} />} loading={loadAct}
            items={recentAdmissions} emptyMsg="No admissions recorded yet."
            renderItem={(a) => (
              <button key={a.admission_id} className="activity-item" onClick={() => navigate('/admissions')}>
                <div className="activity-item__avatar activity-item__avatar--admission"><BedDouble size={18} /></div>
                <div className="activity-item__body">
                  <p className="activity-item__name">{a.patient_name || 'Unknown Patient'}</p>
                  <p className="activity-item__meta">
                    {a.room_type && a.bed_number ? `${a.room_type} · Bed ${a.bed_number}` : 'Room TBD'}
                    {a.doctor_name ? ` · Dr. ${a.doctor_name}` : ''}
                  </p>
                </div>
                <div className="activity-item__right">
                  <Badge status={a.admission_status} />
                  <span className="activity-item__time">{timeAgo(a.admission_date)}</span>
                </div>
              </button>
            )}
          />
          {/* Referrals are clinical — doctors only */}
          {role === 'doctor' && (
            <ActivityPanel
              title="Recent Referrals" icon={<Repeat size={18} />} loading={loadAct}
              items={recentReferrals} emptyMsg="No referrals recorded yet."
              renderItem={(r) => (
                <button key={r.referral_id} className="activity-item" onClick={() => navigate('/referrals')}>
                  <div className="activity-item__avatar activity-item__avatar--referral"><Repeat size={18} /></div>
                  <div className="activity-item__body">
                    <p className="activity-item__name">{r.patient_name || 'Unknown Patient'}</p>
                    <p className="activity-item__meta">
                      {r.medical_condition ? `${r.medical_condition} · ` : ''}
                      {r.assigned_doctor_name ? `→ Dr. ${r.assigned_doctor_name}` : 'Unassigned'}
                    </p>
                  </div>
                  <div className="activity-item__right">
                    <Badge status={r.referral_status} />
                    <span className="activity-item__time">{timeAgo(r.referral_date)}</span>
                  </div>
                </button>
              )}
            />
          )}
        </div>
      </section>
      )}

      <div className="dashboard-footer">
        <p className="text-muted text-sm">
          {role === 'admin'
            ? 'Aggregate counts refresh automatically · Detailed clinical records are available to clinical staff only.'
            : 'Stats refresh on page load · Click any card or activity item to navigate.'}
        </p>
      </div>
    </div>
  );
};

export default DashboardPage;
