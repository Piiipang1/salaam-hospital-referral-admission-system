import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileText, Image, Paperclip, FlaskConical, ClipboardList } from 'lucide-react';
import { getPatientById, getPatientHistory, updatePatient } from '../../api/patients.api';
import { createTriage, assignTriageDoctor } from '../../api/triages.api';
import { cancelAssignment } from '../../api/assignments.api';
import { getActiveDoctors } from '../../api/doctors.api';
import { createDiagnosis, addLabResult, addTreatment, getAssessment, saveAssessment } from '../../api/diagnoses.api';
import { createReferral } from '../../api/referrals.api';
import { createAdmission } from '../../api/admissions.api';
import { useAuth } from '../../context/AuthContext';
import { canManagePatients, canDiagnose, canManageTriage, canCreateReferral, canUserAdmit, canUploadLabResult } from '../../utils/roleGuard';
import { formatDate } from '../../utils/formatDate';
import { formatPatientAge, formatPatientDob, formatPatientSex } from '../../utils/patientLabels';
import Badge from '../../components/ui/Badge';
import UnidentifiedBadge from '../../components/ui/UnidentifiedBadge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import Alert from '../../components/ui/Alert';
import PatientForm from '../../components/forms/PatientForm';
import TriageForm from '../../components/forms/TriageForm';
import DiagnosisForm from '../../components/forms/DiagnosisForm';
import ReferralForm from '../../components/forms/ReferralForm';
import AdmissionForm from '../../components/forms/AdmissionForm';
import VitalSignsForm from '../../components/forms/VitalSignsForm';
import TreatmentForm from '../../components/forms/TreatmentForm';
import DoctorAssessmentForm from '../../components/forms/DoctorAssessmentForm';
import { addVitalSigns } from '../../api/triages.api';
import './PatientDetailPage.css';

const TABS = ['Triage', 'Diagnoses', 'Treatment Plan', 'Referrals', 'Admissions', 'Documents'];


// Build the public URL for an uploaded file
const fileUrl = (filename) =>
  `${import.meta.env.VITE_API_URL || ''}/uploads/${filename}`;

// Pick a readable icon based on file extension
const fileIcon = (filename = '') => {
  if (!filename) return Paperclip;
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'pdf') return FileText;
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return Image;
  return Paperclip;
};

