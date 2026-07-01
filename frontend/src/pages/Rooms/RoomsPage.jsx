import { useEffect, useState, useCallback } from 'react';
import { BedDouble, DoorClosed, HeartPulse, Baby, Building2, Pencil, ChevronRight } from 'lucide-react';
import { getAllRooms, createRoom, updateRoom } from '../../api/rooms.api';
import { useAuth } from '../../context/AuthContext';
import { canManageRooms } from '../../utils/roleGuard';
import { ROOM_TYPES } from '../../utils/constants';
import { formatDate } from '../../utils/formatDate';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import Spinner from '../../components/ui/Spinner';
import './RoomsPage.css';

const ROOM_ICONS = { 'General Ward': BedDouble, 'Private Room': DoorClosed, 'ICU': HeartPulse, 'Pediatric Ward': Baby };

// Room types where each unit is a standalone ROOM, not a bed in a shared ward
const ROOM_BASED_TYPES = ['Private Room'];
const isRoomBased = (type) => ROOM_BASED_TYPES.includes(type);

// Friendly sequential display name for room-based units (e.g. "Private Room 2").
// `group` must be pre-sorted by bed_number ascending — the real bed_number is
// never renamed, just used to derive the unit's position within its type.
const friendlyUnitLabel = (room, group) =>
  `${room.room_type} ${group.findIndex((r) => r.room_id === room.room_id) + 1}`;

