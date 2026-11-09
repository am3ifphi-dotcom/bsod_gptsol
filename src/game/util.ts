export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const saturate = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const mapRange = (v: number, a: number, b: number, c: number, d: number) =>
  lerp(c, d, saturate(invLerp(a, b, v)));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = saturate((v - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
};

export const easeInQuad = (t: number) => t * t;
export const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
export const easeInCubic = (t: number) => t * t * t;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
export const easeInOutQuart = (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInExpo = (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10));
export const easeOutBack = (t: number, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);

/** Frame-rate independent exponential smoothing. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const dampAngle = (current: number, target: number, lambda: number, dt: number) => {
  let d = ((target - current + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return current + d * (1 - Math.exp(-lambda * dt));
};

/** Critically damped spring (head inertia). */
export class Spring {
  value: number;
  velocity = 0;
  constructor(value = 0) {
    this.value = value;
  }
  update(target: number, stiffness: number, damping: number, dt: number) {
    const dtc = Math.min(dt, 1 / 30);
    const a = (target - this.value) * stiffness - this.velocity * damping;
    this.velocity += a * dtc;
    this.value += this.velocity * dtc;
    return this.value;
  }
  reset(v: number) {
    this.value = v;
    this.velocity = 0;
  }
}

export class Spring3 {
  x: Spring;
  y: Spring;
  z: Spring;
  constructor(x = 0, y = 0, z = 0) {
    this.x = new Spring(x);
    this.y = new Spring(y);
    this.z = new Spring(z);
  }
  reset(x: number, y: number, z: number) {
    this.x.reset(x);
    this.y.reset(y);
    this.z.reset(z);
  }
}

/* ------------------------------------------------------------------ *
 * Deterministic pseudo-random + value noise (no external dependency)
 * ------------------------------------------------------------------ */
export const hash1 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
};
export const hash2 = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + 71.3) * 43758.5453123;
  return s - Math.floor(s);
};
export const hash3 = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + 17.13) * 43758.5453123;
  return s - Math.floor(s);
};

const fade = (t: number) => t * t * (3 - 2 * t);
const grad1 = (i: number) => hash1(i) * 2 - 1;

export const noise1 = (x: number) => {
  const i = Math.floor(x);
  const f = x - i;
  const u = fade(f);
  return lerp(grad1(i), grad1(i + 1), u);
};

/** Smooth 2D value noise in [-1,1]. */
export const noise2 = (x: number, y: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = hash2(ix, iy) * 2 - 1;
  const b = hash2(ix + 1, iy) * 2 - 1;
  const c = hash2(ix, iy + 1) * 2 - 1;
  const d = hash2(ix + 1, iy + 1) * 2 - 1;
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
};

export const fbm2 = (x: number, y: number, octaves = 4) => {
  let amp = 0.5;
  let sum = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(fx, fy) * amp;
    fx *= 2.03;
    fy *= 2.01;
    amp *= 0.5;
  }
  return sum;
};

/** Handheld-camera style multi-frequency drift. */
export const handheld = (t: number, seed = 0) =>
  noise1(t * 0.34 + seed * 13.7) * 0.6 + noise1(t * 0.91 + seed * 51.3) * 0.3 + noise1(t * 2.7 + seed * 7.1) * 0.1;

/** Deterministic PRNG. */
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    // xorshift32
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
}

export const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

/** Small typed event emitter. */
export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<(v: never) => void>>();
  on<K extends keyof E>(name: K, cb: (v: E[K]) => void) {
    let set = this.map.get(name);
    if (!set) {
      set = new Set();
      this.map.set(name, set);
    }
    set.add(cb as (v: never) => void);
    return () => set!.delete(cb as (v: never) => void);
  }
  emit<K extends keyof E>(name: K, value: E[K]) {
    const set = this.map.get(name);
    if (!set) return;
    for (const cb of set) (cb as (v: E[K]) => void)(value);
  }
}
