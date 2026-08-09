import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getRoomCapacity } from '../api/rooms.api';
import { useAuth } from './AuthContext';
import { CAPACITY_POLL_MS } from '../utils/constants';

const CapacityContext = createContext(null);

// Hospital-wide bed availability, polled like notifications. `atCapacity` gates
// every intake form (registration, triage, admission); the backend enforces the
// same rule in utils/capacity.js — this is the UI half, so a user sees why
// before filling anything in.
export const CapacityProvider = ({ children }) => {
  const { user } = useAuth();
  const [capacity, setCapacity] = useState(null); // null until the first fetch

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await getRoomCapacity();
      if (res.success) setCapacity(res.data);
    } catch (_) { /* silent — a failed poll must never disable intake on its own */ }
  }, [user]);

  // Initial fetch + polling
  useEffect(() => {
    if (!user) { setCapacity(null); return; }
    refresh();
    const interval = setInterval(refresh, CAPACITY_POLL_MS);
    return () => clearInterval(interval);
  }, [user, refresh]);

  // Unknown capacity counts as available: the API is the authority and still
  // refuses an at-capacity write, so a failed poll degrades to the previous
  // behaviour instead of locking the whole intake pipeline.
  const value = {
    totalRooms:      capacity?.total_rooms ?? null,
    availableRooms:  capacity?.available_rooms ?? null,
    atCapacity:      capacity?.at_capacity === true,
    refreshCapacity: refresh,
  };

  return (
    <CapacityContext.Provider value={value}>
      {children}
    </CapacityContext.Provider>
  );
};

export const useCapacity = () => {
  const ctx = useContext(CapacityContext);
  if (!ctx) throw new Error('useCapacity must be inside CapacityProvider');
  return ctx;
};

export default CapacityContext;
