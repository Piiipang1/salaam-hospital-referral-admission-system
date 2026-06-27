import './Alert.css';

const Alert = ({ type = 'info', message, onDismiss }) => {
  if (!message) return null;
  return (
    <div className={`alert alert--${type}`} role="alert">
      <span className="alert__message">{message}</span>
      {onDismiss && (
        <button className="alert__close" onClick={onDismiss} aria-label="Dismiss">✕</button>
      )}
    </div>
  );
};

export default Alert;
