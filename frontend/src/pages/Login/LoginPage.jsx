import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Alert from '../../components/ui/Alert';
import Button from '../../components/ui/Button';
import logo from '../../assets/logo.png';
import './LoginPage.css';

const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm]     = useState({ username: '', password: '' });
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  // Real-time clock — updates every second, cleaned up on unmount.
  const [clockTime, setClockTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setClockTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const clockStr = clockTime.toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
  const dateStr = clockTime.toLocaleDateString('en-PH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.username || !form.password) {
      setError('Please enter your username and password.');
      return;
    }
    setLoading(true);
    try {
      const res = await login(form);
      if (res.success) {
        navigate('/dashboard', { replace: true });
      } else {
        setError(res.message || 'Login failed. Please check your credentials.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Server error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page" style={{ position: 'relative' }}>
      {/* Background decorative circles */}
      <div className="login-page__bg-circle login-page__bg-circle--1" />
      <div className="login-page__bg-circle login-page__bg-circle--2" />

      {/* Clock fixed to top right */}
      <div className="login-page__clock-container" style={{
        position: 'absolute',
        top: 'var(--space-4)',
        right: 'var(--space-6)',
        textAlign: 'right',
        zIndex: 10,
        background: 'var(--color-surface)',
        padding: 'var(--space-2) var(--space-4)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-sm)',
        border: '1px solid var(--color-border)',
      }}>
        <div className="login-page__clock-time" style={{ fontSize: '1.25rem', fontWeight: 'bold', fontFamily: 'monospace', color: 'var(--color-primary)' }}>
          {clockStr}
        </div>
        <div className="login-page__clock-date" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          {dateStr}
        </div>
      </div>

      <div className="login-card">
        {/* Brand */}
        <div className="login-card__brand">
          <div className="login-card__brand-icon">
            <img src={logo} alt="Salaam Hospital" className="login-card__brand-logo" />
          </div>
          <div>
            <h1 className="login-card__brand-name">Salaam Hospital</h1>
            <p className="login-card__brand-sub">Referral &amp; Admission System</p>
          </div>
        </div>

        <hr className="divider" />

        <h2 className="login-card__heading">Sign In</h2>
        <p className="login-card__sub">Enter your credentials to continue</p>

        {error && (
          <Alert type="error" message={error} onDismiss={() => setError('')} />
        )}

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              type="text"
              name="username"
              value={form.username}
              onChange={handleChange}
              placeholder="Enter your username"
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Enter your password"
              autoComplete="current-password"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={loading}
            id="login-submit-btn"
          >
            Sign In
          </Button>
        </form>

        <p className="login-card__footer">
          Salaam Hospital — Marawi City &nbsp;|&nbsp; Internal Use Only
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
