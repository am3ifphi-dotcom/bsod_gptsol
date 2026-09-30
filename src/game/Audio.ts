export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private rain: GainNode | null = null;
  private drones: OscillatorNode[] = [];
  private droneGains: GainNode[] = [];
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.45;
  private muted = false;
  private paused = false;
  private scene: 'room' | 'world' | 'fall' = 'room';

  async start() {
    if (!this.context) {
      const AudioConstructor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioConstructor) return;
      try {
        this.context = new AudioConstructor();
        const ctx = this.context;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(ctx.destination);
        this.ambience = ctx.createGain();
        this.ambience.gain.value = 0.3;
        this.ambience.connect(this.master);
        [43, 64.6, 129.2].forEach((frequency, index) => {
          const oscillator = ctx.createOscillator();
          oscillator.type = index === 2 ? 'triangle' : 'sine';
          oscillator.frequency.value = frequency;
          const gain = ctx.createGain();
          gain.gain.value = index === 0 ? 0.17 : 0.04;
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 230;
          oscillator.connect(filter);
          filter.connect(gain);
          gain.connect(this.ambience!);
          oscillator.start();
          this.drones.push(oscillator);
          this.droneGains.push(gain);
        });
        this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i++) {
          last = (last + (Math.random() * 2 - 1) * 0.06) / 1.06;
          data[i] = last * 3;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        noise.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1200;
        this.rain = ctx.createGain();
        this.rain.gain.value = 0.1;
        noise.connect(filter);
        filter.connect(this.rain);
        this.rain.connect(this.master);
        noise.start();
      } catch {
        return;
      }
    }
    if (this.context.state === 'suspended') await this.context.resume().catch(() => undefined);
  }

  setVolume(volume: number, muted: boolean) {
    this.volume = volume;
    this.muted = muted;
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : volume * (this.paused ? 0.35 : 1), this.context.currentTime, 0.08);
    }
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.setVolume(this.volume, this.muted);
  }

  setScene(scene: 'room' | 'world' | 'fall') {
    if (!this.context || this.scene === scene) return;
    this.scene = scene;
    const now = this.context.currentTime;
    const frequencies = scene === 'room' ? [43, 64.6, 129.2] : scene === 'world' ? [34, 51.1, 102.2] : [26, 39.1, 78.2];
    this.drones.forEach((drone, i) => drone.frequency.setTargetAtTime(frequencies[i], now, 1.8));
    this.rain?.gain.setTargetAtTime(scene === 'room' ? 0.1 : scene === 'world' ? 0.023 : 0.28, now, 1);
  }

  update(time: number, tension: number) {
    if (!this.context || !this.ambience) return;
    const breath = Math.sin(time * 0.4) * 0.03;
    const base = this.scene === 'room' ? 0.26 : 0.5;
    this.ambience.gain.setTargetAtTime(base + breath + tension * 0.3, this.context.currentTime, 0.12);
  }

  tone(frequency: number, duration = 0.12, volume = 0.1, target?: number) {
    if (!this.context || !this.master) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    if (target) oscillator.frequency.exponentialRampToValueAtTime(target, now + duration);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start();
    oscillator.stop(now + duration + 0.03);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }

  noise(duration = 0.2, volume = 0.08, frequency = 800) {
    if (!this.context || !this.master || !this.noiseBuffer) return;
    const ctx = this.context;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(0, Math.random());
    source.stop(ctx.currentTime + duration);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  step(world: boolean) {
    this.tone(world ? 95 : 66, 0.12, 0.07, 28);
    this.noise(0.13, world ? 0.025 : 0.055, 600);
  }

  crack() {
    this.noise(0.65, 0.32, 3300);
    this.tone(74, 0.9, 0.2, 23);
  }

  land() {
    this.tone(65, 0.65, 0.34, 21);
    this.noise(0.45, 0.23, 500);
  }

  dispose() {
    this.drones.forEach((drone) => {
      try { drone.stop(); } catch { /* An already stopped audio context needs no cleanup. */ }
    });
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.drones = [];
  }
}