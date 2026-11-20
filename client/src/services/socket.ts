import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let lastRegisteredUser: {
  userId: string;
  role: string;
  name: string;
  agentStatus?: string;
  supportedLanguages?: string[];
  token?: string;
} | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(window.location.origin, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
      auth: (cb) => {
        const token = localStorage.getItem('kaira_token') || localStorage.getItem('token');
        cb({ token });
      }
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected with ID:', socket?.id);
      if (lastRegisteredUser && socket) {
        console.log('[Socket] Auto-registering user on connect:', lastRegisteredUser);
        socket.emit('user:register', lastRegisteredUser);
      }
    });

    socket.on('disconnect', (reason) => {
      console.warn('[Socket] Disconnected:', reason);
    });

    socket.on('reconnect', (attempt) => {
      console.log('[Socket] Reconnected after attempt:', attempt);
      if (lastRegisteredUser && socket) {
        socket.emit('user:register', lastRegisteredUser);
      }
    });
  }
  return socket;
}

export function registerSocketUser(
  userId: string,
  role: string,
  name: string,
  agentStatus: string = 'available',
  supportedLanguages?: string[]
) {
  const token = localStorage.getItem('kaira_token') || localStorage.getItem('token') || undefined;
  lastRegisteredUser = { userId, role, name, agentStatus, supportedLanguages, token };
  const s = getSocket();
  console.log('[Socket] registerSocketUser:', name, role, 'status:', agentStatus, 'connected:', s.connected);
  s.emit('user:register', { userId, role, name, agentStatus, supportedLanguages, token });
}

export function unregisterSocketUser() {
  lastRegisteredUser = null;
  if (socket) {
    try {
      socket.emit('user:unregister');
      socket.disconnect();
    } catch { }
    socket = null;
  }
}
