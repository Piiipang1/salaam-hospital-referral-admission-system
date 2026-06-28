import './Spinner.css';

const Spinner = ({ size = 'md', fullscreen = false }) => {
  if (fullscreen) {
    return (
      <div className="spinner-fullscreen">
        <div className={`spinner spinner--${size}`} role="status" aria-label="Loading" />
      </div>
    );
  }
  return <div className={`spinner spinner--${size}`} role="status" aria-label="Loading" />;
};

export default Spinner;
