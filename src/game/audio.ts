/* Procedural audio engine — Web Audio API only, zero external assets. */

type NoiseBuffer = AudioBuffer;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private volume = 0.8;
  private muted = false;

  private roomLoop: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private worldLoop: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  private humLoop: { src: OscillatorNode; gain: GainNode } | null = null;
  private riserNodes: AudioScheduledSourceNode[] = [];
  private fallWind: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private heartbeatTimer: number | null = null;
  private thunderTimer: number | null = null;
  private pingTimer: number | null = null;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 22;
    this.compressor.ratio.value = 12;
    this.muffle = this.ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 19000;
    this.muffle.Q.value = 0.5;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.ambBus = this.ctx.createGain();
    this.ambBus.gain.value = 1;
    this.sfxBus.connect(this.muffle);
    this.ambBus.connect(this.muffle);
    this.muffle.connect(this.master);
    this.master.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);
  }

  setVolume(v01: number) {
    this.volume = v01;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
  }
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
  }

  private noiseBuffer(seconds = 2, brown = false): NoiseBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.5;
      } else {
        d[i] = white;
      }
    }
    return buf;
  }

  private now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /* ---------- room ambience ---------- */

  startRoomTone() {
    if (!this.ctx || this.roomLoop) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(4, true);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.16, this.now(), 1.2);
    src.connect(lp).connect(gain).connect(this.ambBus!);
    src.start();
    this.roomLoop = { src, gain };
    // CRT / PC hum
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 49.5;
    const humGain = ctx.createGain();
    humGain.gain.value = 0;
    humGain.gain.setTargetAtTime(0.012, this.now(), 0.8);
    const humLp = ctx.createBiquadFilter();
    humLp.type = 'lowpass';
    humLp.frequency.value = 240;
    hum.connect(humLp).connect(humGain).connect(this.ambBus!);
    hum.start();
    this.humLoop = { src: hum, gain: humGain };
    this.scheduleThunder();
  }

  stopRoomTone() {
    if (!this.ctx) return;
    const t = this.now();
    if (this.roomLoop) {
      this.roomLoop.gain.gain.setTargetAtTime(0, t, 0.6);
      const src = this.roomLoop.src;
      window.setTimeout(() => { try { src.stop(); } catch { /* noop */ } }, 2500);
      this.roomLoop = null;
    }
    if (this.humLoop) {
      this.humLoop.gain.gain.setTargetAtTime(0, t, 0.4);
      const h = this.humLoop.src;
      window.setTimeout(() => { try { h.stop(); } catch { /* noop */ } }, 2000);
      this.humLoop = null;
    }
    if (this.thunderTimer) { window.clearTimeout(this.thunderTimer); this.thunderTimer = null; }
  }

  private scheduleThunder() {
    if (this.thunderTimer) window.clearTimeout(this.thunderTimer);
    const delay = 38000 + Math.random() * 42000;
    this.thunderTimer = window.setTimeout(() => {
      this.thunder();
      this.scheduleThunder();
    }, delay);
  }

  thunder() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(3.2, true);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(90, t);
    lp.frequency.exponentialRampToValueAtTime(420, t + 0.4);
    lp.frequency.exponentialRampToValueAtTime(70, t + 2.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.0);
    src.connect(lp).connect(g).connect(this.ambBus!);
    src.start(t);
    src.stop(t + 3.2);
  }

  /* ---------- world ambience ---------- */

  startWorldDrone() {
    if (!this.ctx || this.worldLoop) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(5, false);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 240;
    bp.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.05, this.now(), 2.0);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    lfo.connect(lfoGain).connect(bp.frequency);
    src.connect(bp).connect(gain).connect(this.ambBus!);
    src.start();
    lfo.start();
    // deep twin drones
    const mkDrone = (freq: number, level: number) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(level, this.now(), 2.4);
      o.connect(g).connect(this.ambBus!);
      o.start();
      return { o, g };
    };
    mkDrone(55, 0.11);
    mkDrone(55.7, 0.1);
    mkDrone(110.3, 0.035);
    this.worldLoop = { src, gain, lfo };
    this.schedulePing();
  }

  stopWorldDrone() {
    if (!this.ctx || !this.worldLoop) return;
    const t = this.now();
    this.worldLoop.gain.gain.setTargetAtTime(0, t, 0.8);
    const { src, lfo } = this.worldLoop;
    window.setTimeout(() => { try { src.stop(); lfo.stop(); } catch { /* noop */ } }, 3000);
    this.worldLoop = null;
    if (this.pingTimer) { window.clearTimeout(this.pingTimer); this.pingTimer = null; }
  }

  private schedulePing() {
    if (this.pingTimer) window.clearTimeout(this.pingTimer);
    this.pingTimer = window.setTimeout(() => {
      this.voidPing();
      this.schedulePing();
    }, 6500 + Math.random() * 9000);
  }

  voidPing() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    const base = [1244, 1568, 1868, 2093][Math.floor(Math.random() * 4)];
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = base * (0.97 + Math.random() * 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.36;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    o.connect(g);
    g.connect(this.ambBus!);
    g.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(this.ambBus!);
    o.start(t);
    o.stop(t + 2.6);
  }

  /* ---------- one-shots ---------- */

  footstep(running: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.09);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380 + Math.random() * 320;
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    const peak = running ? 0.5 : 0.3;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
    src.connect(bp).connect(g).connect(this.sfxBus!);
    src.start(t);
    src.stop(t + 0.1);
  }

  uiHover() { this.blip(1900, 0.012, 0.012, 'sine'); }
  uiClick() { this.blip(1500, 0.05, 0.05, 'square', 900); }
  uiDeny() { this.blip(140, 0.16, 0.14, 'square', 90); }
  uiConfirm() { this.blip(880, 0.09, 0.08, 'sine', 1320); }

  private blip(freq: number, dur: number, vol: number, type: OscillatorType, sweepTo?: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** BSOD corruption blip — pitch sinks as corruption rises (0..1) */
  bsodInfect(corruption: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    const startF = 700 - corruption * 420;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(startF, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(38, startF * 0.22), t + 0.34);
    const ws = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = Math.tanh(x * (2 + corruption * 9));
    }
    ws.curve = curve;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.34, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(ws).connect(g).connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 0.45);
    // glitch squelch
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer(0.12);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 1800;
    bp.Q.value = 4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.22 * (0.4 + corruption), t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(bp).connect(ng).connect(this.sfxBus!);
    n.start(t);
    n.stop(t + 0.13);
  }

  whisper() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(1.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(1500, t + 0.7);
    bp.frequency.exponentialRampToValueAtTime(400, t + 1.5);
    bp.Q.value = 9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);
    src.connect(bp).connect(g).connect(this.sfxBus!);
    src.start(t);
    src.stop(t + 1.6);
  }

  /* ---------- devoured sequence ---------- */

  devouredRiser(duration = 6.0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    this.stopRoomTone();
    this.stopWorldDrone();
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(48, t);
    o.frequency.exponentialRampToValueAtTime(720, t + duration);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(120, t);
    lp.frequency.exponentialRampToValueAtTime(5200, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.02, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + duration);
    o.connect(lp).connect(g).connect(this.sfxBus!);
    o.start(t);
    o.stop(t + duration + 0.1);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(30, t);
    sub.frequency.exponentialRampToValueAtTime(64, t + duration);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.15, t);
    sg.gain.exponentialRampToValueAtTime(0.6, t + duration);
    sub.connect(sg).connect(this.sfxBus!);
    sub.start(t);
    sub.stop(t + duration + 0.1);
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(duration);
    const nlp = ctx.createBiquadFilter();
    nlp.type = 'bandpass';
    nlp.Q.value = 2.2;
    nlp.frequency.setValueAtTime(200, t);
    nlp.frequency.exponentialRampToValueAtTime(3600, t + duration);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.03, t);
    ng.gain.exponentialRampToValueAtTime(0.4, t + duration);
    noise.connect(nlp).connect(ng).connect(this.sfxBus!);
    noise.start(t);
    noise.stop(t + duration + 0.1);
    this.riserNodes = [o, sub, noise];
  }

  devouredCut() {
    if (!this.ctx) return;
    const t = this.now();
    for (const n of this.riserNodes) {
      try { n.stop(t + 0.02); } catch { /* noop */ }
    }
    this.riserNodes = [];
    // hard silence thump
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 0.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    o.connect(g).connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 1.15);
  }

  tunnelRush(duration = 4.0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(duration + 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(160, t);
    bp.frequency.exponentialRampToValueAtTime(1400, t + duration * 0.75);
    bp.frequency.exponentialRampToValueAtTime(90, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + duration * 0.72);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    noise.connect(bp).connect(g).connect(this.sfxBus!);
    noise.start(t);
    noise.stop(t + duration + 0.5);
    // doppler groans passing by
    for (let i = 0; i < 5; i++) {
      const pt = t + 0.5 + i * (duration / 5.4) + Math.random() * 0.3;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(160 + Math.random() * 120, pt);
      o.frequency.exponentialRampToValueAtTime(52, pt + 0.7);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, pt);
      og.gain.linearRampToValueAtTime(0.12, pt + 0.09);
      og.gain.exponentialRampToValueAtTime(0.001, pt + 0.8);
      o.connect(og).connect(this.sfxBus!);
      o.start(pt);
      o.stop(pt + 0.9);
    }
  }

  /* ---------- collapse sequence ---------- */

  groan() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(34, t);
    o.frequency.linearRampToValueAtTime(29, t + 2.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.42, t + 0.3);
    g.gain.setValueAtTime(0.42, t + 2.0);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.8);
    o.connect(lp).connect(g).connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 2.9);
  }

  tear() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    for (let i = 0; i < 5; i++) {
      const pt = t + i * 0.155 + Math.random() * 0.06;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(0.22);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 480 + Math.random() * 900 + i * 220;
      bp.Q.value = 5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, pt);
      g.gain.exponentialRampToValueAtTime(0.001, pt + 0.22);
      src.connect(bp).connect(g).connect(this.sfxBus!);
      src.start(pt);
      src.stop(pt + 0.24);
    }
  }

  boom(big = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(52, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 1.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(1.0 * big, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    o.connect(g).connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 1.65);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5 * big, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(lp).connect(ng).connect(this.sfxBus!);
    src.start(t);
    src.stop(t + 0.55);
  }

  startFallWind() {
    if (!this.ctx || this.fallWind) return;
    const ctx = this.ctx, t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(3, false);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(120, t);
    filter.frequency.exponentialRampToValueAtTime(1900, t + 5.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.55, t + 5.0);
    src.connect(filter).connect(gain).connect(this.sfxBus!);
    src.start(t);
    this.fallWind = { src, gain, filter };
  }

  stopFallWind() {
    if (!this.ctx || !this.fallWind) return;
    const t = this.now();
    this.fallWind.gain.gain.setTargetAtTime(0, t, 0.25);
    const src = this.fallWind.src;
    window.setTimeout(() => { try { src.stop(); } catch { /* noop */ } }, 1500);
    this.fallWind = null;
  }

  heartbeat(bpm = 132, beats = 6) {
    if (!this.ctx) return;
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
    let count = 0;
    const interval = 60000 / bpm;
    const thump = (strong: boolean) => {
      if (!this.ctx) return;
      const ctx = this.ctx, t = this.now();
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(strong ? 62 : 50, t);
      o.frequency.exponentialRampToValueAtTime(34, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(strong ? 0.5 : 0.3, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g).connect(this.sfxBus!);
      o.start(t);
      o.stop(t + 0.22);
    };
    thump(true);
    this.heartbeatTimer = window.setInterval(() => {
      thump(count % 2 === 0);
      count++;
      if (count >= beats * 2 && this.heartbeatTimer) {
        window.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }, interval / 2);
  }

  impact() {
    if (!this.ctx) return;
    const t = this.now();
    this.boom(1.25);
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(3400, t);
    o.frequency.exponentialRampToValueAtTime(2600, t + 1.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(g).connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 2.3);
  }

  /** Muffle everything (post-landing ringing ears), then slowly recover. */
  setMuffle(on: boolean) {
    if (!this.ctx || !this.muffle) return;
    const t = this.now();
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setTargetAtTime(on ? 640 : 19000, t, on ? 0.05 : 1.6);
  }

  consoleBeep(ok = true) {
    this.blip(ok ? 980 : 220, ok ? 0.07 : 0.14, 0.05, ok ? 'sine' : 'square', ok ? 1400 : 140);
  }

  wakeConfirmed() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    const notes = [523.25, 659.25, 987.77, 1318.5];
    notes.forEach((f, i) => {
      const pt = t + i * 0.13;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, pt);
      g.gain.linearRampToValueAtTime(0.16, pt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, pt + 1.6);
      o.connect(g).connect(this.sfxBus!);
      o.start(pt);
      o.stop(pt + 1.7);
    });
  }
}
