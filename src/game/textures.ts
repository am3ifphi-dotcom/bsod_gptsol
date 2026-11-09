/* Procedural canvas textures — no external assets. */
import * as THREE from 'three';

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')! };
}

function toTexture(canvas: HTMLCanvasElement, repeat?: [number, number]) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

/** Deterministic pseudo-random from a string seed. */
export function seededRandom(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = Math.imul(h ^ (h >>> 16), 1911520717);
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 4294967296;
  };
}

export const valueNoise2D = (() => {
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    const u = smooth(xf), v = smooth(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
})();

export function fbm2(x: number, y: number, octaves = 3) {
  let amp = 0.55, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2D(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.52;
    freq *= 2.13;
  }
  return sum / norm;
}

/** Warm dark wood for the desk. */
export function makeWoodTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 512);
  ctx.fillStyle = '#3a2417';
  ctx.fillRect(0, 0, 512, 512);
  const rnd = seededRandom('desk-wood');
  for (let i = 0; i < 46; i++) {
    const y = rnd() * 512;
    const h = 4 + rnd() * 22;
    const shade = rnd();
    ctx.fillStyle = shade < 0.33 ? '#2c1a10' : shade < 0.66 ? '#46301e' : '#513824';
    ctx.globalAlpha = 0.35 + rnd() * 0.4;
    ctx.fillRect(0, y, 512, h);
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#120904';
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      const yy = y + rnd() * h;
      ctx.moveTo(0, yy);
      for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, yy + Math.sin(x * 0.02 + i) * 3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // vignette wear
  const g = ctx.createRadialGradient(256, 256, 120, 256, 256, 380);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  return toTexture(canvas, [1, 1]);
}

/** Circuit-grid ground emissive for the glitch world. */
export function makeCircuitGridTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(1024, 1024);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 1024, 1024);
  const rnd = seededRandom('circuit');
  ctx.strokeStyle = '#0d3b66';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 16; i++) {
    const p = i * 64 + 0.5;
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 1024); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(1024, p); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // traces
  for (let i = 0; i < 130; i++) {
    ctx.strokeStyle = rnd() < 0.24 ? '#57e6ff' : '#1d5f96';
    ctx.lineWidth = rnd() < 0.24 ? 2.4 : 1.4;
    ctx.globalAlpha = 0.5 + rnd() * 0.5;
    let x = Math.floor(rnd() * 16) * 64 + 32;
    let y = Math.floor(rnd() * 16) * 64 + 32;
    ctx.beginPath(); ctx.moveTo(x, y);
    const segs = 3 + Math.floor(rnd() * 5);
    for (let s = 0; s < segs; s++) {
      const horizontal = rnd() < 0.5;
      const len = (1 + Math.floor(rnd() * 3)) * 64;
      if (horizontal) x += (rnd() < 0.5 ? -1 : 1) * len; else y += (rnd() < 0.5 ? -1 : 1) * len;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#6df2ff';
    ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill();
  }
  return toTexture(canvas, [6, 6]);
}

/** Vertical column of glyphs — "log rain" debris planes. */
export function makeGlyphColumnTexture(seed: string, hue: 'cyan' | 'amber' | 'red' | 'white'): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 512);
  const rnd = seededRandom(seed);
  ctx.clearRect(0, 0, 128, 512);
  const palette = {
    cyan: ['#8df3ff', '#37b9e8', '#1b6f9e'],
    amber: ['#ffd88d', '#e8a93b', '#9e6b1b'],
    red: ['#ff9d9d', '#e84b3b', '#9e231b'],
    white: ['#ffffff', '#bcd8ff', '#5f87b8'],
  }[hue];
  const glyphs = '01A3F4C9E7B2:_[]{}<>/\\|=+-*#@!CRASHNULLFAULTE?';
  ctx.font = '600 21px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  for (let y = 24; y < 512; y += 26) {
    const roll = rnd();
    if (roll < 0.12) continue; // gaps
    ctx.globalAlpha = 0.25 + rnd() * 0.75;
    ctx.fillStyle = palette[rnd() < 0.72 ? 0 : 1];
    const len = 1 + Math.floor(rnd() * 4);
    let s = '';
    for (let i = 0; i < len; i++) s += glyphs[Math.floor(rnd() * glyphs.length)];
    ctx.fillText(s, 64, y);
  }
  return toTexture(canvas);
}

