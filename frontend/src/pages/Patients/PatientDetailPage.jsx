import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileText, Image, Paperclip, FlaskConical, ClipboardList, ChevronDown, ChevronRight } from 'lucide-react';
import { getPatientById, getPatientHistory, updatePatient } from '../../api/patients.api';
import { createTriage, assignTriageDoctor } from '../../api/triages.api';
import { getMyNursingContext } from '../../api/nursing.api';
import { cancelAssignment } from '../../api/assignments.api';
import { getActiveDoctors } from '../../api/doctors.api';
import { createDiagnosis, addLabResult, addTreatment, getAssessment, saveAssessment } from '../../api/diagnoses.api';
import { createReferral, createExternalReferral } from '../../api/referrals.api';
import { createAdmission } from '../../api/admissions.api';
import { fetchFileBlob } from '../../api/files.api';
import { useAuth } from '../../context/AuthContext';
import { useCapacity } from '../../context/CapacityContext';
import { canManagePatients, canDiagnose, canManageTriage, canCreateReferral, canUserAdmit, canUploadLabResult, canCreateExternalReferral } from '../../utils/roleGuard';
import { formatDate } from '../../utils/formatDate';
import { NO_ROOMS_MESSAGE } from '../../utils/constants';
import { formatPatientAge, formatPatientDob, formatPatientSex } from '../../utils/patientLabels';
import Badge from '../../components/ui/Badge';
import UnidentifiedBadge from '../../components/ui/UnidentifiedBadge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import Alert from '../../components/ui/Alert';
import CapacityBanner from '../../components/ui/CapacityBanner';
import PatientForm from '../../components/forms/PatientForm';
import TriageForm from '../../components/forms/TriageForm';
import DiagnosisForm from '../../components/forms/DiagnosisForm';
import ReferralForm from '../../components/forms/ReferralForm';
import ExternalReferralForm from '../../components/forms/ExternalReferralForm';
import AdmissionForm from '../../components/forms/AdmissionForm';
import VitalSignsForm from '../../components/forms/VitalSignsForm';
import TreatmentForm from '../../components/forms/TreatmentForm';
import DoctorAssessmentForm from '../../components/forms/DoctorAssessmentForm';
import PatientPrintView from '../../components/print/PatientPrintView';
import DiagnosisPrintView from '../../components/print/DiagnosisPrintView';
import { addVitalSigns } from '../../api/triages.api';
import './PatientDetailPage.css';

