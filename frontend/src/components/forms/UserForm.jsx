import { useState } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import { USER_ROLES } from '../../utils/constants';

const UserForm = ({ initial = {}, onSubmit, loading }) => {
  const [form, setForm] = useState({
    username:   initial.username  ?? '',
    password:   '',
    role:       initial.role      ?? '',
    linked_id:  initial.linked_id ?? '',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isEdit = !!initial.user_id;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.username || !form.role) { setError('Username and role are required.'); return; }
    if (!isEdit && !form.password) { setError('Password is required for new users.'); return; }
    setError('');
    const payload = { username: form.username, role: form.role };
    if (form.linked_id) payload.linked_id = Number(form.linked_id);
    if (form.password)  payload.password  = form.password;
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
        {form.role !== 'admin' && (
          <div className="form-group">
            <label htmlFor="uf-linked">Linked ID (Doctor / Employee)</label>
            <input id="uf-linked" type="number" value={form.linked_id} onChange={set('linked_id')} placeholder="doctor_id or employee_id" />
          </div>
        )}
      </div>
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading}>
          {isEdit ? 'Update User' : 'Create User'}
        </Button>
      </div>
    </form>
  );
};

export default UserForm;
