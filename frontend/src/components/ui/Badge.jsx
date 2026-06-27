import { STATUS_COLORS } from '../../utils/constants';
import './Badge.css';

const Badge = ({ status, label, size = 'sm' }) => {
  const color = STATUS_COLORS[status] ?? 'muted';
  return (
    <span className={`badge badge--${color} badge--${size}`}>
      {label ?? status}
    </span>
  );
};

export default Badge;
