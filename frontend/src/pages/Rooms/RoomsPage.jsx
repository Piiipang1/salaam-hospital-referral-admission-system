import { useEffect, useState, useCallback } from 'react';
import { getAllRooms, createRoom, updateRoom } from '../../api/rooms.api';
import { useAuth } from '../../context/AuthContext';
import { canManageRooms } from '../../utils/roleGuard';
import { ROOM_TYPES } from '../../utils/constants';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import Spinner from '../../components/ui/Spinner';
import './RoomsPage.css';

const ROOM_ICONS = { 'General Ward':'🛏️', 'Private Room':'🚪', 'ICU':'💊', 'Pediatric Ward':'🧒', 'Emergency Room':'🚨' };

const TRIAGE_COLORS = { Critical: '#e53e3e', Urgent: '#d97706', 'Non-Urgent': '#38a169' };

// patient_condition can be a long clinical paragraph — keep the room card compact
const truncate = (str, n) => (str && str.length > n ? str.slice(0, n) + '…' : str);

const RoomsPage = () => {
  const { user } = useAuth();
  const [rooms,   setRooms]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [modal,   setModal]   = useState(null); // null | room object | 'new'
  const [form,    setForm]    = useState({ room_type:'', bed_number:'' });
  const [saving,  setSaving]  = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getAllRooms().then((r) => { if (r.success) setRooms(r.data); }).catch(() => setError('Failed to load rooms.')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openEdit = (room) => { setForm({ room_type: room.room_type, bed_number: room.bed_number }); setModal(room); };
  const openNew  = ()     => { setForm({ room_type: '', bed_number: '' }); setModal('new'); };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.room_type || !form.bed_number) { setError('Room type and bed number are required.'); return; }
    setSaving(true);
    try {
      if (modal === 'new') await createRoom(form);
      else await updateRoom(modal.room_id, form);
      setSuccess('Room saved.'); setModal(null); load();
    } catch (err) { setError(err.response?.data?.message || 'Save failed.'); }
    finally { setSaving(false); }
  };

  const available = rooms.filter(r => r.availability_status === 'available').length;

  if (loading) return <Spinner />;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-5)' }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">Rooms</h2>
          <p className="page-subtitle">{available} of {rooms.length} available</p>
        </div>
        {canManageRooms(user?.role) && <Button id="add-room-btn" variant="primary" onClick={openNew}>+ Add Room</Button>}
      </div>
      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <div className="rooms-grid">
        {rooms.map((room) => (
          <div key={room.room_id} className={`room-card room-card--${room.availability_status}`}>
            <div className="room-card__icon">{ROOM_ICONS[room.room_type] ?? '🏥'}</div>
            <div className="room-card__info">
              <span className="room-card__bed">{room.bed_number}</span>
              <span className="room-card__type">{room.room_type}</span>
            </div>
            {room.availability_status === 'occupied' && room.patient_name && (
              <div className="room-card__patient">
                <span className="room-card__patient-name">{room.patient_name}</span>
                <span className="room-card__condition">
                  {room.patient_condition ? truncate(room.patient_condition, 50) : 'No diagnosis on record'}
                </span>
                {room.triage_level && (
                  <span
                    className="room-card__triage-badge"
                    style={{ backgroundColor: TRIAGE_COLORS[room.triage_level], color: '#fff' }}
                  >
                    {room.triage_level}
                  </span>
                )}
                <span className="room-card__admission-type">
                  Admitted: {room.admission_type || 'Regular'}
                </span>
              </div>
            )}
            <Badge status={room.availability_status} />
            {canManageRooms(user?.role) && (
              <button className="room-card__edit" onClick={() => openEdit(room)} title="Edit room">✏️</button>
            )}
          </div>
        ))}
      </div>

      <Modal isOpen={!!modal} onClose={() => setModal(null)} title={modal === 'new' ? 'Add Room' : 'Edit Room'} size="sm">
        <form onSubmit={handleSave} noValidate>
          <div className="form-group">
            <label htmlFor="rm-type">Room Type *</label>
            <select id="rm-type" value={form.room_type} onChange={(e) => setForm(f => ({...f, room_type: e.target.value}))} required>
              <option value="">Select type</option>
              {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginTop:'var(--space-4)' }}>
            <label htmlFor="rm-bed">Bed Number *</label>
            <input id="rm-bed" value={form.bed_number} onChange={(e) => setForm(f => ({...f, bed_number: e.target.value}))} placeholder="e.g. GW-05" required />
          </div>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving}>Save Room</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default RoomsPage;
