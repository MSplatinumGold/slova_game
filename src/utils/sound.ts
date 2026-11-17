class SoundEngine {
  private ctx: AudioContext | null = null;
  private enabled = true;

  public setEnabled(val: boolean): void {
    this.enabled = val;
  }

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    volume = 0.12,
    delay = 0
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playLetterSelect(stepIndex: number): void {
    // Ascending pentatonic scale (C5..E6)
    const notes = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98];
    const freq = notes[Math.min(stepIndex, notes.length - 1)];
    this.tone(freq, 0.11, 'triangle', 0.1);
  }

  public playWordSolved(): void {
    this.tone(523.25, 0.16, 'triangle', 0.12, 0);
    this.tone(659.25, 0.16, 'triangle', 0.12, 0.06);
    this.tone(783.99, 0.24, 'sine', 0.14, 0.12);
  }

  public playBonusWord(): void {
    this.tone(659.25, 0.14, 'sine', 0.11, 0);
    this.tone(987.77, 0.22, 'sine', 0.12, 0.07);
  }

  public playHint(): void {
    this.tone(783.99, 0.15, 'sine', 0.11, 0);
    this.tone(1046.5, 0.22, 'sine', 0.12, 0.08);
  }

  public playInvalid(): void {
    this.tone(210, 0.12, 'triangle', 0.1, 0);
    this.tone(175, 0.16, 'triangle', 0.09, 0.07);
  }

  public playShuffle(): void {
    this.tone(440, 0.07, 'sine', 0.06, 0);
    this.tone(523.25, 0.07, 'sine', 0.06, 0.04);
  }

  public playVictory(): void {
    const chord = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    chord.forEach((f, idx) => {
      this.tone(f, 0.34, 'triangle', 0.12, idx * 0.08);
    });
  }
}

export const soundEngine = new SoundEngine();