const RoomsPage = () => {
  const { user } = useAuth();
  const [rooms,   setRooms]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [modal,   setModal]   = useState(null); // null | room object | 'new'
  const [form,    setForm]    = useState({ room_type:'', bed_number:'' });
  const [saving,  setSaving]  = useState(false);
  const [selectedWard, setSelectedWard] = useState(null);
  const [selectedBed,  setSelectedBed]  = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    getAllRooms().then((r) => { if (r.success) setRooms(r.data); }).catch(() => setError('Failed to load rooms.')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openEdit = (room) => { setForm({ room_type: room.room_type, bed_number: room.bed_number }); setModal(room); };
  // presetType lets the Level 2 ward view pre-fill room_type so the admin
  // only has to type the bed/room code.
  const openNew  = (presetType = '') => { setForm({ room_type: presetType, bed_number: '' }); setModal('new'); };

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

  // ROOM_TYPES plus any custom types already in use, deduplicated, for the
  // Room Type combobox — lets admins pick an existing type or add a new one.
  // r.room_type is always a string; mapping the object itself here was the
  // bug that previously rendered "[object Object]" in the field.
  const availableRoomTypes = Array.from(
    new Set([...ROOM_TYPES, ...rooms.map(r => r.room_type)])
  ).filter(Boolean).sort();

  // Group rooms by ward (room_type) — derived in memory, no extra API call.
  const wardGroups = rooms.reduce((acc, room) => {
    (acc[room.room_type] ??= []).push(room);
    return acc;
  }, {});

  // For room-based types, sort by bed_number ascending so friendly sequential
  // names (Private Room 1, 2, …) stay stable regardless of API order.
  const wardUnits = !selectedWard
    ? []
    : isRoomBased(selectedWard)
      ? rooms.filter(r => r.room_type === selectedWard).sort((a, b) => a.bed_number.localeCompare(b.bed_number))
      : rooms.filter(r => r.room_type === selectedWard);

  if (loading) return <Spinner />;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-5)' }}>
      {!selectedWard ? (
        <>
          <div className="page-header">
            <div>
              <h2 className="page-title">Rooms</h2>
              <p className="page-subtitle">{available} of {rooms.length} available</p>
            </div>
          </div>
          {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
          {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

          <div className="wards-grid">
            {Object.entries(wardGroups).map(([roomType, wardRooms]) => {
              const WardIcon = ROOM_ICONS[roomType] ?? Building2;
              const occupiedCount  = wardRooms.filter(r => r.availability_status === 'occupied').length;
              const availableCount = wardRooms.filter(r => r.availability_status === 'available').length;
              return (
                <div
                  key={roomType}
                  className="ward-card"
                  onClick={() => setSelectedWard(roomType)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="ward-card__icon"><WardIcon size={28} /></div>
                  <div className="ward-card__info">
                    <span className="ward-card__name">{isRoomBased(roomType) ? `${roomType}s` : roomType}</span>
                    <span className="ward-card__counts">
                      <span style={{ color: 'var(--color-danger)' }}>{occupiedCount} occupied</span>
                      {' · '}
                      <span style={{ color: 'var(--color-primary)' }}>{availableCount} available</span>
                    </span>
                  </div>
                  <span className="ward-card__chevron">View beds <ChevronRight size={16} /></span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="page-header">
            <div>
              <button className="ward-back-btn" onClick={() => setSelectedWard(null)}>← Back to wards</button>
              <h2 className="page-title" style={{ marginTop: 'var(--space-2)' }}>
                {isRoomBased(selectedWard) ? `${selectedWard}s` : `${selectedWard} beds`}
              </h2>
            </div>
            {canManageRooms(user?.role) && (
              <Button variant="primary" onClick={() => openNew(selectedWard)}>
                {isRoomBased(selectedWard) ? '+ Add Room' : '+ Add Bed'}
              </Button>
            )}
          </div>
          {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
          {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

          <div className="rooms-grid">
            {wardUnits.map((room) => {
              const RoomIcon = ROOM_ICONS[room.room_type] ?? Building2;
              const isOccupied = room.availability_status === 'occupied';
              const roomBased = isRoomBased(room.room_type);
              const unitLabel = roomBased ? friendlyUnitLabel(room, wardUnits) : room.bed_number;
              const unitSubtext = roomBased ? room.bed_number : room.room_type;
              return (
                <div
                  key={room.room_id}
                  className={`room-card room-card--${room.availability_status}${isOccupied ? ' room-card--clickable' : ''}`}
                  onClick={isOccupied ? () => setSelectedBed(room) : undefined}
                >
                  <div className="room-card__icon"><RoomIcon size={22} /></div>
                  <div className="room-card__info">
                    <span className="room-card__bed" title={roomBased ? room.bed_number : undefined}>{unitLabel}</span>
                    <span className="room-card__type">{unitSubtext}</span>
                  </div>
                  <Badge status={room.availability_status} />
                  {canManageRooms(user?.role) && (
                    <button
                      className="room-card__edit"
                      onClick={(e) => { e.stopPropagation(); openEdit(room); }}
                      title="Edit room"
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <Modal isOpen={!!modal} onClose={() => setModal(null)} title={modal === 'new' ? 'Add Room' : 'Edit Room'} size="sm">
        <form onSubmit={handleSave} noValidate>
          <div className="form-group">
            <label htmlFor="rm-type">Room Type *</label>
            <input
              id="rm-type"
              list="rm-type-options"
              value={form.room_type}
              onChange={(e) => setForm(f => ({...f, room_type: e.target.value}))}
              placeholder="Select an existing type or type a new one"
              autoComplete="off"
              required
            />
            <datalist id="rm-type-options">
              {availableRoomTypes.map(t => <option key={t} value={t} />)}
            </datalist>
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

      <Modal
        isOpen={!!selectedBed}
        onClose={() => setSelectedBed(null)}
        title={
          selectedBed
            ? isRoomBased(selectedBed.room_type)
              ? `${friendlyUnitLabel(selectedBed, wardUnits)} — ${selectedBed.room_type}`
              : `Bed ${selectedBed.bed_number} — ${selectedBed.room_type}`
            : ''
        }
        size="sm"
      >
        {selectedBed && (
          selectedBed.availability_status !== 'occupied' ? (
            <p className="bed-modal__empty">This bed is available.</p>
          ) : (
            <div className="bed-modal">
              <div className="bed-modal__row">
                <span className="bed-modal__patient-name">{selectedBed.patient_name || 'Unknown patient'}</span>
                {selectedBed.triage_level && <Badge status={selectedBed.triage_level} />}
              </div>
              <div className="bed-modal__field">
                <span className="bed-modal__label">Condition</span>
                <p className="bed-modal__value">{selectedBed.patient_condition || 'No diagnosis on record'}</p>
              </div>
              <div className="bed-modal__grid">
                <div className="bed-modal__field">
                  <span className="bed-modal__label">Admission Type</span>
                  <p className="bed-modal__value">{selectedBed.admission_type || 'Regular'}</p>
                </div>
                <div className="bed-modal__field">
                  <span className="bed-modal__label">Admission Date</span>
                  <p className="bed-modal__value">{formatDate(selectedBed.admission_date)}</p>
                </div>
              </div>
            </div>
          )
        )}
      </Modal>
    </div>
  );
};

export default RoomsPage;
