import * as THREE from 'three';

export function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, canvas);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function surfaceTexture(kind: 'wall' | 'wood' | 'fabric' | 'tile') {
  const colors = {
    wall: '#666b6d',
    wood: '#5c4434',
    fabric: '#555b67',
    tile: '#102747',
  };
  const texture = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = colors[kind];
    ctx.fillRect(0, 0, 512, 512);
    let seed = 4921;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 12000; i++) {
      const shade = random() > 0.5 ? 255 : 0;
      ctx.fillStyle = `rgba(${shade},${shade},${shade},${random() * 0.08})`;
      const x = random() * 512;
      const y = random() * 512;
      ctx.fillRect(x, y, kind === 'wood' ? random() * 90 : 1.5, 1);
    }
    if (kind === 'wood') {
      for (let y = 0; y < 512; y += 85) {
        ctx.fillStyle = '#1c140e55';
        ctx.fillRect(0, y, 512, 2);
        ctx.fillRect((y * 3.8) % 512, y, 1, 85);
      }
    }
    if (kind === 'fabric') {
      ctx.strokeStyle = '#ffffff0d';
      ctx.lineWidth = 1;
      for (let i = 0; i < 512; i += 4) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 512);
        ctx.moveTo(0, i);
        ctx.lineTo(512, i);
        ctx.stroke();
      }
    }
    if (kind === 'tile') {
      ctx.strokeStyle = '#5382bf40';
      ctx.lineWidth = 2;
      ctx.strokeRect(9, 9, 494, 494);
      ctx.strokeStyle = '#5382bf12';
      for (let i = 32; i < 512; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 512);
        ctx.stroke();
      }
      ctx.fillStyle = '#80b0ff90';
      ctx.font = '10px monospace';
      ctx.fillText('MEMORY ADDRESS / 0x00000F', 24, 484);
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function textTexture(
  lines: string[],
  options: { color?: string; background?: string; size?: number; width?: number; height?: number } = {},
) {
  const { color = '#d6e6ff', background = 'transparent', size = 36, width = 1024, height = 512 } = options;
  return canvasTexture(width, height, (ctx) => {
    if (background !== 'transparent') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.fillStyle = color;
    ctx.font = `${size}px "Courier New", monospace`;
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => ctx.fillText(line, 36, 30 + i * size * 1.6));
  });
}

export function glowTexture() {
  return canvasTexture(128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(180,215,255,0.8)');
    gradient.addColorStop(0.15, 'rgba(120,170,255,0.3)');
    gradient.addColorStop(1, 'rgba(50,100,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  });
}

export class MonitorTexture {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 768;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.draw('bsod', 0, 0);
  }

  draw(mode: 'desktop' | 'bsod' | 'returned', corruption: number, time: number) {
    const ctx = this.ctx;
    ctx.fillStyle = mode === 'returned' ? '#03070f' : '#064de0';
    ctx.fillRect(0, 0, 1280, 768);

    if (mode === 'desktop') {
      const gradient = ctx.createLinearGradient(0, 0, 1280, 768);
      gradient.addColorStop(0, '#041833');
      gradient.addColorStop(0.6, '#164572');
      gradient.addColorStop(1, '#08233e');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1280, 768);
      ctx.fillStyle = '#c3dbed';
      ctx.textAlign = 'center';
      ctx.font = '100 124px Arial';
      ctx.fillText('03:17', 640, 340);
      ctx.font = '20px monospace';
      ctx.fillStyle = '#9eb4c5';
      ctx.fillText('THURSDAY, JUNE 13', 640, 394);
      ctx.fillStyle = '#020d2099';
      ctx.fillRect(0, 710, 1280, 58);
      ctx.fillStyle = '#d4e4f0';
      ctx.font = '18px monospace';
      ctx.fillText('SYSTEM ONLINE', 640, 748);
      ctx.textAlign = 'left';
    } else if (mode === 'returned') {
      ctx.fillStyle = '#bdc9d8';
      ctx.font = '25px monospace';
      ctx.fillText('SESSION RESTORED.', 94, 140);
      ctx.fillStyle = '#7187a2';
      ctx.font = '20px monospace';
      ctx.fillText('Last login: 03:18', 94, 196);
      ctx.fillText('You were never disconnected.', 94, 237);
      ctx.fillStyle = '#477de8';
      ctx.font = '65px Arial';
      ctx.fillText(':(', 1080, 650);
      if (Math.sin(time * 1.4) > 0) {
        ctx.fillStyle = '#abcaff';
        ctx.fillRect(94, 295, 12, 24);
      }
    } else {
      const displacement = corruption * 22;
      const jitter = Math.sin(time * 16) * displacement;
      ctx.fillStyle = '#f1f5ff';
      ctx.font = '170px Arial';
      ctx.fillText(':(', 88 + jitter * 0.3, 228);
      ctx.font = '38px Arial';
      ctx.fillText('Your PC ran into a problem and needs to restart.', 93, 324);
      ctx.fillText("We're just collecting some error info, and then", 93 - jitter, 378);
      ctx.fillText("we'll restart for you.", 93, 432);
      ctx.font = '33px Arial';
      ctx.fillText(`${Math.floor(corruption * 99)}% complete`, 94 + jitter, 513);
      const qrSize = 91;
      ctx.fillStyle = '#f1f5ff';
      ctx.fillRect(96, 578, qrSize, qrSize);
      ctx.fillStyle = '#064de0';
      for (let y = 0; y < 13; y++) {
        for (let x = 0; x < 13; x++) {
          if ((x * 7 + y * 11 + x * y) % 5 < 3) ctx.fillRect(101 + x * 6, 583 + y * 6, 5, 5);
        }
      }
      ctx.fillStyle = '#f1f5ff';
      ctx.font = '19px Arial';
      ctx.fillText('For more information about this issue and possible fixes,', 219, 603);
      ctx.fillText('visit the place you left behind.', 219, 631);
      ctx.font = '17px monospace';
      ctx.fillText('Stop code: REALITY_NOT_FOUND', 219, 665);

      if (corruption > 0.07) {
        ctx.globalAlpha = Math.min(0.7, corruption);
        for (let i = 0; i < 7; i++) {
          const y = (i * 107 + Math.floor(time * 3) * 17) % 760;
          const x = ((i * 273) % 1100) + jitter;
          ctx.fillStyle = i % 2 ? '#071742' : '#89aeff';
          ctx.fillRect(x, y, corruption * (60 + i * 29), 4 + corruption * 14);
        }
        ctx.globalAlpha = 1;
        if (corruption > 0.54) {
          ctx.fillStyle = '#f1f5ff';
          ctx.font = '22px monospace';
          ctx.fillText('I CAN SEE YOU.', 740 + jitter * 2, 170);
        }
      }
    }

    ctx.fillStyle = 'rgba(0, 8, 30, 0.08)';
    for (let y = 0; y < 768; y += 4) ctx.fillRect(0, y, 1280, 1);
    this.texture.needsUpdate = true;
  }
}