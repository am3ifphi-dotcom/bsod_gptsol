import type { AudioName, Assets } from "./assets";
import { clamp, damp } from "./util";

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  base: number;
  name: AudioName;
  loop: boolean;
  stopped?: boolean;
}

/**
 * Small WebAudio mixer: looping beds with fades, one-shots with light randomisation,
 * simple stereo panning and a master volume that the pause menu can duck.
 */
export class AudioEngine {
  private ctx: AudioContext;
  private master: GainNode;
  private duck: GainNode;
  private buffers: Map<AudioName, AudioBuffer>;
  private beds = new Map<string, Voice>();
  private shots = new Set<Voice>();
  private muted = false;
  private targetVolume = 0.85;
  private lastFootstep = 0;
  private pending: { name: AudioName; delay: number }[] = [];

  constructor(ctx: AudioContext, assets: Assets) {
    this.ctx = ctx;
    this.buffers = assets.audio;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.duck = ctx.createGain();
    this.duck.gain.value = 1;
    this.master.connect(this.duck);
    this.duck.connect(ctx.destination);
  }

  resume() {
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.targetVolume, this.ctx.currentTime, 0.6);
  }

  setVolume(v: number) {
    this.targetVolume = clamp(v, 0, 1);
    if (!this.muted) this.master.gain.setTargetAtTime(this.targetVolume, this.ctx.currentTime, 0.2);
  }

  get volume() {
    return this.targetVolume;
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : this.targetVolume, this.ctx.currentTime, 0.15);
  }

  get isMuted() {
    return this.muted;
  }

  /** Duck the whole mix (pause menu, desktop tab blur). */
  setDuck(amount: number, time = 0.3) {
    this.duck.gain.setTargetAtTime(amount, this.ctx.currentTime, time);
  }

  private makeVoice(name: AudioName, volume: number, loop: boolean, rate: number, pan: number): Voice | null {
    const buf = this.buffers.get(name);
    if (!buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(volume, this.ctx.currentTime, loop ? 1.2 : 0.01);
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    src.connect(gain);
    gain.connect(panner);
    panner.connect(this.master);
    src.start();
    const voice: Voice = { src, gain, base: volume, name, loop };
    src.onended = () => {
      voice.stopped = true;
    };
    return voice;
  }

  /** Start (or restart) a named looping bed. */
  bed(id: string, name: AudioName, volume: number, opts: { rate?: number; pan?: number; fade?: number } = {}) {
    const existing = this.beds.get(id);
    if (existing) {
      this.setBedGain(id, volume, opts.fade ?? 1.2);
      return;
    }
    const v = this.makeVoice(name, volume, true, opts.rate ?? 1, opts.pan ?? 0);
    if (!v) return;
    this.beds.set(id, v);
  }

  setBedGain(id: string, volume: number, fade = 0.8) {
    const v = this.beds.get(id);
    if (!v) return;
    v.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, Math.max(0.02, fade / 3));
  }

  stopBed(id: string, fade = 1.4) {
    const v = this.beds.get(id);
    if (!v) return;
    this.beds.delete(id);
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0.0001, t + fade);
    try {
      v.src.stop(t + fade + 0.05);
    } catch {
      /* already stopped */
    }
  }

  stopAllBeds(fade = 1.2) {
    for (const id of [...this.beds.keys()]) this.stopBed(id, fade);
  }

  play(name: AudioName, opts: { volume?: number; rate?: number; pan?: number; delay?: number } = {}) {
    const v = opts.volume ?? 0.6;
    if (opts.delay && opts.delay > 0) {
      this.pending.push({ name, delay: opts.delay });
      return;
    }
    const voice = this.makeVoice(name, v, false, opts.rate ?? 1, opts.pan ?? 0);
    if (!voice) return;
    this.shots.add(voice);
    voice.src.onended = () => this.shots.delete(voice);
  }

  update(dt: number) {
    if (this.pending.length) {
      const still: typeof this.pending = [];
      for (const p of this.pending) {
        p.delay -= dt;
        if (p.delay <= 0) this.play(p.name, { volume: 0.6 });
        else still.push(p);
      }
      this.pending = still;
    }
    // distance-based footstep fades handled by caller
    void dt;
  }

  footstep(run: boolean) {
    const now = this.ctx.currentTime;
    if (now - this.lastFootstep < (run ? 0.26 : 0.4)) return;
    this.lastFootstep = now;
    this.play("footstep_wood", {
      volume: run ? 0.32 : 0.22,
      rate: 0.9 + Math.random() * 0.2,
      pan: (Math.random() - 0.5) * 0.2,
    });
  }

  /** Fade a looping bed's gain with exponential smoothing for scripted sequences. */
  tickBed(id: string, target: number, lambda = 2, dt = 0.016) {
    const v = this.beds.get(id);
    if (!v) return;
    const next = damp(v.gain.gain.value, target, lambda, dt);
    v.gain.gain.setTargetAtTime(next, this.ctx.currentTime, 0.05);
  }

  dispose() {
    this.stopAllBeds(0.1);
    for (const v of this.shots) {
      try {
        v.src.stop();
      } catch {
        /* noop */
      }
    }
  }
}
