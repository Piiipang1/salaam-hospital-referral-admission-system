import { AuthProvider } from './context/AuthContext';
import { NotifProvider } from './context/NotifContext';
import AppRouter from './router/AppRouter';
import './styles/index.css';

const App = () => (
  <AuthProvider>
    <NotifProvider>
      <AppRouter />
    </NotifProvider>
  </AuthProvider>
);

export default App;
