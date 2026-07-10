import { useEffect, useState } from 'react';
import { getMe, changePassword } from '../../api/auth.api';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS } from '../../utils/constants';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Alert from '../../components/ui/Alert';
import Spinner from '../../components/ui/Spinner';

const ProfilePage = () => {
  const { user } = useAuth();
  const [me,      setMe]      = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  // Change-password form
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd,     setNewPwd]     = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [saving,     setSaving]     = useState(false);

  useEffect(() => {
    getMe()
      .then((r) => { if (r.success) setMe(r.user); })
      .catch(() => setError('Failed to load profile.'))
      .finally(() => setLoading(false));
  }, []);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!currentPwd || !newPwd) { setError('Current and new password are required.'); return; }
    if (newPwd.length < 8)      { setError('New password must be at least 8 characters.'); return; }
    if (newPwd !== confirmPwd)  { setError('New password and confirmation do not match.'); return; }
    setError('');
    setSaving(true);
    try {
      const res = await changePassword({ current_password: currentPwd, new_password: newPwd });
      setSuccess(res.message || 'Password changed.');
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
    } catch (err) {
      setError(err.response?.data?.message || 'Password change failed.');
    } finally { setSaving(false); }
  };

  if (loading) return <Spinner />;
  if (!me) return <Alert type="error" message="Profile could not be loaded." />;

  const fullName = (me.first_name && me.last_name) ? `${me.first_name} ${me.last_name}` : me.username;
  const isDoctor = me.role === 'doctor';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-5)' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Profile</h1>
          <p className="page-subtitle">Account details and security</p>
        </div>
        <span className={`role-badge role-badge--${me.role}`}>{ROLE_LABELS[me.role] ?? me.role}</span>
      </div>

      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <Card title={isDoctor ? `Dr. ${fullName}` : fullName}>
        <div className="patient-info-grid">
          <div><span className="info-label">Username</span><span>{me.username}</span></div>
          <div><span className="info-label">Role</span><span>{ROLE_LABELS[me.role] ?? me.role}</span></div>
          {isDoctor && (
            <>
              <div><span className="info-label">Specialization</span><span>{me.specialization || 'General'}</span></div>
              <div><span className="info-label">ER-Assigned</span><span>{me.is_er_assigned ? 'Yes' : 'No'}</span></div>
              <div>
                <span className="info-label">Doctor-in-Charge</span>
                <span>{me.is_doctor_in_charge ? <Badge status="Completed" label="Enabled" /> : '—'}</span>
              </div>
            </>
          )}
          {(me.contact_details) && (
            <div><span className="info-label">Contact</span><span>{me.contact_details}</span></div>
          )}
          {me.employment_status && (
            <div><span className="info-label">Employment</span><span><Badge status={me.employment_status} /></span></div>
          )}
        </div>
        <p className="text-sm text-muted" style={{ marginTop:'var(--space-4)' }}>
          Identity details are managed by administrators in User Management.
        </p>
      </Card>

      <Card title="Change Password">
        <form onSubmit={handleChangePassword} noValidate style={{ maxWidth: '420px' }}>
          <div className="form-group">
            <label htmlFor="pf-current">Current Password *</label>
            <input
              id="pf-current" type="password" value={currentPwd}
              onChange={(e) => setCurrentPwd(e.target.value)}
              autoComplete="current-password" required
            />
          </div>
          <div className="form-group" style={{ marginTop:'var(--space-4)' }}>
            <label htmlFor="pf-new">New Password * <span className="text-xs text-muted">(min 8 characters)</span></label>
            <input
              id="pf-new" type="password" value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              autoComplete="new-password" required
            />
          </div>
          <div className="form-group" style={{ marginTop:'var(--space-4)' }}>
            <label htmlFor="pf-confirm">Confirm New Password *</label>
            <input
              id="pf-confirm" type="password" value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              autoComplete="new-password" required
            />
          </div>
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={saving}>Change Password</Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default ProfilePage;
