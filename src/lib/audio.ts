// Lightweight Web Audio engine for cockpit sounds. No external assets.
// Ambient bed is smooth, calming filtered white noise (think "cabin air").
// Engine thrust is silent — only the warp/lightspeed jump speeds up and
// brightens the noise for a whoosh feel.

export class CockpitAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  // Ambient noise bed
  private noiseSrc: AudioBufferSourceNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private noiseGain: GainNode | null = null;

  // Warp whoosh layer (modulates the bed)
  private warpGain: GainNode | null = null;
  private warpFilter: BiquadFilterNode | null = null;
  private warpSrc: AudioBufferSourceNode | null = null;

  private started = false;
  private muted = false;

  /** Lazily create the AudioContext (must be called from a user gesture). */
  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Build a ~4s looping pink-ish noise buffer (smooth, low-rumble bias). */
  private makeNoiseBuffer(ctx: AudioContext, seconds = 4): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Voss-McCartney-ish smoothing for a soft, non-hissy texture.
    let b0 = 0,
      b1 = 0,
      b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    }
    return buf;
  }

  /** Start the calming ambient noise bed (idempotent). */
  start() {
    if (this.started) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.started = true;

    const buf = this.makeNoiseBuffer(ctx, 4);

    // Bed: gentle low-pass, very low gain.
    this.noiseSrc = ctx.createBufferSource();
    this.noiseSrc.buffer = buf;
    this.noiseSrc.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = "lowpass";
    this.noiseFilter.frequency.value = 700;
    this.noiseFilter.Q.value = 0.4;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.18;
    this.noiseSrc.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    this.noiseSrc.start();

    // Warp layer: same buffer, brighter filter, silent until warpWhoosh().
    this.warpSrc = ctx.createBufferSource();
    this.warpSrc.buffer = buf;
    this.warpSrc.loop = true;
    this.warpSrc.playbackRate.value = 1.0;
    this.warpFilter = ctx.createBiquadFilter();
    this.warpFilter.type = "bandpass";
    this.warpFilter.frequency.value = 600;
    this.warpFilter.Q.value = 0.7;
    this.warpGain = ctx.createGain();
    this.warpGain.gain.value = 0.0001;
    this.warpSrc.connect(this.warpFilter).connect(this.warpGain).connect(this.master);
    this.warpSrc.start();
  }

  /** Engine thrust — intentionally silent. The ambient bed stays smooth. */
  setThrust(_thrust: number, _boost = 1) {
    // no-op (kept for API compatibility)
  }

  /** Lightspeed: speed up + brighten the ambient noise for ~3s, then settle. */
  warpWhoosh() {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.start();
    if (!this.warpGain || !this.warpFilter || !this.warpSrc || !this.noiseFilter) return;
    const now = ctx.currentTime;
    const dur = 3.0;

    // Warp layer swells up and sweeps bright.
    this.warpGain.gain.cancelScheduledValues(now);
    this.warpGain.gain.setValueAtTime(Math.max(0.0001, this.warpGain.gain.value), now);
    this.warpGain.gain.exponentialRampToValueAtTime(0.55, now + 0.4);
    this.warpGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    this.warpFilter.frequency.cancelScheduledValues(now);
    this.warpFilter.frequency.setValueAtTime(400, now);
    this.warpFilter.frequency.exponentialRampToValueAtTime(3200, now + 1.2);
    this.warpFilter.frequency.exponentialRampToValueAtTime(500, now + dur);

    this.warpSrc.playbackRate.cancelScheduledValues(now);
    this.warpSrc.playbackRate.setValueAtTime(1.0, now);
    this.warpSrc.playbackRate.linearRampToValueAtTime(2.4, now + 1.0);
    this.warpSrc.playbackRate.linearRampToValueAtTime(1.0, now + dur);

    // Bed brightens slightly during the jump.
    this.noiseFilter.frequency.cancelScheduledValues(now);
    this.noiseFilter.frequency.setValueAtTime(this.noiseFilter.frequency.value, now);
    this.noiseFilter.frequency.linearRampToValueAtTime(1800, now + 0.8);
    this.noiseFilter.frequency.linearRampToValueAtTime(700, now + dur);
  }

  /** Discovery beep: short two-tone chirp. */
  discoveryBeep() {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const tones = [880, 1320];
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const start = now + i * 0.09;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      osc.connect(g).connect(this.master!);
      osc.start(start);
      osc.stop(start + 0.35);
    });
  }

  /** Subtle confirming chirp when a scan locks on. */
  lockChirp() {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const tones = [1100, 1650];
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const start = now + i * 0.05;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.07, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(g).connect(this.master!);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  }

  /** Tiny pickup tick for orbs. */
  orbPing() {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(2200, now + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  isMuted() {
    return this.muted;
  }

  dispose() {
    try {
      this.noiseSrc?.stop();
      this.warpSrc?.stop();
    } catch {
      // ignore
    }
    this.noiseSrc?.disconnect();
    this.noiseFilter?.disconnect();
    this.noiseGain?.disconnect();
    this.warpSrc?.disconnect();
    this.warpFilter?.disconnect();
    this.warpGain?.disconnect();
    this.master?.disconnect();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
    this.noiseSrc = null;
    this.noiseFilter = null;
    this.noiseGain = null;
    this.warpSrc = null;
    this.warpFilter = null;
    this.warpGain = null;
    this.started = false;
  }
}
