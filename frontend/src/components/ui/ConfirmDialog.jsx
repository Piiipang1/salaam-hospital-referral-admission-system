import Modal from './Modal';
import Button from './Button';

const ConfirmDialog = ({ isOpen, onClose, onConfirm, title, message, confirmLabel = 'Confirm', variant = 'danger', loading = false }) => (
  <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
    <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-6)' }}>
      {message}
    </p>
    <div className="form-actions">
      <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
      <Button variant={variant} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
    </div>
  </Modal>
);

export default ConfirmDialog;
