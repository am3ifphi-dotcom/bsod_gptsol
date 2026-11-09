/* Real-time BSOD rendered to a CanvasTexture — the heart of the horror. */
import * as THREE from 'three';
import { seededRandom } from './textures';

const W = 1280;
const H = 720;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function mixColor(c0: [number, number, number], c1: [number, number, number], t: number) {
  return `rgb(${Math.round(lerp(c0[0], c1[0], t))},${Math.round(lerp(c0[1], c1[1], t))},${Math.round(lerp(c0[2], c1[2], t))})`;
}

export class BsodScreen {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private noiseTiles: HTMLCanvasElement[] = [];
  private scanline: HTMLCanvasElement;
  private qrTile: HTMLCanvasElement;
  private residualLog: string[] = [
    'C:\\> wake_up',
    'WAKE_UP …… 権限がありません',
    'C:\\> exit',
    'エラー: この世界は終了できません',
    'C:\\> 電源を切ってください',
    '……やめろよ',
    'C:\\> _',
  ];

  /** 0 pristine … 1 fully consumed */
  corruption = 0;
  /** 0..1 extra ascension once the devoured sequence begins */
  overload = 0;
  /** decaying energy injected per click */
  private burst = 0;
  /** is the cursor hovering the ":(" hotspot */
  hover = false;
  private hoverGlow = 0;
  private residualFlicker = 0;
  private time = 0;
  /** after the ending — dark CRT showing a residual log */
  residualMode = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.scanline = this.makeScanlines();
    this.qrTile = this.makeQR();
    for (let i = 0; i < 5; i++) this.noiseTiles.push(this.makeNoiseTile(i));
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  clickPunch() {
    this.burst = Math.min(1.6, this.burst + 0.85);
  }

  /** UV hotspot of the ":(" glyph. u,v in 0..1 (three.js UV space, v up). */
  hotspotContains(u: number, v: number): boolean {
    const x = u * W;
    const y = (1 - v) * H;
    return x > 68 && x < 412 && y > 40 && y < 432;
  }

  /* ------------------------------------------------ drawing */

