// Time-billed tables: the same arithmetic as the server (server/src/lib/timed.ts), so the screen can tick by itself.
import { useEffect, useState } from 'react';
import { post } from './api';

export interface Timer {
  started_at: string; ended_at: string | null; paused_at: string | null; paused_sec: number;
  rate: number; step: number; min_minutes: number;
  running: boolean; paused: boolean; ended: boolean;
  seconds: number; billedMin: number; charge: number; now: string;
}
/** The fields the floor list gives for each table with a clock. */
export interface FloorTimer { started_at: string; ended_at: string | null; paused_at: string | null; paused_sec: number; rate: number; step: number; min_minutes: number }

export function activeSeconds(s: FloorTimer, nowMs: number): number {
  const end = s.ended_at ? Date.parse(s.ended_at) : s.paused_at ? Date.parse(s.paused_at) : nowMs;
  return Math.max(0, Math.floor((end - Date.parse(s.started_at)) / 1000) - s.paused_sec);
}

export function timeCharge(s: FloorTimer, nowMs: number) {
  const seconds = activeSeconds(s, nowMs);
  if (seconds <= 0) return { seconds, billedMin: 0, charge: 0 };
  const minutes = Math.ceil(seconds / 60);
  const billedMin = Math.max(s.min_minutes, Math.ceil(minutes / s.step) * s.step);
  return { seconds, billedMin, charge: Math.round((billedMin * s.rate) / 60) };
}

/** 1:05:09 */
export function clock(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Re-renders every second while `active`. */
export function useNow(active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Before paying: stop a running clock so the amount shown at the till is the amount the server will charge. */
export async function stopClockForPayment(order: { id: number; timer?: Timer | null }) {
  if (order.timer && !order.timer.ended) await post(`/orders/${order.id}/timer/stop`);
}
