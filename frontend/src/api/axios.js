import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('salaam_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// On 401 — clear the (now-invalid) session and bounce to login. This is for
// EXPIRED/REVOKED tokens on authenticated calls. The login request itself is
// excluded: a failed sign-in (401 bad credentials, 429 rate-limited) must stay
// on the page so LoginPage can show the message in its Alert instead of the
// browser silently reloading and swallowing it.
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || '';
    const isAuthPageRequest = url.includes('/api/auth/login') || url.includes('/api/auth/change-password');
    if (error.response?.status === 401 && !isAuthPageRequest) {
      localStorage.removeItem('salaam_token');
      localStorage.removeItem('salaam_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;