  private makeScanlines() {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(0,0,0,0)';
    g.fillRect(0, 0, 4, 4);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, 3, 4, 1);
    return c;
  }

  private makeNoiseTile(seed: number) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d')!;
    const img = g.createImageData(256, 256);
    const rnd = seededRandom('noise-' + seed);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rnd() * 255;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  private makeQR() {
    const c = document.createElement('canvas');
    c.width = 138;
    c.height = 138;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 138, 138);
    const rnd = seededRandom('fake-qr');
    const cells = 21;
    const cell = 138 / cells;
    g.fillStyle = '#000000';
    const finder = (cx: number, cy: number) => {
      g.fillRect(cx * cell, cy * cell, 7 * cell, 7 * cell);
      g.fillStyle = '#ffffff';
      g.fillRect((cx + 1) * cell, (cy + 1) * cell, 5 * cell, 5 * cell);
      g.fillStyle = '#000000';
      g.fillRect((cx + 2) * cell, (cy + 2) * cell, 3 * cell, 3 * cell);
    };
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        if (rnd() < 0.42) g.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    finder(0, 0);
    finder(cells - 7, 0);
    finder(0, cells - 7);
    return c;
  }

  private drawBase(ctx: CanvasRenderingContext2D, corruption: number, time: number) {
    // background — the blue rots as corruption rises
    const bg = mixColor([0, 120, 215], [4, 22, 44], clamp01(corruption * 1.15));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const rg = ctx.createRadialGradient(W * 0.32, H * 0.38, 60, W * 0.5, H * 0.5, W * 0.78);
    rg.addColorStop(0, 'rgba(255,255,255,0.10)');
    rg.addColorStop(0.55, 'rgba(0,0,0,0.0)');
    rg.addColorStop(1, `rgba(0,4,12,${0.42 + corruption * 0.4})`);
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 2;

    // ---- the glyph
    const face = Math.max(corruption - 0.42, 0) / 0.58; // 0..1 face emergence
    const glyphScale = 1 + corruption * corruption * 0.55 + this.burst * 0.06;
    const jx = (Math.sin(time * 13.7) + Math.sin(time * 7.3 + 1.7)) * face * 9;
    const jy = (Math.cos(time * 11.3) + Math.sin(time * 5.1 + 0.6)) * face * 7;
    const gx = 108 + jx;
    const gy = 342 + jy;
    ctx.save();
    ctx.translate(gx + 130, gy - 120);
    ctx.scale(glyphScale, glyphScale);
    const breathe = 1 + Math.sin(time * (1.1 + corruption * 2.6)) * 0.014 * (1 + corruption * 3);
    ctx.scale(breathe, 1 / breathe);
    ctx.font = '300 288px "Segoe UI Light", "Yu Gothic UI Light", "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 1 - face * 0.25;
    ctx.fillText(':(', -130, 118);
    ctx.globalAlpha = 1;
    ctx.restore();

    // ---- the face behind the glyph
    if (face > 0) {
      const cx = 258 + jx * 0.6;
      const cy = 218 + jy * 0.6;
      // eye gleams
      ctx.save();
      ctx.globalAlpha = clamp01(face * 1.35);
      const eyeGlow = ctx.createRadialGradient(cx - 78, cy - 26, 2, cx - 78, cy - 26, 30);
      eyeGlow.addColorStop(0, 'rgba(190,250,255,0.95)');
      eyeGlow.addColorStop(0.35, 'rgba(90,220,255,0.55)');
      eyeGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = eyeGlow;
      ctx.beginPath(); ctx.arc(cx - 78, cy - 26, 30, 0, Math.PI * 2); ctx.fill();
      const eyeGlow2 = ctx.createRadialGradient(cx + 96, cy - 30, 2, cx + 96, cy - 30, 26);
      eyeGlow2.addColorStop(0, 'rgba(190,250,255,0.9)');
      eyeGlow2.addColorStop(0.4, 'rgba(70,200,255,0.5)');
      eyeGlow2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = eyeGlow2;
      ctx.beginPath(); ctx.arc(cx + 96, cy - 30, 26, 0, Math.PI * 2); ctx.fill();
      // mouth — the entrance
      const open = clamp01(face * 1.15) * (0.82 + this.burst * 0.3 + Math.sin(time * 3.1) * 0.07);
      const mw = 165 + open * 155;
      const mh = 12 + open * 132;
      const mg = ctx.createRadialGradient(cx + 6, cy + 118, 6, cx + 6, cy + 118, Math.max(mw, mh) * 1.25);
      mg.addColorStop(0, '#000208');
      mg.addColorStop(0.55, '#010a18');
      mg.addColorStop(0.8, 'rgba(30,120,190,0.85)');
      mg.addColorStop(1, 'rgba(60,200,255,0)');
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.ellipse(cx + 6, cy + 118, mw, mh, 0, 0, Math.PI * 2); ctx.fill();
      // teeth hint — broken UI fragments hanging in the maw
      ctx.globalAlpha = clamp01(face * 1.2);
      ctx.fillStyle = '#dff6ff';
      const toothN = 5;
      for (let i = 0; i < toothN; i++) {
        const tx = cx - mw * 0.62 + (i / (toothN - 1)) * mw * 1.24;
        const tlen = 9 + ((i * 37) % 23) * (0.4 + open);
        const tw = 7 + ((i * 53) % 9);
        ctx.fillRect(tx - tw / 2, cy + 118 - mh * 0.92, tw, tlen);
        ctx.fillRect(tx - tw / 2, cy + 118 + mh * 0.92 - tlen * 0.7, tw, tlen * 0.7);
      }
      ctx.restore();
    }

    // hover affordance — the glyph throbs faintly when hovered
    this.hoverGlow += ((this.hover ? 1 : 0) - this.hoverGlow) * 0.12;
    if (this.hoverGlow > 0.02) {
      ctx.save();
      ctx.globalAlpha = this.hoverGlow * (0.16 + Math.sin(time * 5.2) * 0.07);
      const hg = ctx.createRadialGradient(258, 218, 10, 258, 218, 210);
      hg.addColorStop(0, 'rgba(255,255,255,0.9)');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(30, 0, 460, 460);
      ctx.restore();
    }

    // ---- body text
    const pct = Math.min(100, Math.floor(corruption * 104 + this.burst * 3));
    const bodyColor = mixColor([255, 255, 255], [150, 205, 235], corruption * 0.8);
    ctx.fillStyle = bodyColor;
    ctx.font = '400 27px "Segoe UI", "Yu Gothic UI", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif';
    const lineJitter = corruption > 0.45 ? corruption * 3.4 : 0;
    const ly = (base: number, seed: number) => base + (Math.sin(time * 9 + seed * 13.7) * lineJitter);
    ctx.fillText('PCに問題が発生したため、', 470, ly(150, 1));
    ctx.fillText('再起動する必要があります。', 470, ly(196, 2));
    ctx.fillText(`エラー情報を収集しています (${pct}% 完了)`, 470, ly(268, 3));
    ctx.fillText('完了後、このPCは自動的に再起動しません。', 470, ly(340, 4));
    ctx.font = '400 21px "Segoe UI", "Yu Gothic UI", sans-serif';
    ctx.globalAlpha = 0.92;
    ctx.fillText('停止コード: CRITICAL_PROCESS_DIED', 470, ly(428, 5));
    ctx.globalAlpha = 1;

    // QR + caption
    ctx.drawImage(this.qrTile, 470, 470, 138, 138);
    ctx.font = '400 15px "Segoe UI", "Yu Gothic UI", sans-serif';
    ctx.globalAlpha = 0.9;
    ctx.fillText('詳しくは、QRコードを読み取るか', 622, 506);
    ctx.fillText('https://www.windows.com/stopcode', 622, 530);
    ctx.fillText('を停止コードとともに参照してください', 622, 554);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  private drawResidual(ctx: CanvasRenderingContext2D, time: number) {
    ctx.fillStyle = '#050b12';
    ctx.fillRect(0, 0, W, H);
    // faint green-blue phosphor glow center
    const g = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.62);
    g.addColorStop(0, 'rgba(28,64,84,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // occasional flicker
    this.residualFlicker = Math.max(0, this.residualFlicker - 0.016);
    if (Math.random() < 0.006) this.residualFlicker = 0.8;
    const flick = this.residualFlicker;
    ctx.font = '500 21px "IBM Plex Mono", "Courier New", monospace';
    ctx.fillStyle = `rgba(150,230,255,${0.4 + flick * 0.6})`;
    const shown = this.residualLog.length;
    for (let i = 0; i < shown; i++) {
      const jitter = Math.random() < 0.05 + flick * 0.3 ? (Math.random() - 0.5) * 26 : 0;
      ctx.fillText(this.residualLog[i], 90 + jitter, 150 + i * 46);
    }
    // cursor
    if (Math.floor(time * 2) % 2 === 0) {
      ctx.fillRect(90, 150 + (shown - 1) * 46 + 12, 14, 22);
    }
  }

  private drawTears(ctx: CanvasRenderingContext2D, corruption: number, burst: number, time: number) {
    const amount = corruption * 0.75 + burst * 0.6;
    if (amount <= 0.06) return;
    const tears = Math.floor(amount * 15);
    for (let i = 0; i < tears; i++) {
      const sy = Math.random() * H;
      const sh = 2 + Math.random() * (6 + corruption * 34);
      const dx = (Math.random() - 0.5) * (46 + corruption * 300 + burst * 160);
      ctx.drawImage(this.canvas, 0, sy, W, sh, dx, sy, W, sh);
    }
    // horizontal signal-loss bands
    if (corruption > 0.3 || burst > 0.4) {
      const bands = Math.floor((corruption + burst) * 4);
      for (let i = 0; i < bands; i++) {
        if (Math.random() < 0.5) continue;
        const by = Math.random() * H;
        ctx.fillStyle = Math.random() < 0.5 ? 'rgba(125,240,255,0.32)' : 'rgba(2,8,20,0.5)';
        ctx.fillRect(0, by, W, 1.5 + Math.random() * 5);
      }
    }
    // noise speckle
    const n = Math.floor(amount * 5);
    for (let i = 0; i < n; i++) {
      const tile = this.noiseTiles[Math.floor(Math.random() * this.noiseTiles.length)];
      ctx.globalAlpha = 0.09 + Math.random() * 0.22 * amount;
      const s = 60 + Math.random() * 240;
      ctx.drawImage(tile, Math.random() * (W - s), Math.random() * (H - s), s, s);
      ctx.globalAlpha = 1;
    }
    // chromatic ghost of the glyph at high corruption
    if (corruption > 0.55) {
      ctx.save();
      ctx.globalAlpha = (corruption - 0.55) * 0.9;
      ctx.globalCompositeOperation = 'screen';
      ctx.translate(Math.sin(time * 17) * 12 * corruption, 0);
      ctx.font = '300 288px "Segoe UI Light", Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,40,80,0.5)';
      ctx.fillText(':(', 96, 460);
      ctx.fillStyle = 'rgba(40,220,255,0.5)';
      ctx.fillText(':(', 118, 460);
      ctx.restore();
    }
  }

  private drawScanlines(ctx: CanvasRenderingContext2D, alpha: number) {
    const pattern = ctx.createPattern(this.scanline, 'repeat')!;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /** Final iris ascension used by the devoured cinematic. */
  private drawOverload(ctx: CanvasRenderingContext2D, overload: number, time: number) {
    if (overload <= 0) return;
    const open = clamp01(overload);
    const cx = W / 2 + Math.sin(time * 1.7) * 26 * (1 - open);
    const cy = H / 2 + Math.cos(time * 1.3) * 18 * (1 - open);
    // tunnel of jaws
    for (let ring = 6; ring >= 1; ring--) {
      const t = ring / 6;
      const rr = (1 - open) * 60 + t * 560 * (0.35 + open * 0.85);
      ctx.globalAlpha = 0.16 + t * 0.12;
      ctx.strokeStyle = ring % 2 ? '#0a2c4a' : '#3fd4ff';
      ctx.lineWidth = 8 + t * 26;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rr * 1.34, rr, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 90 + open * 500);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.55, '#000208');
    g.addColorStop(0.8, 'rgba(10,60,110,0.9)');
    g.addColorStop(1, 'rgba(80,225,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // maw teeth silhouette closing in
    ctx.fillStyle = '#010409';
    const teeth = 9;
    for (let i = 0; i < teeth; i++) {
      const a = (i / (teeth - 1)) * Math.PI * 2;
      const len = 60 + ((i * 91) % 97) * (0.4 + open);
      const tx = cx + Math.cos(a) * (W * 0.72);
      const ty = cy + Math.sin(a) * (H * 0.72);
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(a + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(-34, 0);
      ctx.lineTo(0, len);
      ctx.lineTo(34, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  update(time: number, reducedFlash: boolean) {
    this.time = time;
    this.burst = Math.max(0, this.burst - 0.028);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    if (this.residualMode) {
      this.drawResidual(ctx, time);
      this.drawScanlines(ctx, 0.35);
      // rolling bar
      const barY = ((time * 90) % (H + 300)) - 150;
      const grad = ctx.createLinearGradient(0, barY, 0, barY + 130);
      grad.addColorStop(0, 'rgba(140,220,255,0)');
      grad.addColorStop(0.5, 'rgba(140,220,255,0.10)');
      grad.addColorStop(1, 'rgba(140,220,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, barY, W, 130);
      this.texture.needsUpdate = true;
      return;
    }

    const c = reducedFlash ? this.corruption * 0.72 : this.corruption;
    this.drawBase(ctx, c, time);
    this.drawTears(ctx, c, this.burst, time);
    this.drawOverload(ctx, this.overload, time);
    this.drawScanlines(ctx, 0.16 + c * 0.22);

    // vignette pulse while corrupted
    if (c > 0.15) {
      const pulse = 0.24 + Math.sin(time * (1.4 + c * 3)) * 0.08 * c;
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, W * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(1,2,8,${pulse + c * 0.34})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
    this.texture.needsUpdate = true;
  }
}
