import { create } from 'zustand';
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { get, post, setUnauthorizedHandler, tokenStore, type Branch, type Restaurant, type Shift, type User } from './api';

interface Session {
  user: User | null;
  branch: Branch | null;
  restaurant: Restaurant | null;
  shift: Shift | null;
  /** Which kinds of server-side printers this branch has (otherwise we fall back to browser printing). */
  printers: { kitchen: boolean; bill: boolean };
  /** Accounts still using the published demo password (owners/managers only). */
  defaultPasswords: { id: number; username: string; name: string }[];
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  /** Owner only: work in another branch (new token, everything reloaded). */
  switchBranch: (branchId: number) => Promise<void>;
}

let socket: Socket | null = null;
type Listener = (topics: string[]) => void;
const listeners = new Set<Listener>();

function connectSocket(token: string) {
  socket?.disconnect();
  socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
  socket.on('sync', (msg: { topics: string[] }) => listeners.forEach((l) => l(msg.topics)));
  // After a reconnect we may have missed events: ask everyone to refetch.
  socket.on('connect', () => listeners.forEach((l) => l(['*'])));
}

export const useSession = create<Session>((set, getState) => ({
  user: null,
  branch: null,
  restaurant: null,
  shift: null,
  printers: { kitchen: false, bill: false },
  defaultPasswords: [],
  ready: false,
  async login(username, password) {
    const r = await post<{ token: string; user: User }>('/auth/login', { username, password });
    tokenStore.set(r.token);
    connectSocket(r.token);
    await getState().refresh();
  },
  logout() {
    tokenStore.set('');
    // Cached answers belong to the previous user: drop them (and any queued actions) on this device.
    try { navigator.serviceWorker?.controller?.postMessage('clear-api'); } catch { /* ignore */ }
    socket?.disconnect();
    socket = null;
    set({ user: null, branch: null, restaurant: null, shift: null, defaultPasswords: [], ready: true });
  },
  async switchBranch(branchId) {
    const r = await post<{ token: string; user: User }>(`/branches/${branchId}/switch`, {});
    // Cached answers belong to the previous branch.
    try { navigator.serviceWorker?.controller?.postMessage('clear-api'); } catch { /* ignore */ }
    tokenStore.set(r.token);
    connectSocket(r.token);
    window.location.assign('/');
  },
  async refresh() {
    const token = tokenStore.get();
    if (!token) return set({ ready: true });
    try {
      const me = await get<{ user: User; branch: Branch; restaurant: Restaurant; shift: Shift | null; printers: { kitchen: boolean; bill: boolean }; defaultPasswords?: { id: number; username: string; name: string }[] }>('/me');
      if (!socket) connectSocket(token);
      set({ ...me, defaultPasswords: me.defaultPasswords ?? [], ready: true });
    } catch {
      set({ ready: true });
    }
  },
}));

setUnauthorizedHandler(() => useSession.getState().logout());

/** Run `fn` whenever the server says one of `topics` changed (and on reconnect). */
export function useSync(topics: string[], fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  const key = topics.join(',');
  useEffect(() => {
    const l: Listener = (changed) => {
      if (changed.includes('*') || changed.some((t) => topics.includes(t))) ref.current();
    };
    listeners.add(l);
    return () => void listeners.delete(l);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// Shift status is shown everywhere, keep it fresh.
listeners.add((t) => {
  if (t.includes('shift') || t.includes('settings') || t.includes('*')) useSession.getState().refresh();
});