const TABS = ['Triage', 'Diagnoses', 'Treatment Plan', 'Referrals', 'Admissions', 'OPD Follow-ups', 'Documents'];


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
  // No free bed → triage and admission are closed for this patient too. Editing
  // the record, diagnoses, referrals and vitals stay available: this patient is
  // already inside the system.
  const { atCapacity } = useCapacity();
  const navigate = useNavigate();

  const [patient,  setPatient]  = useState(null);
  const [history,  setHistory]  = useState({});
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState('Triage');
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');
  const [modal,    setModal]    = useState(null); // 'edit'|'triage'|'diagnosis'|'referral'|'admission'|'vitals'
  const [saving,   setSaving]   = useState(false);
  // Triage reads stay hospital-wide for nurses, but the patient RECORD follows
  // the active nurse assignment (backend utils/scoping nurseCanAccessPatient),
  // so a 403 here is expected after a shift handoff, not a bug. Both
  // getPatientById and getPatientHistory can raise it; Promise.all below means
  // either one lands in the same catch.
  const [accessDenied, setAccessDenied] = useState(false);
  const [vitalTriageId, setVitalTriageId] = useState(null);

  // Visit grouping (Triage/Diagnoses tabs) — collapsed state keyed by
  // visit_number ('unlinked' for diagnoses with no triage_id). Undefined means
  // "use the default" (only the most recent visit starts expanded), so this
  // stays correct as new data loads without needing to be reset on refresh.
  const [collapsedVisits, setCollapsedVisits] = useState({});

  // Nurse-only: whether this nurse's department may triage a RETURNING
  // (discharged) patient — see backend utils/nursing isDischargedTriageDepartment.
  // Comes from /api/nursing/me, not /auth/me — department is nursing context,
  // not part of the auth payload. Defaults to true so a non-discharged patient
  // (the common case) never flickers the button while this loads; the backend
  // is the actual boundary regardless of what this holds.
  const [canTriageDischarged, setCanTriageDischarged] = useState(true);

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

  // Print state
  // printMode: null | 'full' | number (diagnosis_id for single-diagnosis print)
  const [printMode, setPrintMode] = useState(null);
  // Assessment fetched on-demand for single-diagnosis print
  const [printDiagnosis, setPrintDiagnosis] = useState(null);
  const [printAssessment, setPrintAssessment] = useState(null);
  const [printLoading, setPrintLoading] = useState(false);

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

  // Fetch once on mount, nurses only — doctors/admins have no ward department
  // and this gate never applies to them.
  useEffect(() => {
    if (user?.role !== 'nurse') return;
    getMyNursingContext()
      .then((res) => { if (res.success) setCanTriageDischarged(!!res.data.can_triage_discharged); })
      .catch(() => { /* non-fatal: button stays at its default; backend still enforces */ });
  }, [user?.role]);

  const act = (fn, { skipRefresh = false } = {}) => async (data) => {
    setSaving(true);
    try {
      const result = await fn(data);
      setSuccess('Saved successfully.');
      setModal(null);
      if (!skipRefresh) load();
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

  // Uploaded files (PHI) are served only from the authenticated /api/files
  // endpoint, so we fetch them as a Blob (JWT attached by axios) and open or
  // download the object URL — a plain <a href> couldn't send the auth header.
  const openFile = async (filename) => {
    try {
      const blob = await fetchFileBlob(filename);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      // Give the new tab time to load before releasing the object URL.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setError('Could not open the file. Please try again.');
    }
  };

  const downloadFile = async (filename) => {
    try {
      const blob = await fetchFileBlob(filename);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not download the file. Please try again.');
    }
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
          message="You don't have access to this patient's record. Records follow the active nurse assignment — the nurse currently responsible for this patient can open it, and it transfers when a shift is endorsed."
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
  // Outpatient half of the record — booked automatically when an admission is
  // discharged, and keyed by admission_id so each stay can show the follow-up
  // it generated.
  const opdFollowups = history.opd_followups ?? [];
  const followupByAdmission = Object.fromEntries(
    opdFollowups.filter((f) => f.admission_id).map((f) => [f.admission_id, f])
  );

  // ── Visit grouping (Triage/Diagnoses tabs) ──────────────────────────────
  // visit_number distinguishes a discharged patient's new episode of care from
  // their old one (backend: triages.controller createTriage). triages is
  // already sorted newest-first, so within a group the order is preserved, and
  // the LAST item in a group is the earliest triage of that visit — the one
  // whose date the group header shows.
  const triagesByVisit = {};
  for (const t of triages) {
    const vn = t.visit_number ?? 1;
    (triagesByVisit[vn] ??= []).push(t);
  }
  const visitNumbers = Object.keys(triagesByVisit).map(Number).sort((a, b) => b - a);
  const maxVisitNumber = visitNumbers[0];

  // Diagnoses inherit their visit from the triage that started the encounter
  // (diagnosis.triage_id). A diagnosis with no triage_id (or one whose triage
  // no longer resolves) falls into an "Unlinked" section rather than being
  // silently dropped or mis-grouped.
  const visitByTriageId = Object.fromEntries(triages.map((t) => [t.triage_id, t.visit_number ?? 1]));
  const diagnosesByVisit = {};
  const unlinkedDiagnoses = [];
  for (const d of diagnoses) {
    const vn = d.triage_id != null ? visitByTriageId[d.triage_id] : undefined;
    if (vn == null) { unlinkedDiagnoses.push(d); continue; }
    (diagnosesByVisit[vn] ??= []).push(d);
  }
  const diagnosisVisitNumbers = Object.keys(diagnosesByVisit).map(Number).sort((a, b) => b - a);

  // Treatments, referrals, and admissions don't carry a triage_id of their own,
  // but they all carry diagnosis_id — so they inherit their visit the same way
  // diagnoses do, one hop further down the chain.
  const visitByDiagnosisId = Object.fromEntries(
    diagnoses
      .filter((d) => d.triage_id != null && visitByTriageId[d.triage_id] != null)
      .map((d) => [d.diagnosis_id, visitByTriageId[d.triage_id]])
  );
  // Visit grouping headers only earn their keep once a patient actually has a
  // return visit — a single-visit patient sees the same flat list as before.
  const isMultiVisit = visitNumbers.length > 1;

  // Only the most recent visit starts expanded; every older one starts
  // collapsed. `key` is a visit_number for triages/diagnoses, or 'unlinked'.
  const isVisitCollapsed = (key, defaultExpanded) =>
    collapsedVisits[key] ?? !defaultExpanded;
  const toggleVisit = (key, defaultExpanded) =>
    setCollapsedVisits((c) => ({ ...c, [key]: !(c[key] ?? !defaultExpanded) }));

  const VisitHeader = ({ visitKey, label, dateLabel, defaultExpanded }) => {
    const collapsed = isVisitCollapsed(visitKey, defaultExpanded);
    return (
      <button
        type="button"
        onClick={() => toggleVisit(visitKey, defaultExpanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          width: '100%', textAlign: 'left', background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
          padding: 'var(--space-2) var(--space-3)', cursor: 'pointer',
          fontWeight: 600, fontSize: 'var(--font-size-sm)',
        }}
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        {label}
        {dateLabel && <span className="text-xs text-muted" style={{ fontWeight: 400 }}>— {dateLabel}</span>}
      </button>
    );
  };

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
    (d.treatments ?? []).map((tx) => ({ ...tx, medical_condition: d.medical_condition, diagnosis_id: d.diagnosis_id }))
  );
  const latestDiagnosis = diagnoses[0] ?? null;

  const handleAddTreatment = (data) => addTreatment(data.diagnosis_id, data);

  return (
    <div className="patient-detail">
      <button className="back-link" onClick={() => navigate('/patients')}>← Back to Patients</button>

      <CapacityBanner />
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
          {/* Same derived status as the patient list, so the two never disagree */}
          <div>
            <span className="info-label">Care Status</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Badge status={patient.care_status ?? 'Waiting'} />
              {patient.care_status_detail && (
                <span className="text-xs text-muted">{patient.care_status_detail}</span>
              )}
            </span>
          </div>
          <div><span className="info-label">Admitting Doctor</span><span>{patient.admitting_doctor ? `Dr. ${patient.admitting_doctor}` : '—'}</span></div>
          <div><span className="info-label">Room</span><span>{patient.room_type ? `${patient.room_type} — ${patient.bed_number}` : patient.admission_status === 'Pending Room' ? 'Awaiting room' : '—'}</span></div>
          <div><span className="info-label">Contact</span><span>{patient.contact_number || '—'}</span></div>
          <div><span className="info-label">Address</span><span>{patient.address || '—'}</span></div>
          <div><span className="info-label">Emergency Contact</span><span>{patient.emergency_contact_name || '—'}</span></div>
          <div><span className="info-label">Emergency Number</span><span>{patient.emergency_contact_number || '—'}</span></div>
          <div><span className="info-label">Registered</span><span>{formatDate(patient.created_at, true)}</span></div>
        </div>
      </Card>

      {/* Action buttons */}
      <div className="patient-actions">
        {canManageTriage(user?.role) && (() => {
          const dischargedTriageBlocked =
            user?.role === 'nurse' && patient?.care_status === 'Discharged' && !canTriageDischarged;
          return (
            <Button
              size="sm"
              variant="primary"
              disabled={atCapacity || dischargedTriageBlocked}
              title={
                atCapacity ? NO_ROOMS_MESSAGE
                  : dischargedTriageBlocked ? 'Only ER/OPD nurses can triage a returning patient.'
                  : undefined
              }
              onClick={() => setModal('triage')}
            >
              + Triage
            </Button>
          );
        })()}
        {canDiagnose(user?.role) && <Button size="sm" variant="primary" onClick={() => setModal('diagnosis')}>+ Diagnosis</Button>}
        {canCreateReferral(user?.role) && <Button size="sm" variant="secondary" onClick={() => setModal('referral')}>+ Referral</Button>}
        {canUserAdmit(user) && <Button size="sm" variant="secondary" disabled={atCapacity} title={atCapacity ? NO_ROOMS_MESSAGE : undefined} onClick={() => setModal('admission')}>+ Admission</Button>}
        {atCapacity && canCreateExternalReferral(user?.role) && (
          <Button size="sm" variant="danger"
            title="No beds are free — refer this patient to another hospital"
            onClick={() => setModal('external-referral')}>
            Refer to External Hospital
          </Button>
        )}
        {/* Print whole record — visible to anyone who can see this page */}
        <Button
          size="sm"
          variant="outline"
          loading={printLoading && printMode === 'full'}
          onClick={() => setPrintMode('full')}
          title="Print complete patient medical record"
        >
          🖨 Print Record
        </Button>
      </div>

      {/* Tabs */}
      <div className="detail-tabs">
        {TABS.map((t) => (
          <button key={t} className={`detail-tab${tab === t ? ' detail-tab--active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'Triage' && (() => {
        const TriageCard = (t) => (
          <Card key={t.triage_id} className="detail-item">
            <div className="detail-item__header">
              <div className="flex items-center gap-2">
                <Badge status={t.triage_level} />
                <span className="text-sm text-muted">{formatDate(t.triage_datetime, true)}</span>
              </div>
              {canManageTriage(user?.role) && (
                <Button size="sm" variant="outline" onClick={() => { setVitalTriageId(t.triage_id); setModal('vitals'); }}>+ Vitals</Button>
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
        );

        if (triages.length === 0) return <div className="detail-list"><p className="text-muted">No triage records.</p></div>;

        if (!isMultiVisit) {
          return <div className="detail-list">{triages.map(TriageCard)}</div>;
        }

        return (
          <div className="detail-list">
            {visitNumbers.map((vn) => {
              const group = triagesByVisit[vn];
              const defaultExpanded = vn === maxVisitNumber;
              const collapsed = isVisitCollapsed(vn, defaultExpanded);
              // Group is a subset of the newest-first `triages` array, so its
              // order is preserved — the last item is the earliest of the group.
              const firstDate = group[group.length - 1].triage_datetime;
              return (
                <div key={vn} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <VisitHeader
                    visitKey={vn}
                    label={`Visit ${vn}`}
                    dateLabel={formatDate(firstDate, true)}
                    defaultExpanded={defaultExpanded}
                  />
                  {!collapsed && group.map(TriageCard)}
                </div>
              );
            })}
          </div>
        );
      })()}

      {tab === 'Diagnoses' && (() => {
        const DiagnosisCard = (d) => (
          <Card key={d.diagnosis_id} className="detail-item">
            <div className="detail-item__header">
              <p className="font-semibold">{d.medical_condition}</p>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                {canDiagnose(user?.role) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={printLoading && printMode === d.diagnosis_id}
                    title="Print this diagnosis with treatments and assessment"
                    onClick={async () => {
                      setPrintLoading(true);
                      setPrintMode(d.diagnosis_id);
                      try {
                        const aRes = await getAssessment(d.diagnosis_id);
                        setPrintDiagnosis(d);
                        setPrintAssessment(aRes.success ? aRes.data : null);
                      } catch {
                        setPrintDiagnosis(d);
                        setPrintAssessment(null);
                      } finally {
                        setPrintLoading(false);
                      }
                    }}
                  >
                    🖨 Print
                  </Button>
                )}
                {canUploadLabResult(user?.role) && (
                  <Button size="sm" variant="ghost" onClick={() => openLabModal(d.diagnosis_id)}>+ Lab Result</Button>
                )}
              </div>
            </div>
            <p className="text-sm text-muted">Date: {formatDate(d.diagnosis_date, true)}</p>
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
                          role="button"
                          tabIndex={0}
                          onClick={() => openFile(lr.file_attachment)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(lr.file_attachment); } }}
                          className="lab-result-link"
                          style={{ cursor: 'pointer' }}
                        >
                          {lr.test_type || 'Lab Result'}
                        </a>
                        {lr.results && <p className="text-xs text-muted">{lr.results}</p>}
                        {lr.date_conducted && (
                          <p className="text-xs text-muted">{formatDate(lr.date_conducted, true)}</p>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        );

        if (diagnoses.length === 0) return <div className="detail-list"><p className="text-muted">No diagnoses.</p></div>;

        if (!isMultiVisit) {
          return <div className="detail-list">{diagnoses.map(DiagnosisCard)}</div>;
        }

        return (
          <div className="detail-list">
            {diagnosisVisitNumbers.map((vn) => {
              const defaultExpanded = vn === maxVisitNumber;
              const collapsed = isVisitCollapsed(vn, defaultExpanded);
              return (
                <div key={vn} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <VisitHeader visitKey={vn} label={`Visit ${vn}`} defaultExpanded={defaultExpanded} />
                  {!collapsed && diagnosesByVisit[vn].map(DiagnosisCard)}
                </div>
              );
            })}
            {unlinkedDiagnoses.length > 0 && (() => {
              const collapsed = isVisitCollapsed('unlinked', false);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <VisitHeader visitKey="unlinked" label="Unlinked" defaultExpanded={false} />
                  {!collapsed && unlinkedDiagnoses.map(DiagnosisCard)}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {tab === 'Treatment Plan' && (() => {
        const TreatmentCard = (tx) => (
          <Card key={tx.treatment_id} className="detail-item">
            <div className="detail-item__header">
              <span className="font-semibold">{tx.prescribed_medications}</span>
            </div>
            <p className="text-sm text-muted">Diagnosis: {tx.medical_condition || '—'}</p>
            <p className="text-sm text-muted">Dosage: {tx.dosage || '—'}</p>
            <p className="text-sm text-muted">Frequency: {tx.frequency || '—'}</p>
            <p className="text-sm text-muted">Duration: {tx.treatment_duration || '—'}</p>
            <p className="text-sm text-muted">Recorded: {formatDate(tx.created_at, true)}</p>
          </Card>
        );

        // Same visit-inheritance chain as Diagnoses: treatment → diagnosis_id → visit.
        const treatmentsByVisit = {};
        const unlinkedTreatments = [];
        for (const tx of treatments) {
          const vn = visitByDiagnosisId[tx.diagnosis_id];
          if (vn == null) { unlinkedTreatments.push(tx); continue; }
          (treatmentsByVisit[vn] ??= []).push(tx);
        }

        return (
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
          {treatments.length === 0 ? <p className="text-muted">No treatment records.</p> : !isMultiVisit ? (
            treatments.map(TreatmentCard)
          ) : (
            <>
              {diagnosisVisitNumbers.filter((vn) => treatmentsByVisit[vn]?.length).map((vn) => {
                const defaultExpanded = vn === maxVisitNumber;
                const collapsed = isVisitCollapsed(`tx-${vn}`, defaultExpanded);
                return (
                  <div key={vn} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <VisitHeader visitKey={`tx-${vn}`} label={`Visit ${vn}`} defaultExpanded={defaultExpanded} />
                    {!collapsed && treatmentsByVisit[vn].map(TreatmentCard)}
                  </div>
                );
              })}
              {unlinkedTreatments.length > 0 && (() => {
                const collapsed = isVisitCollapsed('tx-unlinked', false);
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <VisitHeader visitKey="tx-unlinked" label="Unlinked" defaultExpanded={false} />
                    {!collapsed && unlinkedTreatments.map(TreatmentCard)}
                  </div>
                );
              })()}
            </>
          )}
        </div>
        );
      })()}

      {tab === 'Referrals' && (() => {
        const ReferralCard = (r) => {
          const RefFileIcon = fileIcon(r.file_attachment);
          return (
            <Card key={r.referral_id} className="detail-item">
              <div className="detail-item__header">
                <span>
                  {r.is_external ? 'External Referral' : 'Referral'} — {formatDate(r.referral_date, true)}
                </span>
                <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  {/* External transfers must never be mistaken for an internal
                      consult — the destination is another facility entirely. */}
                  {r.is_external ? (
                    <span style={{
                      fontSize: 'var(--font-size-xs)',
                      fontWeight: 600,
                      padding: '2px var(--space-2)',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--color-warning-muted)',
                      color: 'var(--color-warning)',
                      whiteSpace: 'nowrap',
                    }}>
                      ↗ External
                    </span>
                  ) : null}
                  <Badge status={r.status} />
                </span>
              </div>
              <p className="text-sm text-muted">Date: {formatDate(r.referral_date, true)}</p>
              <p className="text-sm text-muted">
                Referred by: {r.referring_doctor_name ? `Dr. ${r.referring_doctor_name} (${r.referring_specialization || 'General'})` : '—'}
              </p>
              {r.is_external ? (
                <>
                  <p className="text-sm text-muted">
                    Referred to: <strong>{r.external_hospital_name}</strong>
                    {r.external_hospital_contact ? ` · ${r.external_hospital_contact}` : ''}
                  </p>
                  {r.external_hospital_address && (
                    <p className="text-sm text-muted">Address: {r.external_hospital_address}</p>
                  )}
                  {r.external_reason && (
                    <p className="text-sm text-muted">Reason: {r.external_reason}</p>
                  )}
                </>
              ) : null}
              {r.assigned_doctor_name && (
                <p className="text-sm text-muted">Refer to: {r.assigned_doctor_name} ({r.specialization || 'General'})</p>
              )}
              {r.medical_condition && (
                <p className="text-sm text-muted">Condition: {r.medical_condition}</p>
              )}
              {/* Why the patient was referred — mandatory on internal referrals,
                  so this is the receiving doctor's brief. */}
              {r.remarks && (
                <p className="text-sm" style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--space-1)' }}>
                  <strong>Remarks:</strong> {r.remarks}
                </p>
              )}
              {/* Attached referral document */}
              {r.file_attachment && (
                <div className="lab-results-section" style={{ marginTop: 'var(--space-3)' }}>
                  <div className="lab-result-item">
                    <span className="lab-result-icon"><RefFileIcon size={16} /></span>
                    <div className="lab-result-info">
                      <a
                        role="button"
                        tabIndex={0}
                        onClick={() => openFile(r.file_attachment)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(r.file_attachment); } }}
                        className="lab-result-link"
                        style={{ cursor: 'pointer' }}
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
        };

        // Referrals inherit their visit via diagnosis_id, same as treatments.
        // External referrals and any referral without a diagnosis land in
        // "General" rather than being dropped.
        const referralsByVisit = {};
        const generalReferrals = [];
        for (const r of referrals) {
          const vn = visitByDiagnosisId[r.diagnosis_id];
          if (vn == null) { generalReferrals.push(r); continue; }
          (referralsByVisit[vn] ??= []).push(r);
        }

        if (referrals.length === 0) return <div className="detail-list"><p className="text-muted">No referral history.</p></div>;

        if (!isMultiVisit) {
          return <div className="detail-list">{referrals.map(ReferralCard)}</div>;
        }

        return (
          <div className="detail-list">
            {diagnosisVisitNumbers.filter((vn) => referralsByVisit[vn]?.length).map((vn) => {
              const defaultExpanded = vn === maxVisitNumber;
              const collapsed = isVisitCollapsed(`ref-${vn}`, defaultExpanded);
              return (
                <div key={vn} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <VisitHeader visitKey={`ref-${vn}`} label={`Visit ${vn}`} defaultExpanded={defaultExpanded} />
                  {!collapsed && referralsByVisit[vn].map(ReferralCard)}
                </div>
              );
            })}
            {generalReferrals.length > 0 && (() => {
              const collapsed = isVisitCollapsed('ref-general', false);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <VisitHeader visitKey="ref-general" label="General" defaultExpanded={false} />
                  {!collapsed && generalReferrals.map(ReferralCard)}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {tab === 'Admissions' && (() => {
        const AdmissionCard = (a) => (
          <Card key={a.admission_id} className="detail-item">
            <div className="detail-item__header">
              <span>{a.admission_type} — Room {a.bed_number}</span>
              <Badge status={a.status} />
            </div>
            <p className="text-sm text-muted">Admitted: {formatDate(a.admission_date, true)}</p>
            {a.discharge_date && <p className="text-sm text-muted">Discharged: {formatDate(a.discharge_date, true)}</p>}
            {/* The OPD visit this discharge routed the patient to — the link
                between the inpatient stay and the outpatient record. */}
            {followupByAdmission[a.admission_id] && (
              <p className="text-sm" style={{ marginTop: 'var(--space-1)' }}>
                <strong>OPD follow-up:</strong>{' '}
                {followupByAdmission[a.admission_id].clinic_name ?? 'Clinic not set'} on{' '}
                {formatDate(followupByAdmission[a.admission_id].followup_date)}{' '}
                <Badge status={followupByAdmission[a.admission_id].status} />
              </p>
            )}
          </Card>
        );

        // Admissions inherit their visit via diagnosis_id, same as referrals.
        // A "Pending Room" admission has no diagnosis yet — it lands in "General".
        const admissionsByVisit = {};
        const generalAdmissions = [];
        for (const a of admissions) {
          const vn = visitByDiagnosisId[a.diagnosis_id];
          if (vn == null) { generalAdmissions.push(a); continue; }
          (admissionsByVisit[vn] ??= []).push(a);
        }

        if (admissions.length === 0) return <div className="detail-list"><p className="text-muted">No admission records.</p></div>;

        if (!isMultiVisit) {
          return <div className="detail-list">{admissions.map(AdmissionCard)}</div>;
        }

        return (
          <div className="detail-list">
            {diagnosisVisitNumbers.filter((vn) => admissionsByVisit[vn]?.length).map((vn) => {
              const defaultExpanded = vn === maxVisitNumber;
              const collapsed = isVisitCollapsed(`adm-${vn}`, defaultExpanded);
              return (
                <div key={vn} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <VisitHeader visitKey={`adm-${vn}`} label={`Visit ${vn}`} defaultExpanded={defaultExpanded} />
                  {!collapsed && admissionsByVisit[vn].map(AdmissionCard)}
                </div>
              );
            })}
            {generalAdmissions.length > 0 && (() => {
              const collapsed = isVisitCollapsed('adm-general', false);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <VisitHeader visitKey="adm-general" label="General" defaultExpanded={false} />
                  {!collapsed && generalAdmissions.map(AdmissionCard)}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* OPD Follow-ups tab is left flat (not grouped by visit): a follow-up
          links to admission_id, not diagnosis_id, so grouping it would need a
          second hop (admission → diagnosis → visit) on top of the one
          Admissions already does, and each card already shows the discharge
          date of the stay it came from — enough to place it without a header. */}

      {/* ── OPD Follow-ups tab ── */}
      {tab === 'OPD Follow-ups' && (
        <div className="detail-list">
          {opdFollowups.length === 0 ? (
            <p className="text-muted">
              No outpatient follow-ups. One is booked automatically whenever an admission is discharged.
            </p>
          ) : opdFollowups.map((f) => (
            <Card key={f.followup_id} className="detail-item">
              <div className="detail-item__header">
                <span>{f.clinic_name ?? 'Clinic not set'}</span>
                <Badge status={f.status} />
              </div>
              <p className="text-sm text-muted">
                {f.visit_type} · Scheduled {formatDate(f.followup_date)}
                {f.doctor_name ? ` · Referred by ${f.doctor_name}` : ''}
              </p>
              {f.medical_condition && (
                <p className="text-sm">Continuing: {f.medical_condition}</p>
              )}
              {f.notes && <p className="text-sm">{f.notes}</p>}
              <p className="text-xs text-muted">
                {f.classified_by === 'Auto'
                  ? `Routed automatically${f.routing_basis ? ` — ${f.routing_basis}` : ''}`
                  : 'Clinic assigned manually'}
                {f.discharge_date ? ` · from the stay discharged ${formatDate(f.discharge_date)}` : ''}
              </p>
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
                      role="button"
                      tabIndex={0}
                      onClick={() => openFile(doc.filename)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(doc.filename); } }}
                      className="lab-result-link"
                      style={{ cursor: 'pointer' }}
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
                  {doc.date && <p className="text-xs text-muted">{formatDate(doc.date, true)}</p>}
                </div>
                <a
                  role="button"
                  tabIndex={0}
                  onClick={() => downloadFile(doc.filename)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); downloadFile(doc.filename); } }}
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
                    cursor: 'pointer',
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
      <Modal isOpen={modal === 'triage'}    onClose={() => setModal(null)} title="Record Triage"    size="md"><TriageForm    patientId={id}    onSubmit={act(createTriage)}    loading={saving} disabled={atCapacity} /></Modal>
      <Modal isOpen={modal === 'diagnosis'} onClose={() => setModal(null)} title="Record Diagnosis" size="md"><DiagnosisForm patientId={id} triageId={latestTriageId} onSubmit={act(createDiagnosis, { skipRefresh: true })} onComplete={load} loading={saving} /></Modal>
      {/* Referral modal — ReferralForm builds FormData; act() passes it straight through */}
      <Modal isOpen={modal === 'referral'} onClose={() => setModal(null)} title="Create Referral" size="md">
        <ReferralForm diagnoses={diagnoses} onSubmit={(fd) => act(createReferral)(fd)} loading={saving} />
      </Modal>
      {/* Refer OUT to a hospital outside this system — patient is fixed here */}
      <Modal isOpen={modal === 'external-referral'} onClose={() => setModal(null)} title="Refer to External Hospital" size="md">
        <ExternalReferralForm
          patientId={id}
          patientName={`${patient.first_name} ${patient.last_name}`}
          onSubmit={(fd) => act(createExternalReferral)(fd)}
          loading={saving}
        />
      </Modal>
      <Modal isOpen={modal === 'admission'} onClose={() => setModal(null)} title="Admit Patient"    size="md"><AdmissionForm patientId={id} patientName={`${patient.first_name} ${patient.last_name}`} onSubmit={act(createAdmission)} loading={saving} disabled={atCapacity} /></Modal>
      <Modal isOpen={modal === 'treatment'} onClose={() => setModal(null)} title="Add Treatment" size="md">
        <TreatmentForm diagnoses={diagnoses} onSubmit={act(handleAddTreatment)} loading={saving} />
      </Modal>
      <Modal isOpen={modal === 'assessment'} onClose={() => setModal(null)} title={assessment ? 'Update Assessment' : 'Add Assessment'} size="md">
        <DoctorAssessmentForm
          initial={assessment ?? {}}
          onSubmit={act((data) => saveAssessment(latestDiagnosis.diagnosis_id, data))}
          loading={saving}
          currentDoctorId={user?.linked_id}
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

      {/* ── Print: full patient record ── */}
      {printMode === 'full' && (
        <PatientPrintView
          patient={patient}
          history={history}
          printedBy={user?.username ?? user?.role ?? 'Staff'}
          onClose={() => setPrintMode(null)}
        />
      )}

      {/* ── Print: single diagnosis ── */}
      {typeof printMode === 'number' && printDiagnosis && (
        <DiagnosisPrintView
          patient={patient}
          diagnosis={printDiagnosis}
          assessment={printAssessment}
          printedBy={user?.username ?? user?.role ?? 'Staff'}
          onClose={() => { setPrintMode(null); setPrintDiagnosis(null); setPrintAssessment(null); }}
        />
      )}
    </div>
  );
};

export default PatientDetailPage;
