// Lightweight Web Audio engine for cockpit sounds. No external assets.

export class CockpitAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  // Engine hum
  private humOsc1: OscillatorNode | null = null;
  private humOsc2: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private humFilter: BiquadFilterNode | null = null;

  // Ambient synth pad (slow, evolving)
  private padOscs: OscillatorNode[] = [];
  private padGain: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private padLfo: OscillatorNode | null = null;
  private padLfoGain: GainNode | null = null;

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
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Start the continuous engine hum (idempotent). */
  start() {
    if (this.started) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.started = true;

    this.humFilter = ctx.createBiquadFilter();
    this.humFilter.type = "lowpass";
    this.humFilter.frequency.value = 320;
    this.humFilter.Q.value = 0.7;

    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0.05; // idle hum

    this.humOsc1 = ctx.createOscillator();
    this.humOsc1.type = "sawtooth";
    this.humOsc1.frequency.value = 55;

    this.humOsc2 = ctx.createOscillator();
    this.humOsc2.type = "triangle";
    this.humOsc2.frequency.value = 82.5; // perfect 5th-ish for body

    this.humOsc1.connect(this.humFilter);
    this.humOsc2.connect(this.humFilter);
    this.humFilter.connect(this.humGain);
    this.humGain.connect(this.master);

    this.humOsc1.start();
    this.humOsc2.start();

    // Ambient pad: detuned root + 5th + octave through soft lowpass with slow LFO swell
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = 0.4;

    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.06; // base pad level (very soft)

    // Slow amplitude LFO for breathing/swell (~0.06Hz, ~16s cycle)
    this.padLfo = ctx.createOscillator();
    this.padLfo.type = "sine";
    this.padLfo.frequency.value = 0.06;
    this.padLfoGain = ctx.createGain();
    this.padLfoGain.gain.value = 0.025;
    this.padLfo.connect(this.padLfoGain).connect(this.padGain.gain);

    // Pad voices: low D + A + D (octave), with slight detunes for chorus
    const padFreqs = [73.42, 110.0, 146.83]; // D2, A2, D3
    const padDetunes = [-7, 5, 9];
    const padTypes: OscillatorType[] = ["sine", "triangle", "sine"];
    for (let i = 0; i < padFreqs.length; i++) {
      const o = ctx.createOscillator();
      o.type = padTypes[i];
      o.frequency.value = padFreqs[i];
      o.detune.value = padDetunes[i];
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = 0.5 + i * 0.15;
      o.connect(voiceGain).connect(this.padFilter);
      o.start();
      this.padOscs.push(o);
    }
    this.padFilter.connect(this.padGain).connect(this.master);
    this.padLfo.start();
  }

  /** thrust in -1..1, boost >=1 */
  setThrust(thrust: number, boost = 1) {
    if (!this.ctx || !this.humGain || !this.humOsc1 || !this.humOsc2 || !this.humFilter) return;
    const t = this.ctx.currentTime;
    const a = Math.abs(thrust);
    const targetGain = 0.04 + a * 0.18 * Math.min(boost, 3);
    const targetFreq1 = 50 + a * 60 * boost;
    const targetFreq2 = 78 + a * 90 * boost;
    const targetCutoff = 280 + a * 900 * boost;
    this.humGain.gain.setTargetAtTime(targetGain, t, 0.15);
    this.humOsc1.frequency.setTargetAtTime(targetFreq1, t, 0.2);
    this.humOsc2.frequency.setTargetAtTime(targetFreq2, t, 0.2);
    this.humFilter.frequency.setTargetAtTime(targetCutoff, t, 0.2);
  }

  /** Lightspeed whoosh: noise burst with sweeping bandpass + pitch tail. */
  warpWhoosh() {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const dur = 2.4;

    // Pink-ish noise via filtered white noise
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 200;
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(180, now);
    bp.frequency.exponentialRampToValueAtTime(2400, now + 0.6);
    bp.frequency.exponentialRampToValueAtTime(140, now + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.45, now + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    // Sub-bass thump
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(80, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 1.2);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(0.5, now + 0.1);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);

    noise.connect(bp).connect(gain).connect(this.master);
    sub.connect(subGain).connect(this.master);
    noise.start(now);
    noise.stop(now + dur);
    sub.start(now);
    sub.stop(now + 1.4);
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
      g.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      osc.connect(g).connect(this.master!);
      osc.start(start);
      osc.stop(start + 0.35);
    });
  }

  /** Subtle confirming chirp when a scan locks on. Two quick ascending sine
   *  blips kept lower in level than discoveryBeep so it reads as "lock", not "found". */
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
      g.gain.exponentialRampToValueAtTime(0.09, start + 0.01);
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
    g.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
    }
  }

  isMuted() {
    return this.muted;
  }

  dispose() {
    try {
      this.humOsc1?.stop();
      this.humOsc2?.stop();
      this.padOscs.forEach((o) => o.stop());
      this.padLfo?.stop();
    } catch {
      // ignore
    }
    this.humOsc1?.disconnect();
    this.humOsc2?.disconnect();
    this.humFilter?.disconnect();
    this.humGain?.disconnect();
    this.padOscs.forEach((o) => o.disconnect());
    this.padOscs = [];
    this.padFilter?.disconnect();
    this.padGain?.disconnect();
    this.padLfo?.disconnect();
    this.padLfoGain?.disconnect();
    this.master?.disconnect();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
    this.humOsc1 = this.humOsc2 = null;
    this.humGain = null;
    this.humFilter = null;
    this.padFilter = null;
    this.padGain = null;
    this.padLfo = null;
    this.padLfoGain = null;
    this.started = false;
  }
}
