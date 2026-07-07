// ============================================================
// vibeAgentGo — SoundManager
// Generates short system sounds via Web Audio API (no files needed).
// ============================================================

type SoundName = 'tool_call' | 'done' | 'error' | 'message';

class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;

  setEnabled(on: boolean) {
    this.enabled = on;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private ensureCtx(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /** Play a short tone with the given frequency, duration, and type. */
  private beep(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.15) {
    const ctx = this.ensureCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    // Envelope: quick attack, smooth decay
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  /** Two-tone sequence (first note, then second note after gap). */
  private twoTone(f1: number, f2: number, dur: number, type: OscillatorType = 'sine', volume = 0.15) {
    const ctx = this.ensureCtx();
    if (!ctx) return;

    this.beep(f1, dur, type, volume);
    setTimeout(() => this.beep(f2, dur, type, volume), dur * 1000 * 0.6);
  }

  play(sound: SoundName) {
    if (!this.enabled) return;

    switch (sound) {
      case 'tool_call':
        // Soft double click
        this.beep(660, 0.06, 'sine', 0.08);
        setTimeout(() => this.beep(880, 0.06, 'sine', 0.08), 70);
        break;
      case 'done':
        // Pleasant rising two-tone
        this.twoTone(523, 784, 0.12, 'sine', 0.12);
        break;
      case 'error':
        // Descending buzz
        this.beep(220, 0.15, 'sawtooth', 0.1);
        setTimeout(() => this.beep(165, 0.2, 'sawtooth', 0.1), 120);
        break;
      case 'message':
        // Gentle single ping
        this.beep(880, 0.1, 'sine', 0.1);
        break;
    }
  }
}

export const sounds = new SoundManager();