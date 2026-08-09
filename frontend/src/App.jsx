import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { NotifProvider } from './context/NotifContext';
import { CapacityProvider } from './context/CapacityContext';
import AppRouter from './router/AppRouter';
import './styles/index.css';

const App = () => (
  <ThemeProvider>
    <AuthProvider>
      <NotifProvider>
        <CapacityProvider>
          <AppRouter />
        </CapacityProvider>
      </NotifProvider>
    </AuthProvider>
  </ThemeProvider>
);

export default App;
