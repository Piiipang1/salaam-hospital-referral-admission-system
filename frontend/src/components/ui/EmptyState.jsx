import { Inbox } from 'lucide-react';
import './EmptyState.css';

const EmptyState = ({ icon = <Inbox size={48} />, message = 'No records found.', action }) => (
  <div className="empty-state">
    <div className="empty-state__icon">{icon}</div>
    <p className="empty-state__message">{message}</p>
    {action && <div className="empty-state__action">{action}</div>}
  </div>
);

export default EmptyState;