const PatientDetailPage = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [patient,  setPatient]  = useState(null);
  const [history,  setHistory]  = useState({});
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState('Triage');
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');
  const [modal,    setModal]    = useState(null); // 'edit'|'triage'|'diagnosis'|'referral'|'admission'|'vitals'
  const [saving,   setSaving]   = useState(false);
  // Triage reads are hospital-wide for nurses/staff but patient registration
  // records stay scoped to the registering nurse — a 403 here is expected, not a bug.
  const [accessDenied, setAccessDenied] = useState(false);
  const [vitalTriageId, setVitalTriageId] = useState(null);

  // Attending-doctor assignment (Doctor-in-Charge only). Reuses the existing
  // assignTriageDoctor endpoint, keyed by the patient's latest triage_id taken
  // from the already-loaded history — no new backend surface, no extra fetch.
  const [assignOpen,     setAssignOpen]     = useState(false);
  const [assignDoctorId, setAssignDoctorId] = useState('');
  const [assignSaving,   setAssignSaving]   = useState(false);
  const [assignDoctors,  setAssignDoctors]  = useState([]);

  // Doctor assessment (disposition + clinical notes) for the patient's latest diagnosis
  const [assessment, setAssessment] = useState(null);

  // Lab result upload state (per-diagnosis, from Diagnoses tab)
  const [labModal,       setLabModal]       = useState(false);
  const [labDiagnosisId, setLabDiagnosisId] = useState(null);
  const [labTestType,    setLabTestType]    = useState('');
  const [labFile,        setLabFile]        = useState(null);
  const [labFileName,    setLabFileName]    = useState('');
  const [labSaving,      setLabSaving]      = useState(false);
  const [labError,       setLabError]       = useState('');
  const labFileRef = useRef(null);

  const load = () => {
    setLoading(true);
    Promise.all([getPatientById(id), getPatientHistory(id)])
      .then(([pRes, hRes]) => {
        if (pRes.success) setPatient(pRes.data);
        if (hRes.success) {
          setHistory(hRes.data);
          const latestDiagnosisId = hRes.data.diagnoses?.[0]?.diagnosis_id;
          if (latestDiagnosisId) {
            getAssessment(latestDiagnosisId)
              .then((aRes) => { if (aRes.success) setAssessment(aRes.data); })
              .catch(() => {});
          } else {
            setAssessment(null);
          }
        }
      })
      .catch((err) => {
        if (err.response?.status === 403) setAccessDenied(true);
        else setError('Failed to load patient data.');
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [id]);

  const act = (fn) => async (data) => {
    setSaving(true);
    try {
      const result = await fn(data);
      setSuccess('Saved successfully.');
      setModal(null);
      load();
      return result; // propagate so callers (DiagnosisForm) can read diagnosis_id
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed.');
      throw err;
    } finally { setSaving(false); }
  };

  const openLabModal = (diagnosisId) => {
    setLabDiagnosisId(diagnosisId);
    setLabTestType('');
    setLabFile(null);
    setLabFileName('');
    setLabError('');
    setLabModal(true);
  };

  const handleLabFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) { setLabFile(null); setLabFileName(''); return; }
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      setLabError('Only PDF and image files (JPG, PNG, WebP, GIF) are allowed.');
      e.target.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setLabError('File size must not exceed 10 MB.');
      e.target.value = '';
      return;
    }
    setLabError('');
    setLabFile(file);
    setLabFileName(file.name);
  };

  const handleLabSubmit = async (e) => {
    e.preventDefault();
    if (!labTestType.trim()) { setLabError('Test type is required.'); return; }
    if (!labFile)            { setLabError('Please choose a file.'); return; }
    setLabSaving(true);
    setLabError('');
    try {
      const fd = new FormData();
      fd.append('file_attachment', labFile);
      fd.append('patient_id', String(id));
      fd.append('test_type',  labTestType.trim());
      await addLabResult(labDiagnosisId, fd);
      setSuccess('Lab result uploaded successfully.');
      setLabModal(false);
      load();
    } catch (err) {
      setLabError(err.response?.data?.message || 'Upload failed.');
    } finally {
      setLabSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (accessDenied) {
    return (
      <div className="patient-detail">
        <button className="back-link" onClick={() => navigate(-1)}>← Back</button>
        <Alert
          type="warning"
          message="You don't have access to this patient's registration record — it was registered by another staff member."
        />
      </div>
    );
  }
  if (!patient) return <Alert type="error" message="Patient not found." />;

  // Placeholder sentinel values used by createEmergencyTriage — clear them so
  // the Complete Registration form opens with empty fields for real input.
  const cleanedForRegistration = {
    ...patient,
    first_name:    patient.first_name === 'Unknown' ? '' : patient.first_name,
    last_name:     /^Patient-\d/.test(patient.last_name ?? '') ? '' : patient.last_name,
    sex:           patient.sex === 'Other' ? '' : patient.sex,
    date_of_birth: String(patient.date_of_birth ?? '').startsWith('1900') ? '' : patient.date_of_birth,
  };

  const triages   = history.triages   ?? [];
  const diagnoses = history.diagnoses ?? [];
  const referrals = history.referrals ?? [];
  const admissions= history.admissions?? [];

  // assignTriageDoctor is keyed by triage_id, so assignment needs a triage —
  // which matches the precondition (a patient is triaged before being routed to
  // an attending doctor). history.triages is ordered newest-first.
  const latestTriageId = triages[0]?.triage_id ?? null;
  // Only a Doctor-in-Charge may assign; the backend 403s admins and non-DIC doctors.
  const canAssignAttending =
    user?.role === 'doctor' && !!user?.is_doctor_in_charge && !!latestTriageId;

  const openAssignAttending = () => {
    setAssignDoctorId('');
    setAssignOpen(true);
    if (assignDoctors.length === 0) {
      getActiveDoctors().then((r) => { if (r.success) setAssignDoctors(r.data); }).catch(() => {});
    }
  };

  const handleAssignAttending = async () => {
    if (!assignDoctorId || !latestTriageId) return;
    setAssignSaving(true);
    try {
      const res = await assignTriageDoctor(latestTriageId, assignDoctorId);
      setSuccess(res.message || 'Attending doctor updated.');
      setAssignOpen(false);
      load(); // refresh so the Attending Doctor field reflects the change
    } catch (err) {
      setError(err.response?.data?.message || 'Assignment failed.');
      setAssignOpen(false);
    } finally { setAssignSaving(false); }
  };

  // Pending = a proposal awaiting the proposed doctor's acceptance.
  const hasPendingAssignment = patient?.assignment_status === 'Pending';

  const handleCancelAssignment = async () => {
    try {
      const res = await cancelAssignment(id);
      setSuccess(res.message || 'Assignment proposal cancelled.');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Cancel failed.');
      load(); // may have been accepted/declined meanwhile — refresh either way
    }
  };
  const treatments = diagnoses.flatMap((d) =>
    (d.treatments ?? []).map((tx) => ({ ...tx, medical_condition: d.medical_condition }))
  );
  const latestDiagnosis = diagnoses[0] ?? null;

  const handleAddTreatment = (data) => addTreatment(data.diagnosis_id, data);

  return (
    <div className="patient-detail">
      <button className="back-link" onClick={() => navigate('/patients')}>← Back to Patients</button>

      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      {/* Unidentified patient banner */}
      {patient.is_unidentified ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 'var(--space-4)', padding: 'var(--space-4) var(--space-5)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-danger-muted)', border: '1px solid var(--color-danger)',
          color: 'var(--color-danger)',
        }}>
          <span style={{ fontWeight: 500 }}>
            ⚠ This is an unidentified emergency patient. Complete registration when identity is known.
          </span>
          {canManagePatients(user?.role) && (
            <Button size="sm" variant="danger" onClick={() => setModal('complete-registration')}>
              Complete Registration
            </Button>
          )}
        </div>
      ) : null}

      {/* Pending attending-doctor assignment banner */}
      {hasPendingAssignment ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 'var(--space-4)', padding: 'var(--space-4) var(--space-5)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-warning-muted, #fef3c7)', border: '1px solid var(--color-warning, #d97706)',
          color: 'var(--color-warning, #92400e)',
        }}>
          <span style={{ fontWeight: 500 }}>
            ⏳ Attending-doctor assignment awaiting acceptance by {patient.attending_doctor_name || 'the proposed doctor'}.
          </span>
          {canAssignAttending && (
            <Button size="sm" variant="outline" onClick={handleCancelAssignment}>
              Cancel Proposal
            </Button>
          )}
        </div>
      ) : null}

      {/* Patient info card */}
      <Card
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {patient.first_name} {patient.last_name}
            {patient.is_unidentified ? <UnidentifiedBadge /> : null}
          </span>
        }
        action={
          canManagePatients(user?.role) && (
            <Button size="sm" variant="outline" onClick={() => setModal('edit')}>Edit Info</Button>
          )
        }
      >
        <div className="patient-info-grid">
          <div><span className="info-label">Sex</span><span>{formatPatientSex(patient)}</span></div>
          <div><span className="info-label">Age</span><span>{(() => { const a = formatPatientAge(patient); return /^\d+$/.test(a) ? `${a} yrs` : a; })()}</span></div>
          <div><span className="info-label">Date of Birth</span><span>{formatPatientDob(patient)}</span></div>
          {/* Attending doctor = the patient's primary doctor (doctor_in_charge),
              proposed by a Doctor-in-Charge at triage and confirmed by the
              doctor's acceptance. Distinct from the admitting doctor below and
              from any specialist referral. */}
          <div>
            <span className="info-label">Attending Doctor</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {hasPendingAssignment
                ? <span style={{ color: 'var(--color-warning, #d97706)' }}>
                    {patient.attending_doctor_id === user?.linked_id
                      ? 'Awaiting your acceptance'
                      : `Awaiting acceptance — ${patient.attending_doctor_name || 'proposed doctor'}`}
                  </span>
                : patient.attending_doctor_id
                  ? (patient.attending_doctor_id === user?.linked_id ? 'You (attending)' : patient.attending_doctor_name)
                  : 'Not assigned'}
              {canAssignAttending && (hasPendingAssignment ? (
                <button
                  onClick={handleCancelAssignment}
                  title="Withdraw this proposal — the patient returns to the coordination queue"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                           color: 'var(--color-danger)', fontSize: 'var(--font-size-xs)', textDecoration: 'underline' }}
                >
                  Cancel
                </button>
              ) : (
                <button
                  onClick={openAssignAttending}
                  title="Set this patient's attending doctor (their primary doctor — not a specialist referral)"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                           color: 'var(--color-primary)', fontSize: 'var(--font-size-xs)', textDecoration: 'underline' }}
                >
                  {patient.attending_doctor_id ? 'Reassign' : 'Assign'}
                </button>
              ))}
            </span>
          </div>
          <div><span className="info-label">Admitting Doctor</span><span>{patient.admitting_doctor ? `Dr. ${patient.admitting_doctor}` : '—'}</span></div>
          <div><span className="info-label">Room</span><span>{patient.room_type ? `${patient.room_type} — ${patient.bed_number}` : patient.admission_status === 'Pending Room' ? 'Awaiting room' : '—'}</span></div>
          <div><span className="info-label">Contact</span><span>{patient.contact_number || '—'}</span></div>
          <div><span className="info-label">Address</span><span>{patient.address || '—'}</span></div>
          <div><span className="info-label">Emergency Contact</span><span>{patient.emergency_contact_name || '—'}</span></div>
          <div><span className="info-label">Emergency Number</span><span>{patient.emergency_contact_number || '—'}</span></div>
          <div><span className="info-label">Registered</span><span>{formatDate(patient.created_at)}</span></div>
        </div>
      </Card>

      {/* Action buttons */}
      <div className="patient-actions">
        {canManageTriage(user?.role) && <Button size="sm" variant="primary" onClick={() => setModal('triage')}>+ Triage</Button>}
        {canDiagnose(user?.role) && <Button size="sm" variant="primary" onClick={() => setModal('diagnosis')}>+ Diagnosis</Button>}
        {canCreateReferral(user?.role) && <Button size="sm" variant="secondary" onClick={() => setModal('referral')}>+ Referral</Button>}
        {canUserAdmit(user) && <Button size="sm" variant="secondary" onClick={() => setModal('admission')}>+ Admission</Button>}
      </div>

      {/* Tabs */}
      <div className="detail-tabs">
        {TABS.map((t) => (
          <button key={t} className={`detail-tab${tab === t ? ' detail-tab--active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'Triage' && (
        <div className="detail-list">
          {triages.length === 0 ? <p className="text-muted">No triage records.</p> : triages.map((t) => (
            <Card key={t.triage_id} className="detail-item">
              <div className="detail-item__header">
                <div className="flex items-center gap-2">
                  <Badge status={t.triage_level} />
                  <span className="text-sm text-muted">{formatDate(t.triage_datetime, true)}</span>
                </div>
                {canManageTriage(user?.role) && (
                  <Button size="sm" variant="ghost" onClick={() => { setVitalTriageId(t.triage_id); setModal('vitals'); }}>+ Vitals</Button>
                )}
              </div>
              <p className="text-sm" style={{ marginTop:'var(--space-3)' }}>{t.notes || '—'}</p>
              {t.blood_pressure && (
                <div className="vitals-grid">
                  <span>BP: {t.blood_pressure}</span>
                  <span>HR: {t.heart_rate} bpm</span>
                  <span>Temp: {t.temperature}°C</span>
                  <span>RR: {t.respiratory_rate}/min</span>
                  <span>Recorded: {formatDate(t.vitals_recorded_at, true)}</span>
                  {t.vitals_updated_at && <span>Updated: {formatDate(t.vitals_updated_at, true)}</span>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {tab === 'Diagnoses' && (
        <div className="detail-list">
          {diagnoses.length === 0 ? <p className="text-muted">No diagnoses.</p> : diagnoses.map((d) => (
            <Card key={d.diagnosis_id} className="detail-item">
              <div className="detail-item__header">
                <p className="font-semibold">{d.medical_condition}</p>
                {canUploadLabResult(user?.role) && (
                  <Button size="sm" variant="ghost" onClick={() => openLabModal(d.diagnosis_id)}>+ Lab Result</Button>
                )}
              </div>
              <p className="text-sm text-muted">Date: {formatDate(d.diagnosis_date)}</p>
              {d.treatments?.length > 0 && (
                <div style={{ marginTop:'var(--space-3)' }}>
                  <p className="text-sm font-medium" style={{ marginBottom:'var(--space-2)' }}>Treatments:</p>
                  {d.treatments.map((tx) => (
                    <p key={tx.treatment_id} className="text-sm text-muted">
                      {tx.prescribed_medications} — {tx.dosage}, {tx.frequency}, {tx.treatment_duration}
                    </p>
                  ))}
                </div>
              )}
              {d.lab_results?.length > 0 && (
                <div className="lab-results-section">
                  <p className="text-sm font-medium lab-results-heading">Lab Results:</p>
                  <div className="lab-results-list">
                    {d.lab_results.map((lr) => {
                      const LrIcon = fileIcon(lr.file_attachment);
                      return (
                      <div key={lr.lab_result_id} className="lab-result-item">
                        <span className="lab-result-icon">
                          <LrIcon size={16} />
                        </span>
                        <div className="lab-result-info">
                          <a
                            href={`${import.meta.env.VITE_API_URL || ''}/uploads/${lr.file_attachment}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="lab-result-link"
                          >
                            {lr.test_type || 'Lab Result'}
                          </a>
                          {lr.results && <p className="text-xs text-muted">{lr.results}</p>}
                          {lr.date_conducted && (
                            <p className="text-xs text-muted">{formatDate(lr.date_conducted)}</p>
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {tab === 'Treatment Plan' && (
        <div className="detail-list">
          {/* ── Doctor Assessment (disposition + clinical notes) ── */}
          <Card className="detail-item">
            <div className="detail-item__header">
              <span className="font-semibold">Doctor Assessment</span>
              {canDiagnose(user?.role) && latestDiagnosis && (
                <Button size="sm" variant="ghost" onClick={() => setModal('assessment')}>
                  {assessment ? 'Update Assessment' : 'Add Assessment'}
                </Button>
              )}
            </div>
            {!latestDiagnosis ? (
              <p className="text-sm text-muted">No diagnosis recorded yet.</p>
            ) : assessment ? (
              <>
                <div className="flex items-center gap-2" style={{ marginTop: 'var(--space-2)' }}>
                  <Badge status={assessment.disposition} />
                  <span className="text-sm text-muted">{formatDate(assessment.assessed_at, true)}</span>
                </div>
                <p className="text-sm" style={{ marginTop: 'var(--space-3)' }}>{assessment.clinical_notes || '—'}</p>
              </>
            ) : (
              <p className="text-sm text-muted">No assessment recorded yet.</p>
            )}
          </Card>

          {canDiagnose(user?.role) && (
            <div className="patient-actions" style={{ marginBottom: 'var(--space-2)' }}>
              <Button size="sm" variant="primary" onClick={() => setModal('treatment')}>+ Add Treatment</Button>
            </div>
          )}
          {treatments.length === 0 ? <p className="text-muted">No treatment records.</p> : treatments.map((tx) => (
            <Card key={tx.treatment_id} className="detail-item">
              <div className="detail-item__header">
                <span className="font-semibold">{tx.prescribed_medications}</span>
              </div>
              <p className="text-sm text-muted">Diagnosis: {tx.medical_condition || '—'}</p>
              <p className="text-sm text-muted">Dosage: {tx.dosage || '—'}</p>
              <p className="text-sm text-muted">Frequency: {tx.frequency || '—'}</p>
              <p className="text-sm text-muted">Duration: {tx.treatment_duration || '—'}</p>
            </Card>
          ))}
        </div>
      )}

      {tab === 'Referrals' && (
        <div className="detail-list">
          {referrals.length === 0 ? <p className="text-muted">No referral history.</p> : referrals.map((r) => {
            const RefFileIcon = fileIcon(r.file_attachment);
            return (
            <Card key={r.referral_id} className="detail-item">
              <div className="detail-item__header">
                <span>Referral — {formatDate(r.referral_date)}</span>
                <Badge status={r.status} />
              </div>
              <p className="text-sm text-muted">Date: {formatDate(r.referral_date, true)}</p>
              <p className="text-sm text-muted">
                Referred by: {r.referring_doctor_name ? `Dr. ${r.referring_doctor_name} (${r.referring_specialization || 'General'})` : '—'}
              </p>
              {r.assigned_doctor_name && (
                <p className="text-sm text-muted">Refer to: {r.assigned_doctor_name} ({r.specialization || 'General'})</p>
              )}
              {r.medical_condition && (
                <p className="text-sm text-muted">Condition: {r.medical_condition}</p>
              )}
              {/* Attached referral document */}
              {r.file_attachment && (
                <div className="lab-results-section" style={{ marginTop: 'var(--space-3)' }}>
                  <div className="lab-result-item">
                    <span className="lab-result-icon"><RefFileIcon size={16} /></span>
                    <div className="lab-result-info">
                      <a
                        href={fileUrl(r.file_attachment)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="lab-result-link"
                      >
                        Referral Document
                      </a>
                      <p className="text-xs text-muted">{r.file_attachment.split('-').slice(2).join('-')}</p>
                    </div>
                  </div>
                </div>
              )}
              {/* Doctor's e-signature */}
              <div className="lab-upload-section">
                <p className="lab-upload-heading">Doctor&apos;s Signature</p>
                {r.e_signature ? (
                  <img src={r.e_signature} alt="Doctor's signature" className="signature-canvas" />
                ) : (
                  <p className="text-sm text-muted">No signature on file.</p>
                )}
              </div>
            </Card>
            );
          })}
        </div>
      )}

      {tab === 'Admissions' && (
        <div className="detail-list">
          {admissions.length === 0 ? <p className="text-muted">No admission records.</p> : admissions.map((a) => (
            <Card key={a.admission_id} className="detail-item">
              <div className="detail-item__header">
                <span>{a.admission_type} — Room {a.bed_number}</span>
                <Badge status={a.status} />
              </div>
              <p className="text-sm text-muted">Admitted: {formatDate(a.admission_date, true)}</p>
              {a.discharge_date && <p className="text-sm text-muted">Discharged: {formatDate(a.discharge_date, true)}</p>}
            </Card>
          ))}
        </div>
      )}

      {/* ── Documents tab — all files across lab results and referrals ── */}
      {tab === 'Documents' && (() => {
        // Collect all lab result files from every diagnosis
        const labDocs = diagnoses.flatMap((d) =>
          (d.lab_results ?? []).filter((lr) => lr.file_attachment).map((lr) => ({
            key:       `lab-${lr.lab_result_id}`,
            icon:      fileIcon(lr.file_attachment),
            label:     lr.test_type || 'Lab Result',
            filename:  lr.file_attachment,
            date:      lr.date_conducted,
            source:    `Diagnosis (${formatDate(d.diagnosis_date)}) — ${d.medical_condition}`,
            sourceTag: <><FlaskConical size={14} /> Lab Result</>,
          }))
        );

        // Collect all referral attachments
        const refDocs = referrals.filter((r) => r.file_attachment).map((r) => ({
          key:       `ref-${r.referral_id}`,
          icon:      fileIcon(r.file_attachment),
          label:     'Referral Document',
          filename:  r.file_attachment,
          date:      r.referral_date,
          source:    `Referral (${formatDate(r.referral_date)})${r.assigned_doctor_name ? ` → ${r.assigned_doctor_name}` : ''}`,
          sourceTag: <><ClipboardList size={14} /> Referral</>,
        }));

        const allDocs = [...labDocs, ...refDocs].sort(
          (a, b) => new Date(b.date) - new Date(a.date)
        );

        if (allDocs.length === 0) {
          return <p className="text-muted">No documents uploaded for this patient.</p>;
        }

        return (
          <div className="lab-results-list">
            {allDocs.map((doc) => (
              <div key={doc.key} className="lab-result-item">
                <span className="lab-result-icon"><doc.icon size={16} /></span>
                <div className="lab-result-info" style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <a
                      href={fileUrl(doc.filename)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lab-result-link"
                    >
                      {doc.label}
                    </a>
                    <span style={{
                      fontSize: 'var(--font-size-xs)',
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--color-surface-2)',
                      color: 'var(--color-text-muted)',
                      border: '1px solid var(--color-border)',
                      whiteSpace: 'nowrap',
                    }}>
                      {doc.sourceTag}
                    </span>
                  </div>
                  <p className="text-xs text-muted">{doc.source}</p>
                  {doc.date && <p className="text-xs text-muted">{formatDate(doc.date)}</p>}
                </div>
                <a
                  href={fileUrl(doc.filename)}
                  download
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                    padding: 'var(--space-1) var(--space-3)',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-muted)',
                    fontSize: 'var(--font-size-xs)',
                    textDecoration: 'none',
                    flexShrink: 0,
                    transition: 'border-color var(--transition-fast), color var(--transition-fast)',
                  }}
                  title="Download file"
                >
                  ⬇ Download
                </a>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Modals */}
      {/* Assign/reassign the ATTENDING doctor (Doctor-in-Charge only). Same
          operation as the Triage page — a patient-level routing decision, not a referral. */}
      <Modal isOpen={assignOpen} onClose={() => setAssignOpen(false)} title="Assign Attending Doctor" size="sm">
        <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-4)' }}>
          Set the <strong>attending doctor</strong> for <strong>{patient.first_name} {patient.last_name}</strong> —
          the doctor who takes primary responsibility for this patient&apos;s care.
          This is ER routing, <em>not</em> a referral: referring to a specialist is done from a
          diagnosis on the Referrals page and has its own Pending → Accepted → Completed lifecycle.
        </p>
        <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
          <label htmlFor="pd-assign-doctor">Attending doctor *</label>
          <select id="pd-assign-doctor" value={assignDoctorId} onChange={(e) => setAssignDoctorId(e.target.value)} required>
            <option value="">— Select doctor —</option>
            {assignDoctors.map((d) => (
              <option key={d.doctor_id} value={d.doctor_id}>
                Dr. {d.first_name} {d.last_name}{d.specialization ? ` (${d.specialization})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setAssignOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleAssignAttending} loading={assignSaving} disabled={!assignDoctorId}>Assign</Button>
        </div>
      </Modal>
      <Modal isOpen={modal === 'edit'}      onClose={() => setModal(null)} title="Edit Patient"     size="lg"><PatientForm  initial={patient} onSubmit={act((d) => updatePatient(id, d))} loading={saving} /></Modal>
      <Modal isOpen={modal === 'complete-registration'} onClose={() => setModal(null)} title="Complete Patient Registration" size="lg">
        <PatientForm initial={cleanedForRegistration} onSubmit={act((d) => updatePatient(id, { ...d, is_unidentified: 0 }))} loading={saving} />
      </Modal>
      <Modal isOpen={modal === 'triage'}    onClose={() => setModal(null)} title="Record Triage"    size="md"><TriageForm    patientId={id}    onSubmit={act(createTriage)}    loading={saving} /></Modal>
      <Modal isOpen={modal === 'diagnosis'} onClose={() => setModal(null)} title="Record Diagnosis" size="md"><DiagnosisForm patientId={id}    onSubmit={act(createDiagnosis)} loading={saving} /></Modal>
      {/* Referral modal — ReferralForm builds FormData; act() passes it straight through */}
      <Modal isOpen={modal === 'referral'} onClose={() => setModal(null)} title="Create Referral" size="md">
        <ReferralForm diagnoses={diagnoses} onSubmit={(fd) => act(createReferral)(fd)} loading={saving} />
      </Modal>
      <Modal isOpen={modal === 'admission'} onClose={() => setModal(null)} title="Admit Patient"    size="md"><AdmissionForm patientId={id} patientName={`${patient.first_name} ${patient.last_name}`} onSubmit={act(createAdmission)} loading={saving} /></Modal>
      <Modal isOpen={modal === 'treatment'} onClose={() => setModal(null)} title="Add Treatment" size="md">
        <TreatmentForm diagnoses={diagnoses} onSubmit={act(handleAddTreatment)} loading={saving} />
      </Modal>
      <Modal isOpen={modal === 'assessment'} onClose={() => setModal(null)} title={assessment ? 'Update Assessment' : 'Add Assessment'} size="md">
        <DoctorAssessmentForm
          initial={assessment ?? {}}
          onSubmit={act((data) => saveAssessment(latestDiagnosis.diagnosis_id, data))}
          loading={saving}
        />
      </Modal>
      <Modal isOpen={modal === 'vitals'}    onClose={() => setModal(null)} title="Record Vital Signs" size="md">
        <VitalSignsForm triageId={vitalTriageId} onSubmit={act((d) => addVitalSigns(vitalTriageId, d))} loading={saving} />
      </Modal>

      {/* Lab Result Upload Modal (per-diagnosis) */}
      <Modal isOpen={labModal} onClose={() => setLabModal(false)} title="Upload Lab Result" size="sm">
        <form onSubmit={handleLabSubmit} noValidate>
          {labError && <Alert type="error" message={labError} style={{ marginBottom: 'var(--space-4)' }} />}
          <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
            <label htmlFor="lab-modal-test-type">Test Type / Label *</label>
            <input
              id="lab-modal-test-type"
              type="text"
              value={labTestType}
              onChange={(e) => setLabTestType(e.target.value)}
              placeholder="e.g. CBC, X-Ray, Urinalysis"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="lab-modal-file">File (PDF or Image, max 10 MB) *</label>
            <div className="file-input-wrapper">
              <button
                type="button"
                className="file-input-btn"
                onClick={() => labFileRef.current?.click()}
              >
                📎 Choose File
              </button>
              <span className="file-input-name">{labFileName || 'No file chosen'}</span>
              <input
                ref={labFileRef}
                id="lab-modal-file"
                type="file"
                accept="application/pdf,image/*"
                onChange={handleLabFileChange}
                style={{ display: 'none' }}
              />
            </div>
          </div>
          <div className="form-actions">
            <Button type="button" variant="ghost" onClick={() => setLabModal(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={labSaving}>Upload</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default PatientDetailPage;
