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
