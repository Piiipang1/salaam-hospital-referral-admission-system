import './StatCard.css';

const StatCard = ({ icon: Icon, label, value, color = 'primary', onClick }) => (
  <div
    className={`stat-card stat-card--${color}${onClick ? ' stat-card--clickable' : ''}`}
    onClick={onClick}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
  >
    <div className="stat-card__icon">
      {typeof Icon === 'string' ? Icon : <Icon size={22} />}
    </div>
    <div className="stat-card__content">
      <span className="stat-card__value">{value ?? '—'}</span>
      <span className="stat-card__label">{label}</span>
    </div>
  </div>
);

export default StatCard;
