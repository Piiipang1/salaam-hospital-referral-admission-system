import { useState } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import { USER_ROLES } from '../../utils/constants';

const UserForm = ({ initial = {}, onSubmit, loading }) => {
  const [form, setForm] = useState({
    username:        initial.username        ?? '',
    password:        '',
    role:            initial.role            ?? '',
    first_name:      initial.first_name      ?? '',
    last_name:       initial.last_name       ?? '',
    specialization:  initial.specialization  ?? '',
    contact_details: initial.contact_details ?? '',
    // Alert destinations, held on the account itself — an admin has no person
    // record to hang them off, and these are what High/Emergency alerts use.
    email:           initial.email           ?? '',
    phone:           initial.phone           ?? '',
    alerts_opt_out:  !!initial.alerts_opt_out,
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isEdit = !!initial.user_id;

  // Person fields (first/last name, contact, specialization) only apply when
  // creating a new doctor/nurse account — editing a person record is out
  // of scope for this form, and admins have no person record at all.
  const showPersonFields = !isEdit && form.role !== 'admin' && form.role !== '';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.username || !form.role) { setError('Username and role are required.'); return; }
    if (!isEdit && !form.password) { setError('Password is required for new users.'); return; }
    if (showPersonFields && (!form.first_name || !form.last_name)) {
      setError('First name and last name are required.');
      return;
    }
    setError('');
    const payload = { username: form.username, role: form.role };
    if (form.password) payload.password = form.password;
    if (showPersonFields) {
      payload.first_name      = form.first_name;
      payload.last_name       = form.last_name;
      payload.contact_details = form.contact_details;
      if (form.role === 'doctor') payload.specialization = form.specialization;
    }
    // Contact details are editable on an existing account; the API validates
    // them and an empty string clears the field.
    if (isEdit) {
      payload.email          = form.email.trim();
      payload.phone          = form.phone.trim();
      payload.alerts_opt_out = form.alerts_opt_out ? 1 : 0;
    }
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="uf-uname">Username *</label>
          <input id="uf-uname" value={form.username} onChange={set('username')} placeholder="Username" required />
        </div>
        <div className="form-group">
          <label htmlFor="uf-role">Role *</label>
          {/* Role is immutable after creation — the backend rejects role changes
              (they desync linked_id). Show it read-only when editing. */}
          <select id="uf-role" value={form.role} onChange={set('role')} required disabled={isEdit}>
            <option value="">Select role</option>
            {USER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {isEdit && (
            <p className="text-xs text-muted" style={{ marginTop: 'var(--space-1)' }}>
              Role can't be changed. Deactivate and create a new account instead.
            </p>
          )}
        </div>
      </div>
      <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
        <div className="form-group">
          <label htmlFor="uf-pwd">Password {isEdit ? '(leave blank to keep current)' : '*'}</label>
          <input id="uf-pwd" type="password" value={form.password} onChange={set('password')} placeholder={isEdit ? 'New password (optional)' : 'Set password'} />
        </div>
      </div>

      {showPersonFields && (
        <>
          <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
            <div className="form-group">
              <label htmlFor="uf-fname">First Name *</label>
              <input id="uf-fname" value={form.first_name} onChange={set('first_name')} placeholder="First name" required />
            </div>
            <div className="form-group">
              <label htmlFor="uf-lname">Last Name *</label>
              <input id="uf-lname" value={form.last_name} onChange={set('last_name')} placeholder="Last name" required />
            </div>
          </div>
          <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
            <div className="form-group">
              <label htmlFor="uf-contact">Contact Details</label>
              <input id="uf-contact" value={form.contact_details} onChange={set('contact_details')} placeholder="Phone or email" />
            </div>
            {form.role === 'doctor' && (
              <div className="form-group">
                <label htmlFor="uf-spec">Specialization</label>
                <input id="uf-spec" value={form.specialization} onChange={set('specialization')} placeholder="e.g. Internal Medicine" />
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Alert contact details (existing accounts) ────────────────────
          High and Emergency alerts are mirrored to these. An account with
          neither is reachable in-app only, which is what the hint says
          plainly rather than leaving the gap invisible. */}
      {isEdit && (
        <div style={{ marginTop: 'var(--space-5)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
          <p style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-3)' }}>
            Alert Contact
          </p>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="uf-email">Email</label>
              <input id="uf-email" type="email" value={form.email} onChange={set('email')}
                placeholder="name@hospital.org" autoComplete="off" />
            </div>
            <div className="form-group">
              <label htmlFor="uf-phone">Mobile Number</label>
              <input id="uf-phone" value={form.phone} onChange={set('phone')}
                placeholder="09171234567" autoComplete="off" />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.alerts_opt_out} style={{ width: 'auto', margin: 0 }}
              onChange={(e) => setForm((f) => ({ ...f, alerts_opt_out: e.target.checked }))} />
            <span style={{ fontSize: 'var(--font-size-sm)' }}>
              Do not send email/SMS alerts to this account (in-app notifications still apply)
            </span>
          </label>
          {!form.email.trim() && !form.phone.trim() && !form.alerts_opt_out && (
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)', marginTop: 'var(--space-2)' }}>
              No email or mobile on file — this account will only ever see alerts inside the app.
            </p>
          )}
        </div>
      )}

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading}>
          {isEdit ? 'Update User' : 'Create User'}
        </Button>
      </div>
    </form>
  );
};

export default UserForm;
