import { useState } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import PhilippineAddressPicker from './PhilippineAddressPicker';
import { PATIENT_SEX } from '../../utils/constants';
import { toInputDate } from '../../utils/formatDate';

const PatientForm = ({ initial = {}, onSubmit, loading }) => {
  const [form, setForm] = useState({
    first_name:               initial.first_name ?? '',
    last_name:                initial.last_name  ?? '',
    sex:                      initial.sex         ?? '',
    date_of_birth:            initial.date_of_birth ? toInputDate(initial.date_of_birth) : '',
    contact_number:           initial.contact_number           ?? '',
    address:                  initial.address                  ?? '',
    emergency_contact_name:   initial.emergency_contact_name   ?? '',
    emergency_contact_number: initial.emergency_contact_number ?? '',
  });
  const [error, setError] = useState('');
  // Set only while the cascading picker is partially filled (address itself
  // stays optional) — blocks submit until the levels are consistent.
  const [addressError, setAddressError] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Fires only on user interaction with the picker, so opening an edit modal
  // and saving without touching the address preserves the stored string.
  const handleAddress = ({ composed, error: pickerError }) => {
    setAddressError(pickerError);
    setForm((f) => ({ ...f, address: composed }));
  };

  const today = new Date().toISOString().split('T')[0];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.first_name || !form.last_name || !form.sex || !form.date_of_birth) {
      setError('First name, last name, sex, and date of birth are required.');
      return;
    }
    if (form.date_of_birth > today) {
      setError('Date of birth cannot be in the future.');
      return;
    }
    if (addressError) {
      setError(addressError);
      return;
    }
    setError('');
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="pf-first">First Name *</label>
          <input id="pf-first" value={form.first_name} onChange={set('first_name')} placeholder="First name" required />
        </div>
        <div className="form-group">
          <label htmlFor="pf-last">Last Name *</label>
          <input id="pf-last" value={form.last_name} onChange={set('last_name')} placeholder="Last name" required />
        </div>
      </div>

      <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
        <div className="form-group">
          <label htmlFor="pf-sex">Sex *</label>
          <select id="pf-sex" value={form.sex} onChange={set('sex')} required>
            <option value="">Select sex</option>
            {PATIENT_SEX.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="pf-dob">Date of Birth *</label>
          <input id="pf-dob" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} max={today} required />
        </div>
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="pf-contact">Contact Number</label>
        <input id="pf-contact" value={form.contact_number} onChange={set('contact_number')} placeholder="09XX XXX XXXX" />
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <PhilippineAddressPicker value={initial.address ?? ''} onChange={handleAddress} />
      </div>

      <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
        <div className="form-group">
          <label htmlFor="pf-ecname">Emergency Contact Name</label>
          <input id="pf-ecname" value={form.emergency_contact_name} onChange={set('emergency_contact_name')} placeholder="Contact name" />
        </div>
        <div className="form-group">
          <label htmlFor="pf-ecnum">Emergency Contact Number</label>
          <input id="pf-ecnum" value={form.emergency_contact_number} onChange={set('emergency_contact_number')} placeholder="09XX XXX XXXX" />
        </div>
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading}>
          {initial.patient_id ? 'Update Patient' : 'Register Patient'}
        </Button>
      </div>
    </form>
  );
};

export default PatientForm;
