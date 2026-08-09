import { useState } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import PhilippineAddressPicker from './PhilippineAddressPicker';
import { PATIENT_SEX } from '../../utils/constants';
import { toInputDate } from '../../utils/formatDate';
import { isValidPHMobile, sanitizePHMobileInput } from '../../utils/validators';

// `disabled` locks every field and the submit button — used by the capacity
// control when the hospital has no available rooms.
const PatientForm = ({ initial = {}, onSubmit, loading, disabled = false }) => {
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
  // Phone fields accept digits only and cap at 11 as the user types/pastes
  const setPhone = (k) => (e) => setForm((f) => ({ ...f, [k]: sanitizePHMobileInput(e.target.value) }));

  // Fires only on user interaction with the picker, so opening an edit modal
  // and saving without touching the address preserves the stored string.
  const handleAddress = ({ composed, error: pickerError }) => {
    setAddressError(pickerError);
    setForm((f) => ({ ...f, address: composed }));
  };

  const today = new Date().toISOString().split('T')[0];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (disabled) return;
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
    // Both phone fields are optional, but a non-empty value must be a valid PH mobile
    if (form.contact_number && !isValidPHMobile(form.contact_number)) {
      setError('Contact number must be 11 digits starting with 09 (e.g., 09171234567).');
      return;
    }
    if (form.emergency_contact_number && !isValidPHMobile(form.emergency_contact_number)) {
      setError('Emergency contact number must be 11 digits starting with 09 (e.g., 09171234567).');
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
          <input id="pf-first" value={form.first_name} onChange={set('first_name')} placeholder="First name" required disabled={disabled} />
        </div>
        <div className="form-group">
          <label htmlFor="pf-last">Last Name *</label>
          <input id="pf-last" value={form.last_name} onChange={set('last_name')} placeholder="Last name" required disabled={disabled} />
        </div>
      </div>

      <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
        <div className="form-group">
          <label htmlFor="pf-sex">Sex *</label>
          <select id="pf-sex" value={form.sex} onChange={set('sex')} required disabled={disabled}>
            <option value="">Select sex</option>
            {PATIENT_SEX.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="pf-dob">Date of Birth *</label>
          <input id="pf-dob" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} max={today} required disabled={disabled} />
        </div>
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="pf-contact">Contact Number</label>
        {/* No native maxLength: it would truncate formatted pastes like "0912-345-6789"
            before sanitizePHMobileInput can strip the separators — the sanitizer caps at 11 */}
        <input id="pf-contact" value={form.contact_number} onChange={setPhone('contact_number')} placeholder="09XX XXX XXXX" inputMode="numeric" disabled={disabled} />
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <PhilippineAddressPicker value={initial.address ?? ''} onChange={handleAddress} disabled={disabled} />
      </div>

      <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
        <div className="form-group">
          <label htmlFor="pf-ecname">Emergency Contact Name</label>
          <input id="pf-ecname" value={form.emergency_contact_name} onChange={set('emergency_contact_name')} placeholder="Contact name" disabled={disabled} />
        </div>
        <div className="form-group">
          <label htmlFor="pf-ecnum">Emergency Contact Number</label>
          <input id="pf-ecnum" value={form.emergency_contact_number} onChange={setPhone('emergency_contact_number')} placeholder="09XX XXX XXXX" inputMode="numeric" disabled={disabled} />
        </div>
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading} disabled={disabled}>
          {initial.patient_id ? 'Update Patient' : 'Register Patient'}
        </Button>
      </div>
    </form>
  );
};

export default PatientForm;