/** Jagged crack — glowing edges on transparent background. */
export function makeCrackTexture(seed = 'crack'): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 512);
  const rnd = seededRandom(seed);
  ctx.clearRect(0, 0, 512, 512);
  const bolt = (x0: number, y0: number, x1: number, y1: number, width: number, depth: number) => {
    const steps = 26;
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + (x1 - x0) * t + (rnd() - 0.5) * 66 * Math.sin(t * Math.PI);
      const py = y0 + (y1 - y0) * t + (rnd() - 0.5) * 66 * Math.sin(t * Math.PI);
      pts.push([px, py]);
    }
    // outer glow
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(120,235,255,0.5)';
    ctx.lineWidth = width + 14;
    ctx.shadowColor = '#57e6ff';
    ctx.shadowBlur = 26;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    // core dark tear
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#02070f';
    ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    if (depth > 0) {
      const mid = pts[Math.floor(steps * 0.55)];
      bolt(mid[0], mid[1], mid[0] + (rnd() - 0.5) * 260, mid[1] + 120 + rnd() * 130, width * 0.55, depth - 1);
    }
  };
  bolt(256, 30, 236, 480, 15, 2);
  bolt(256, 170, 90, 330, 9, 1);
  bolt(246, 240, 420, 400, 8, 1);
  return toTexture(canvas);
}

/** Ring of glyphs — used on the dais halo. */
export function makeRuneRingTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(1024, 128);
  ctx.clearRect(0, 0, 1024, 128);
  const rnd = seededRandom('runering');
  const glyphs = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0F9E4B7:_';
  ctx.font = '600 44px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let x = 32; x < 1024; x += 54) {
    ctx.globalAlpha = 0.45 + rnd() * 0.55;
    ctx.fillStyle = rnd() < 0.2 ? '#ffffff' : '#7deeff';
    ctx.fillText(glyphs[Math.floor(rnd() * glyphs.length)], x, 64);
  }
  return toTexture(canvas, [4, 1]);
}

/** The WAKE_UP revelation text. */
export function makeWakeTextTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(1024, 256);
  ctx.clearRect(0, 0, 1024, 256);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#4df3ff';
  ctx.shadowBlur = 34;
  ctx.font = '700 132px "IBM Plex Mono", "Courier New", monospace';
  ctx.fillStyle = '#eafcff';
  ctx.fillText('WAKE_UP', 512, 122);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.6;
  ctx.font = '500 26px "IBM Plex Mono", monospace';
  ctx.fillStyle = '#8df3ff';
  ctx.fillText('— 復帰コマンド —', 512, 214);
  return toTexture(canvas);
}

/** Fake modal error dialog for floating UI debris. */
export function makeDialogTexture(seed: string, title: string, message: string): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 320);
  const rnd = seededRandom(seed);
  // window chrome
  ctx.fillStyle = '#c8ccd4';
  ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = '#0a246a';
  ctx.fillRect(0, 0, 512, 46);
  // title bar icon
  ctx.fillStyle = '#f4c430';
  ctx.beginPath(); ctx.moveTo(12, 32); ctx.lineTo(30, 12); ctx.lineTo(48, 32); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#0a246a';
  ctx.fillRect(28, 19, 4, 9);
  ctx.fillRect(28, 30, 4, 3.4);
  // title
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 21px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(title, 62, 30);
  // close button
  ctx.fillStyle = '#d63c2f';
  ctx.fillRect(452, 8, 36, 30);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(463, 15); ctx.lineTo(477, 31); ctx.moveTo(477, 15); ctx.lineTo(463, 31); ctx.stroke();
  // body
  ctx.fillStyle = '#eceef2';
  ctx.fillRect(0, 46, 512, 274);
  ctx.fillStyle = '#1a1c22';
  ctx.font = '500 17px "IBM Plex Mono", monospace';
  const words = message.split(' ');
  let line = '';
  let y = 92;
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 40) {
      ctx.fillText(line.trim(), 28, y);
      y += 26;
      line = w;
    } else {
      line += ' ' + w;
    }
  }
  ctx.fillText(line.trim(), 28, y);
  ctx.fillStyle = '#8a8f9c';
  ctx.font = '400 13px "IBM Plex Mono", monospace';
  ctx.fillText(`エラー 0x${Math.floor(rnd() * 0xffffff).toString(16).toUpperCase().padStart(6, '0')}`, 28, 236);
  // OK button
  ctx.fillStyle = '#0a246a';
  ctx.fillRect(186, 254, 140, 38);
  ctx.strokeStyle = '#7d84a0';
  ctx.lineWidth = 2;
  ctx.strokeRect(186, 254, 140, 38);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 18px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('OK', 256, 279);
  return toTexture(canvas);
}

/** Soft particle sprite. */
export function makeDotTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(220,240,255,0.7)');
  g.addColorStop(1, 'rgba(200,230,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(canvas);
}

/** Horizontal light streak for speed lines while falling. */
export function makeStreakTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 32);
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, 'rgba(140,240,255,0)');
  g.addColorStop(0.5, 'rgba(190,250,255,0.9)');
  g.addColorStop(1, 'rgba(140,240,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 32);
  return toTexture(canvas);
}
