import * as THREE from "three";
import { TAU, clamp, hash2, lerp, saturate } from "./util";

const MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
const JP = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif';

const BSOD_BLUE = "#0a63c9";
const BSOD_BLUE_DARK = "#064a9c";

function canvas2d(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.textBaseline = "alphabetic";
  return { c, ctx };
}

function tex(c: HTMLCanvasElement, opts: { srgb?: boolean; aniso?: number } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 4;
  t.needsUpdate = true;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

/* ------------------------------------------------------------------ *
 * BSOD surface — redrawn while the player stares at it
 * ------------------------------------------------------------------ */
export class BsodScreen {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  private base: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private t = 0;
  private last = -1;
  private percent = 0;
  private percentClock = 0;
  private dirty = true;
  private corruption = 0;
  private mouse = { x: 0.5, y: 0.5 };
  private readout = "CRITICAL_PROCESS_DIED";
  private grown = 0;

  constructor(readonly w = 1280, readonly h = 720) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext("2d")!;
    this.base = document.createElement("canvas");
    this.base.width = w;
    this.base.height = h;
    this.baseCtx = this.base.getContext("2d")!;
    this.texture = tex(this.canvas);
    this.drawBase();
    this.draw();
  }

  private drawBase() {
    const { w, h } = this;
    const ctx = this.baseCtx;
    const g = ctx.createLinearGradient(0, 0, w * 0.35, h);
    g.addColorStop(0, BSOD_BLUE);
    g.addColorStop(0.55, "#0a5fc4");
    g.addColorStop(1, BSOD_BLUE_DARK);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // very subtle dark breathing space so text stays legible
    const rg = ctx.createRadialGradient(w * 0.42, h * 0.42, 0, w * 0.42, h * 0.42, w * 0.72);
    rg.addColorStop(0, "rgba(255,255,255,0.05)");
    rg.addColorStop(1, "rgba(0,0,0,0.16)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.round(h * 0.26)}px ${MONO}`;
    ctx.fillText(":(", w * 0.075, h * 0.36);

    ctx.font = `400 ${Math.round(h * 0.052)}px ${JP}`;
    ctx.fillText("お使いの PC で問題が発生したため、", w * 0.075, h * 0.47);
    ctx.fillText("再起動する必要があります。", w * 0.075, h * 0.47 + h * 0.075);
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = `400 ${Math.round(h * 0.038)}px ${JP}`;
    ctx.fillText("エラー情報を収集しています。自動的に再起動します。", w * 0.075, h * 0.585);

    // progress
    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${Math.round(h * 0.058)}px ${MONO}`;
    this.baseCtx.fillText("0% 完了", w * 0.075, h * 0.70);

    // fake QR
    const qs = h * 0.2;
    const qx = w * 0.72;
    const qy = h * 0.47;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(qx, qy, qs, qs);
    ctx.fillStyle = "#0a63c9";
    const cell = qs / 25;
    for (let y = 0; y < 25; y++) {
      for (let x = 0; x < 25; x++) {
        const edge = x < 7 && y < 7 ? false : x > 17 && y < 7 ? false : x < 7 && y > 17 ? false : true;
        if (!edge) continue;
        if (hash2(x * 1.7, y * 2.3) > 0.52) ctx.fillRect(qx + x * cell, qy + y * cell, cell * 0.94, cell * 0.94);
      }
    }
    const finder = (fx: number, fy: number) => {
      ctx.fillStyle = "#0a63c9";
      ctx.fillRect(fx, fy, cell * 7, cell * 7);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(fx + cell, fy + cell, cell * 5, cell * 5);
      ctx.fillStyle = "#0a63c9";
      ctx.fillRect(fx + cell * 2, fy + cell * 2, cell * 3, cell * 3);
    };
    finder(qx, qy);
    finder(qx + cell * 18, qy);
    finder(qx, qy + cell * 18);

    // footer
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `400 ${Math.round(h * 0.03)}px ${MONO}`;
    ctx.fillText("詳細については、次の URL を参照してください:", w * 0.075, h * 0.80);
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText("https://null.studio/stopcode", w * 0.075, h * 0.845);
    ctx.fillStyle = "#ffffff";
    ctx.font = `500 ${Math.round(h * 0.028)}px ${MONO}`;
    ctx.fillText(`停止コード: ${this.readout}`, w * 0.075, h * 0.905);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `400 ${Math.round(h * 0.024)}px ${MONO}`;
    ctx.fillText("失敗した処理: NULL_STUDIO.sys", w * 0.075, h * 0.945);
  }

  private faceSilhouette(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number, k: number) {
    const N = 96;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * TAU;
      const wob =
        1 +
        0.075 * Math.sin(a * 5 + t * 1.6) +
        0.05 * Math.sin(a * 11 - t * 2.3) +
        0.028 * Math.sin(a * 23 + t * 4.1) +
        k * 0.09 * Math.sin(a * 37 + t * 7.3);
      const x = cx + Math.cos(a) * r * 0.82 * wob;
      const y = cy + Math.sin(a) * r * 1.06 * wob;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  private drawFace(ctx: CanvasRenderingContext2D, k: number) {
    const { w, h } = this;
    const t = this.t;
    const cx = w * 0.5 + Math.sin(t * 0.7) * w * 0.006;
    const cy = h * 0.48 + Math.cos(t * 0.53) * h * 0.008;
    const r = h * (0.16 + k * 0.37);
    const alpha = saturate((k - 0.16) / 0.3);
    if (alpha <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = alpha;

    // head
    this.faceSilhouette(ctx, cx, cy, r, t, k);
    const g = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.35, r * 0.1, cx, cy, r * 1.25);
    const bright = lerp(0.86, 1, k);
    g.addColorStop(0, `rgba(255,255,255,${bright})`);
    g.addColorStop(0.55, "rgba(232,244,255,0.96)");
    g.addColorStop(1, "rgba(150,196,240,0.9)");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,20,50,0.35)";
    ctx.lineWidth = Math.max(1, r * 0.01);
    ctx.stroke();

    // eye sockets
    const eyeR = r * (0.2 + k * 0.08);
    const eyeX = r * 0.34;
    const eyeY = -r * 0.22;
    const px = (this.mouse.x - 0.5) * eyeR * 0.55;
    const py = (this.mouse.y - 0.5) * eyeR * 0.55;
    for (const s of [-1, 1]) {
      const ex = cx + s * eyeX;
      const ey = cy + eyeY;
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * TAU;
        const wob = 1 + 0.1 * Math.sin(a * 7 + t * 3 + s) + k * 0.2 * Math.sin(a * 17 - t * 5.5);
        const x = ex + Math.cos(a) * eyeR * 0.85 * wob;
        const y = ey + Math.sin(a) * eyeR * 1.25 * wob;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(2,16,38,0.96)";
      ctx.fill();
      // pupil
      ctx.beginPath();
      ctx.fillStyle = "rgba(220,242,255,0.95)";
      ctx.arc(ex + px, ey + py, eyeR * (0.22 + 0.05 * Math.sin(t * 2.1)), 0, TAU);
      ctx.fill();
      // bleeding tear streaks
      if (k > 0.45) {
        ctx.strokeStyle = "rgba(2,16,38,0.5)";
        ctx.lineWidth = Math.max(1, r * 0.02);
        for (let i = 0; i < 3; i++) {
          const sx = ex + (i - 1) * eyeR * 0.5;
          const len = eyeR * (0.6 + 0.5 * Math.abs(Math.sin(t * 0.9 + i + s)));
          ctx.beginPath();
          ctx.moveTo(sx, ey + eyeR * 0.6);
          ctx.lineTo(sx + Math.sin(t + i) * 3, ey + eyeR * 0.6 + len);
          ctx.stroke();
        }
      }
    }

    // mouth: opens into a jagged grin
    const open = saturate((k - 0.28) / 0.55);
    const mw = r * (0.38 + open * 0.42);
    const mh = r * (0.05 + open * 0.5);
    const my = cy + r * (0.34 - open * 0.05);
    ctx.beginPath();
    ctx.moveTo(cx - mw, my);
    const teeth = 11;
    for (let i = 0; i <= teeth; i++) {
      const f = i / teeth;
      const x = cx - mw + f * mw * 2;
      const wob = Math.sin(f * Math.PI) * mh;
      ctx.lineTo(x, my + wob * (0.8 + 0.4 * Math.sin(i * 2.1 + t * 1.7)));
    }
    for (let i = teeth; i >= 0; i--) {
      const f = i / teeth;
      const x = cx - mw + f * mw * 2;
      const wob = Math.sin(f * Math.PI) * mh * 0.35;
      ctx.lineTo(x + Math.sin(t * 3 + i) * mw * 0.02, my + wob);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(1,10,26,0.98)";
    ctx.fill();

    // teeth
    if (open > 0.15) {
      ctx.fillStyle = "rgba(236,247,255,0.92)";
      const count = 9;
      for (let i = 0; i < count; i++) {
        const f = (i + 0.5) / count;
        const x = cx - mw + f * mw * 2;
        const th = mh * 0.42 * (0.5 + 0.5 * Math.sin(f * Math.PI));
        ctx.beginPath();
        ctx.moveTo(x - mw * 0.055, my + mh * 0.08);
        ctx.lineTo(x + mw * 0.055, my + mh * 0.08);
        ctx.lineTo(x + Math.sin(t * 2 + i) * mw * 0.01, my + mh * 0.08 + th);
        ctx.closePath();
        ctx.fill();
      }
    }

    // glyph fragments crawling over the face
    if (k > 0.5) {
      ctx.font = `700 ${Math.round(r * 0.09)}px ${MONO}`;
      ctx.fillStyle = "rgba(4,22,48,0.55)";
      const glyphs = ":()/\\01;#%_";
      for (let i = 0; i < 26; i++) {
        const a = hash2(i * 3.1, 7.7) * TAU + t * 0.15 * (i % 2 ? 1 : -1);
        const rr = r * (0.55 + hash2(i * 1.3, 2.1) * 0.7);
        const x = cx + Math.cos(a) * rr * 0.82;
        const y = cy + Math.sin(a) * rr * 1.05;
        ctx.fillText(glyphs[Math.floor(hash2(i, 5.3) * glyphs.length) % glyphs.length], x, y);
      }
    }
    ctx.restore();
  }

  /** Renders one frame of the monitor image. Cost is bounded; caller throttles. */
  draw() {
    const { w, h, ctx } = this;
    this.t += 0.016;
    this.corruption = this.grown;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.base, 0, 0);

    // progress readout
    const pct = Math.floor(this.percent);
    ctx.fillStyle = BSOD_BLUE;
    ctx.fillRect(w * 0.07, h * 0.62, w * 0.42, h * 0.1);
    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${Math.round(h * 0.058)}px ${MONO}`;
    ctx.fillText(`${pct}% 完了`, w * 0.075, h * 0.70);

    const k = this.corruption;

    // the ":(" grows before it becomes a face
    if (k > 0.001) {
      const grow = lerp(1, 2.6, saturate(k / 0.42));
      ctx.save();
      ctx.translate(w * 0.075 + h * 0.13 * grow, h * 0.36);
      ctx.scale(grow, grow);
      ctx.globalAlpha = saturate(1.2 - k * 1.3);
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${Math.round(h * 0.26)}px ${MONO}`;
      ctx.fillText(":(", -h * 0.13, 0);
      ctx.restore();

      // blocks of the BSOD being torn away from the text
      if (k > 0.2) {
        const n = Math.floor(6 + k * 26);
        for (let i = 0; i < n; i++) {
          const seed = i * 7.31 + Math.floor(this.t * 8) * 0.37;
          const bx = (hash2(seed, 1.1) * 0.9 + 0.05) * w;
          const by = (hash2(seed, 9.3) * 0.86 + 0.06) * h;
          const bw = (0.03 + hash2(seed, 4.4) * 0.2) * w;
          const bh = (0.006 + hash2(seed, 6.2) * 0.05) * h;
          const sx = (hash2(seed, 2.2) - 0.5) * 0.08 * w * k;
          ctx.globalAlpha = 0.25 + k * 0.5;
          ctx.drawImage(this.canvas, bx, by, bw, bh, bx + sx, by, bw, bh);
          ctx.globalAlpha = 1;
          if (hash2(seed, 8.8) > 0.82) {
            ctx.fillStyle = `rgba(${230 + 25 * k},${240},255,${0.5 + 0.4 * k})`;
            ctx.fillRect(bx + sx, by, bw * hash2(seed, 3.3), Math.max(1, bh * 0.16));
          }
        }
      }

      // the face takes over
      this.drawFace(ctx, k);

      // dark digital bite marks
      if (k > 0.55) {
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 30; i++) {
          const seed = i * 13.7 + Math.floor(this.t * 12) * 0.91;
          const bx = hash2(seed, 0.7) * w;
          const by = hash2(seed, 0.9) * h;
          const bw = hash2(seed, 1.7) * 90 * (0.4 + k);
          const bh = hash2(seed, 2.9) * 7 * (0.4 + k);
          ctx.fillStyle = hash2(seed, 5.1) > 0.5 ? "rgba(0,10,26,0.75)" : "rgba(220,240,255,0.5)";
          ctx.fillRect(bx, by, bw, bh);
        }
        ctx.globalAlpha = 1;
      }
    }

    // readout corruption
    if (k > 0.62) {
      ctx.fillStyle = "rgba(0,10,30,0.55)";
      ctx.fillRect(0, h * 0.88, w, h * 0.12);
      ctx.fillStyle = "rgba(240,250,255,0.95)";
      ctx.font = `500 ${Math.round(h * 0.04)}px ${MONO}`;
      const noise = ["WAKE UP", "NOT RESPONDING", "LET ME OUT", "あなたはここにいる", "STILL DREAMING"];
      ctx.fillText(noise[Math.floor(this.t * 1.6) % noise.length], w * 0.075, h * 0.955);
    }

    ctx.restore();
    this.texture.needsUpdate = true;
  }

  /** Advance time; redraw at a bounded rate. */
  update(dt: number, corruption: number, mouseUv: { x: number; y: number }) {
    this.t += dt;
    this.grown = corruption;
    this.corruption = corruption;
    this.mouse.x = mouseUv.x;
    this.mouse.y = mouseUv.y;
    this.percentClock += dt;
    if (this.percentClock > 0.22) {
      this.percentClock = 0;
      if (this.percent < 100) this.percent = Math.min(100, this.percent + (corruption > 0.02 ? 0.7 : 0.35));
      this.dirty = true;
    }
    const interval = corruption > 0.02 ? 0.055 : 0.16;
    if (this.dirty || this.t - this.last > interval) {
      this.last = this.t;
      this.dirty = false;
      this.draw();
    }
  }

  /** Frozen frame for the aftermath. */
  updateIdle(dt: number, corruption: number, mouseUv: { x: number; y: number }) {
    this.update(dt, corruption, mouseUv);
  }
}

/* ------------------------------------------------------------------ *
 * Static world textures
 * ------------------------------------------------------------------ */
export const makeGlowTexture = (inner = "rgba(190,230,255,1)", outer = "rgba(20,80,160,0)") => {
  const { c, ctx } = canvas2d(256, 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, "rgba(120,190,255,0.45)");
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return tex(c);
};

export const makeDotTexture = () => {
  const { c, ctx } = canvas2d(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(190,220,255,0.55)");
  g.addColorStop(1, "rgba(120,180,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return tex(c);
};

export const makeTextStrip = (text: string, accent = "#7fc4ff") => {
  const { c, ctx } = canvas2d(1024, 96);
  ctx.clearRect(0, 0, 1024, 96);
  ctx.font = `400 40px ${MONO}`;
  ctx.fillStyle = "rgba(226,240,255,0.95)";
  ctx.textAlign = "left";
  ctx.fillText(text, 24, 62);
  const wtxt = ctx.measureText(text).width;
  ctx.fillStyle = accent;
  ctx.fillRect(24, 74, Math.min(wtxt, 900), 2);
  return tex(c);
};

export const makeGlyphTexture = (glyph: string) => {
  const { c, ctx } = canvas2d(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.font = `700 190px ${MONO}`;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(210,235,255,0.95)";
  ctx.fillText(glyph, 128, 186);
  return tex(c);
};

export const makeWindowTexture = (title: string, body: string[], footer = "") => {
  const W = 768;
  const H = 512;
  const { c, ctx } = canvas2d(W, H);
  ctx.clearRect(0, 0, W, H);
  // frame
  ctx.fillStyle = "rgba(3,16,38,0.86)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(150,200,255,0.5)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
  // title bar
  const g = ctx.createLinearGradient(0, 0, 0, 56);
  g.addColorStop(0, "rgba(18,58,110,0.95)");
  g.addColorStop(1, "rgba(8,30,66,0.95)");
  ctx.fillStyle = g;
  ctx.fillRect(3, 3, W - 6, 54);
  ctx.fillStyle = "rgba(226,240,255,0.92)";
  ctx.font = `500 22px ${MONO}`;
  ctx.fillText(title, 18, 38);
  // window buttons
  const bx = W - 118;
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = "rgba(190,220,255,0.45)";
    ctx.lineWidth = 2;
    ctx.strokeRect(bx + i * 36, 15, 26, 26);
  }
  ctx.beginPath();
  ctx.moveTo(bx + 78 + 6, 21);
  ctx.lineTo(bx + 78 + 20, 35);
  ctx.moveTo(bx + 78 + 20, 21);
  ctx.lineTo(bx + 78 + 6, 35);
  ctx.stroke();
  // body
  ctx.font = `400 24px ${MONO}`;
  ctx.fillStyle = "rgba(226,240,255,0.9)";
  body.forEach((line, i) => ctx.fillText(line, 28, 116 + i * 38));
  if (footer) {
    ctx.fillStyle = "rgba(127,196,255,0.75)";
    ctx.font = `400 20px ${MONO}`;
    ctx.fillText(footer, 28, H - 34);
  }
  return tex(c);
};

export const makeWakeUpTexture = () => {
  const W = 1024;
  const H = 512;
  const { c, ctx } = canvas2d(W, H);
  ctx.fillStyle = "#02070f";
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.62);
  g.addColorStop(0, "rgba(30,110,220,0.4)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(140,200,255,0.4)";
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, W - 20, H - 20);

  ctx.textAlign = "center";
  ctx.font = `700 128px ${MONO}`;
  ctx.shadowColor = "rgba(110,190,255,0.9)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = "#eaf5ff";
  ctx.fillText("WAKE_UP", W / 2, H / 2 + 24);
  ctx.shadowBlur = 0;
  ctx.font = `400 26px ${MONO}`;
  ctx.fillStyle = "rgba(150,205,255,0.75)";
  ctx.fillText("// 脱出コマンド : 実行するにはコンソールで入力せよ", W / 2, H / 2 + 96);
  ctx.font = `400 20px ${MONO}`;
  ctx.fillStyle = "rgba(120,170,220,0.55)";
  ctx.fillText("[C] CONSOLE", W / 2, H - 54);
  return tex(c);
};

export const makeScrollTexture = (lines: string[]) => {
  const W = 512;
  const H = 1024;
  const { c, ctx } = canvas2d(W, H);
  ctx.fillStyle = "rgba(2,10,24,0.0)";
  ctx.fillRect(0, 0, W, H);
  ctx.font = `400 20px ${MONO}`;
  lines.forEach((l, i) => {
    ctx.fillStyle = i % 7 === 0 ? "rgba(150,210,255,0.85)" : "rgba(190,220,245,0.5)";
    ctx.fillText(l, 16, 30 + i * 27);
  });
  return tex(c);
};

export const makeStripeTexture = () => {
  const { c, ctx } = canvas2d(64, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "rgba(120,190,255,0)");
  g.addColorStop(0.35, "rgba(120,190,255,0.5)");
  g.addColorStop(0.5, "rgba(220,240,255,0.9)");
  g.addColorStop(0.65, "rgba(120,190,255,0.5)");
  g.addColorStop(1, "rgba(120,190,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 512);
  return tex(c);
};

export const makePosterTexture = (image?: HTMLImageElement | null) => {
  const W = 512;
  const H = 720;
  const { c, ctx } = canvas2d(W, H);
  ctx.fillStyle = "#0b0f18";
  ctx.fillRect(0, 0, W, H);
  if (image && image.complete && image.naturalWidth) {
    const ar = image.naturalWidth / image.naturalHeight;
    let dw = W;
    let dh = W / ar;
    if (dh > H) {
      dh = H;
      dw = H * ar;
    }
    ctx.drawImage(image, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = "#12203a";
    ctx.fillRect(0, 0, W, H);
  }
  // print noise + border
  ctx.strokeStyle = "rgba(230,240,255,0.15)";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, W - 8, H - 8);
  ctx.fillStyle = "rgba(6,10,18,0.55)";
  ctx.fillRect(0, H - 86, W, 86);
  ctx.fillStyle = "rgba(226,238,255,0.75)";
  ctx.font = `500 26px ${MONO}`;
  ctx.fillText("SLEEP STUDY #4", 24, H - 46);
  ctx.font = `400 16px ${MONO}`;
  ctx.fillStyle = "rgba(160,190,220,0.6)";
  ctx.fillText("02:47 / 見ないで", 24, H - 22);
  return tex(c);
};

export const makeClockFaceTexture = () => {
  const { c, ctx } = canvas2d(256, 128);
  ctx.fillStyle = "#05070c";
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = "rgba(255,80,80,0.85)";
  ctx.font = `700 40px ${MONO}`;
  ctx.fillText("02:47", 20, 62);
  ctx.fillStyle = "rgba(120,150,180,0.5)";
  ctx.font = `400 16px ${MONO}`;
  ctx.fillText("ALARM  OFF", 20, 96);
  ctx.fillStyle = "rgba(0,255,120,0.5)";
  ctx.fillRect(20, 104, 216, 2);
  return tex(c);
};

export const makeNoiseTexture = () => {
  const { c, ctx } = canvas2d(128, 128);
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
};

export const makeSignTexture = (text: string, sub = "") => {
  const { c, ctx } = canvas2d(512, 128);
  ctx.fillStyle = "#02060d";
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = "rgba(120,190,255,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(3, 3, 506, 122);
  ctx.fillStyle = "rgba(230,244,255,0.9)";
  ctx.font = `500 42px ${MONO}`;
  ctx.fillText(text, 24, 62);
  if (sub) {
    ctx.fillStyle = "rgba(130,180,230,0.6)";
    ctx.font = `400 20px ${MONO}`;
    ctx.fillText(sub, 24, 100);
  }
  return tex(c);
};

export const makeCrackTexture = () => {
  const { c, ctx } = canvas2d(512, 512);
  ctx.clearRect(0, 0, 512, 512);
  ctx.strokeStyle = "rgba(240,250,255,0.9)";
  ctx.lineWidth = 2;
  const rnd = (n: number) => hash2(n * 12.9898, n * 78.233);
  for (let i = 0; i < 14; i++) {
    let x = 256 + (rnd(i) - 0.5) * 40;
    let y = 256 + (rnd(i + 40) - 0.5) * 40;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (rnd(i * 9 + s) - 0.5) * 80;
      y += (rnd(i * 7 + s + 3) - 0.5) * 80;
      ctx.lineTo(clamp(x, 0, 512), clamp(y, 0, 512));
    }
    ctx.stroke();
  }
  return tex(c);
};

export const clamp01 = (v: number) => clamp(v, 0, 1);

export const makeStickerTexture = () => {
  const { c, ctx } = canvas2d(256, 384);
  ctx.fillStyle = "#e8e6df";
  ctx.fillRect(0, 0, 256, 384);
  ctx.strokeStyle = "rgba(90,110,140,0.45)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) {
    const y = 48 + i * 30;
    ctx.beginPath();
    ctx.moveTo(22, y);
    ctx.lineTo(22 + 90 + hash2(i, 3) * 120, y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(40,60,90,0.7)";
  ctx.font = `700 26px ${MONO}`;
  ctx.fillText("02:47", 22, 30);
  ctx.font = `400 13px ${MONO}`;
  ctx.fillStyle = "rgba(90,110,150,0.7)";
  ctx.fillText("wake up   wake up   wake up", 22, 356);
  return tex(c);
};

export const makeWindowGlowTexture = () => {
  const { c, ctx } = canvas2d(256, 128);
  const g = ctx.createRadialGradient(150, 40, 4, 140, 64, 130);
  g.addColorStop(0, "rgba(150,200,255,0.5)");
  g.addColorStop(0.45, "rgba(90,150,220,0.16)");
  g.addColorStop(1, "rgba(40,80,140,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  return tex(c);
};

export const makeMatGlyph = (glyph: string) => {
  const { c, ctx } = canvas2d(512, 512);
  ctx.clearRect(0, 0, 512, 512);
  const g = ctx.createRadialGradient(256, 256, 10, 256, 256, 240);
  g.addColorStop(0, "rgba(20,90,190,0.75)");
  g.addColorStop(0.55, "rgba(10,60,150,0.35)");
  g.addColorStop(1, "rgba(0,20,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  ctx.textAlign = "center";
  ctx.font = `700 300px ${MONO}`;
  ctx.fillStyle = "rgba(235,246,255,0.95)";
  ctx.shadowColor = "rgba(120,200,255,0.9)";
  ctx.shadowBlur = 50;
  ctx.fillText(glyph, 256, 350);
  ctx.shadowBlur = 0;
  return tex(c);
};
