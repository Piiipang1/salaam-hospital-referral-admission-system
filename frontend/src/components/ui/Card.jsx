import './Card.css';

const Card = ({ children, className = '', title, action, padding = true }) => (
  <div className={`card${padding ? '' : ' card--no-pad'}${className ? ' ' + className : ''}`}>
    {(title || action) && (
      <div className="card__header">
        {title && <h3 className="card__title">{title}</h3>}
        {action && <div className="card__action">{action}</div>}
      </div>
    )}
    <div className="card__body">{children}</div>
  </div>
);

export default Card;
