import api from './axios';
export const getAllRooms      = () => api.get('/api/rooms').then(r => r.data);
export const getAvailableRooms = () => api.get('/api/rooms/available').then(r => r.data);
export const getRoomById     = (id) => api.get(`/api/rooms/${id}`).then(r => r.data);
export const createRoom      = (data) => api.post('/api/rooms', data).then(r => r.data);
export const updateRoom      = (id, data) => api.put(`/api/rooms/${id}`, data).then(r => r.data);
export const deleteRoom      = (id) => api.delete(`/api/rooms/${id}`).then(r => r.data);
