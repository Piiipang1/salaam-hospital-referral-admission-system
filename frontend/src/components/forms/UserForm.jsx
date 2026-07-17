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
    is_er_assigned:  !!initial.is_er_assigned,
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isEdit = !!initial.user_id;

  // Person fields (first/last name, contact, specialization) only apply when
  // creating a new doctor/nurse/staff account — editing a person record is out
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
    if (form.role === 'doctor') payload.is_er_assigned = form.is_er_assigned;
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
          <select id="uf-role" value={form.role} onChange={set('role')} required>
            <option value="">Select role</option>
            {USER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>
      <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
        <div className="form-group">
          <label htmlFor="uf-pwd">Password {isEdit ? '(leave blank to keep current)' : '*'}</label>
          <input id="uf-pwd" type="password" value={form.password} onChange={set('password')} placeholder={isEdit ? 'New password (optional)' : 'Set password'} />
        </div>
      </div>

      {form.role === 'doctor' && (
        initial.is_doctor_in_charge ? (
          /* DICs are ER-assigned by definition — the toggle is meaningless for
             them, so show a note instead. is_er_assigned still submits with its
             stored value (no behavior change). */
          <p className="text-sm text-muted" style={{ marginTop: 'var(--space-4)' }}>
            Doctor-in-Charge — ER-assigned by definition.
          </p>
        ) : (
          <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
              <input
                id="uf-er"
                type="checkbox"
                checked={form.is_er_assigned}
                onChange={(e) => setForm((f) => ({ ...f, is_er_assigned: e.target.checked }))}
                style={{ width: 'auto' }}
              />
              ER-assigned (may admit patients)
            </label>
          </div>
        )
      )}

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

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading}>
          {isEdit ? 'Update User' : 'Create User'}
        </Button>
      </div>
    </form>
  );
};

export default UserForm;
