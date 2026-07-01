import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { NotifProvider } from './context/NotifContext';
import AppRouter from './router/AppRouter';
import './styles/index.css';

const App = () => (
  <ThemeProvider>
    <AuthProvider>
      <NotifProvider>
        <AppRouter />
      </NotifProvider>
    </AuthProvider>
  </ThemeProvider>
);

export default App;
