import { useState } from 'react';
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
    <div className="login-page">
      {/* Background decorative circles */}
      <div className="login-page__bg-circle login-page__bg-circle--1" />
      <div className="login-page__bg-circle login-page__bg-circle--2" />

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
