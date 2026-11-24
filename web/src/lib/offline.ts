// Offline support: connection state + a small queue of safe actions made while the server was unreachable.
import { create } from 'zustand';

export interface QueuedRequest {
  key: string; // also sent as Idempotency-Key, so a retry never applies twice
  method: 'POST';
  url: string;
  body: unknown;
  label: string;
  at: number;
  error?: string; // set when the server refused it on replay
}

const QUEUE_KEY = 'laza_offline_queue';
const FAILED_KEY = 'laza_offline_failed';
const read = <T,>(k: string): T[] => {
  try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; }
};
const write = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ }
};

interface Net {
  online: boolean;
  queue: QueuedRequest[];
  failed: QueuedRequest[];
  flushing: boolean;
  setOnline: (v: boolean) => void;
}

export const useNet = create<Net>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  queue: read<QueuedRequest>(QUEUE_KEY),
  failed: read<QueuedRequest>(FAILED_KEY),
  flushing: false,
  setOnline: (v) => set({ online: v }),
}));

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

export function enqueue(r: QueuedRequest) {
  const queue = [...useNet.getState().queue, r].slice(-200);
  write(QUEUE_KEY, queue);
  useNet.setState({ queue, online: false });
}

export function dismissFailed(key?: string) {
  const failed = key ? useNet.getState().failed.filter((f) => f.key !== key) : [];
  write(FAILED_KEY, failed);
  useNet.setState({ failed });
}

/** Actions that are safe to hold and replay later: adding lines to an existing order and moving lines through the kitchen. */
export const isQueueable = (url: string) => /^\/orders\/\d+\/items(\/status)?$/.test(url) || /^\/order-items\/\d+\/status$/.test(url);

type Sender = (r: QueuedRequest) => Promise<{ ok: boolean; status: number; error?: string }>;
let sender: Sender | null = null;
export const setSender = (s: Sender) => { sender = s; };
let onFlushed: (() => void) | null = null;
export const setFlushedHandler = (fn: () => void) => { onFlushed = fn; };

/** Replay the queue in order. Stops at the first network failure; moves refused requests to `failed`. */
export async function flushQueue(): Promise<void> {
  const st = useNet.getState();
  if (st.flushing || !st.queue.length || !sender) return;
  useNet.setState({ flushing: true });
  let sent = 0;
  try {
    for (;;) {
      const next = useNet.getState().queue[0];
      if (!next) break;
      let res;
      try {
        res = await sender(next);
      } catch {
        useNet.setState({ online: false });
        break; // still offline
      }
      const rest = useNet.getState().queue.slice(1);
      write(QUEUE_KEY, rest);
      useNet.setState({ queue: rest, online: true });
      if (res.ok) sent++;
      else {
        const failed = [...useNet.getState().failed, { ...next, error: res.error || `ຜິດພາດ (${res.status})` }].slice(-50);
        write(FAILED_KEY, failed);
        useNet.setState({ failed });
      }
    }
  } finally {
    useNet.setState({ flushing: false });
    if (sent) onFlushed?.();
  }
}

// ----- connectivity -----
let timer: ReturnType<typeof setInterval> | null = null;
async function ping() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch('/api/health', { cache: 'no-store', signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

export function startConnectivity() {
  if (timer) return;
  const check = async () => {
    const ok = await ping();
    const was = useNet.getState().online;
    useNet.setState({ online: ok });
    if (ok && (!was || useNet.getState().queue.length)) flushQueue();
  };
  window.addEventListener('online', check);
  window.addEventListener('offline', () => useNet.setState({ online: false }));
  // Check often while something is wrong, rarely otherwise.
  timer = setInterval(() => {
    const s = useNet.getState();
    if (!s.online || s.queue.length) check();
  }, 5000);
  setInterval(check, 30000);
  check();
}
