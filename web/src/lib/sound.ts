/** Short notification beep (no audio files needed). Silently does nothing if audio is blocked. */
export function beep(freq = 880, ms = 250) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    o.start();
    o.stop(ctx.currentTime + ms / 1000);
    o.onended = () => void ctx.close();
  } catch {
    /* audio not available */
  }
}

let bellAudio: HTMLAudioElement | null = null;

/** Desk-bell sound for new orders (web/public/sounds/order-bell.mp3, made with earshot). Falls back to beep(). */
export function orderBell() {
  try {
    bellAudio ??= new Audio('/sounds/order-bell.mp3');
    bellAudio.currentTime = 0;
    bellAudio.play().catch(() => beep(988, 300));
  } catch {
    beep(988, 300);
  }
}
