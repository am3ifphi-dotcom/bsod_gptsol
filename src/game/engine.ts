/* NOT RESPONDING — engine: input, camera rig, scene flow, cinematics, console. */
import * as THREE from 'three';
import { buildRoom, applyAftermath, type RoomBuild } from './room';
import { buildWorld, terrainHeightAt, type WorldBuild } from './world';
import { BsodScreen } from './bsod';
import { AudioEngine } from './audio';
import type { Phase, Settings, EngineEvents, ConsoleLine } from './types';

const EYE_HEIGHT = 1.56;
const WORLD_EYE = 1.56;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const easeInCubic = (t: number) => t * t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInQuart = (t: number) => t * t * t * t;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface CineState {
  kind: 'devoured' | 'collapse';
  t: number;
  dur: number;
}

export class Engine {
  readonly audio = new AudioEngine();
  private canvas: HTMLCanvasElement;
  private events: EngineEvents;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private settings: Settings;

  private room: RoomBuild | null = null;
  private world: WorldBuild | null = null;
  private tunnel: THREE.Scene | null = null;
  private tunnelTexture: THREE.CanvasTexture | null = null;
  private tunnelRings: THREE.Mesh[] = [];
  private tunnelPoints: THREE.Points | null = null;
  private tunnelLightA: THREE.PointLight | null = null;
  private tunnelLightB: THREE.PointLight | null = null;

  private roomScene: THREE.Scene | null = null;
  private worldScene: THREE.Scene | null = null;
  private currentScene: THREE.Scene | null = null;
  private bsod = new BsodScreen();

  private raf = 0;
  private lastTime = 0;
  private time = 0;
  private disposed = false;

  phase: Phase = 'boot';
  /** hard input freeze (pause menu) */
  paused = false;
  setPaused(v: boolean) {
    this.paused = v;
    if (v) {
      this.keys.clear();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    }
  }

  /* input state */
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private bobPhase = 0;
  private footstepTimer = 0;
  private mouseNdc = new THREE.Vector2(-10, -10);
  private dragging = false;
  private lastMouse = { x: 0, y: 0 };

  /* examine / bsod state */
  private corruption = 0;
  private examineBlend = 0;
  private exitBlend = 0;
  private examineFrom: 'room' | 'returned' = 'room';
  private walkPosAtExamine = new THREE.Vector3();
  private walkFovAtExamine = 71;
  private lastExaminePos = new THREE.Vector3();
  private lastExamineQuat = new THREE.Quaternion();
  private lastExamineFov = 66;
  private worldFallVel = 0;
  private flashHold = 0;
  private walkMoveAmount = 0;

  /* cinematics */
  private cine: CineState | null = null;
  private fallVel = 0;
  private fallActive = false;
  private baseFov = 71;
  private wakeRevealT = -1; // >=0 animates WAKE_UP sign in
  private wakeDiscovered = false;
  private roomDread = 0; // 0..1 how cursed the room currently feels
  private shakeAmp = 0;
  private shakeT = 0;
  private flash = 0;
  private flashTarget = 0;
  private collapseFocusFrom = { yaw: 0, pitch: 0 };
  private titleOrbit = 0;

  /* DOM overlays created by the engine (frame-rate independent) */
  private flashEl: HTMLDivElement;
  private letterTop: HTMLDivElement;
  private letterBottom: HTMLDivElement;
  private vignetteEl: HTMLDivElement;

  private raycaster = new THREE.Raycaster();

  constructor(canvas: HTMLCanvasElement, events: EngineEvents, settings: Settings) {
    this.canvas = canvas;
    this.events = events;
    this.settings = { ...settings };
    this.audio.setVolume(settings.volume / 100);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.quality === 'high' ? 1.75 : 1.0));
    this.renderer.shadowMap.enabled = settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(71, 1, 0.05, 320);
    this.camera.rotation.order = 'YXZ';

    /* DOM overlays */
    const parent = canvas.parentElement!;
    this.flashEl = this.makeOverlay(parent, '#eaf6ff', 0);
    this.vignetteEl = document.createElement('div');
    this.vignetteEl.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:4;background:radial-gradient(ellipse at center,transparent 52%,rgba(2,4,10,0.42) 100%);';
    parent.appendChild(this.vignetteEl);
    this.letterTop = this.makeLetterbox(parent, 'top');
    this.letterBottom = this.makeLetterbox(parent, 'bottom');

    this.attachListeners();
    this.resize();
    void this.init();
  }

  /* ================= overlays & helpers ================= */

  private makeOverlay(parent: HTMLElement, color: string, opacity: number) {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:5;background:${color};opacity:${opacity};`;
    parent.appendChild(el);
    return el;
  }

  private makeLetterbox(parent: HTMLElement, side: 'top' | 'bottom') {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;left:0;right:0;height:0;background:#000;z-index:6;pointer-events:none;${side}:0;transition:height 0.55s cubic-bezier(.6,0,.2,1);`;
    parent.appendChild(el);
    return el;
  }

  setLetterbox(on: boolean) {
    this.letterTop.style.height = on ? '6.5vh' : '0';
    this.letterBottom.style.height = on ? '6.5vh' : '0';
  }

  private setFlash(v: number) {
    this.flash = v;
    this.flashEl.style.opacity = String(v);
  }

  /* ================= listeners ================= */

  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return; // console owns the keyboard
    const key = e.key.toLowerCase();

    if (key === 'escape') {
      e.preventDefault();
      if (this.phase === 'examine') { this.endExamine(); return; }
      if (this.consoleWasOpen()) { this.closeConsole(); return; }
      if (this.cine) return;
      this.events.onPauseRequest();
      return;
    }
    if (this.consoleWasOpen()) {
      if (key === 'c') this.closeConsole();
      return;
    }

    if (key === 'e') {
      if (this.phase === 'room' && this.nearPC()) { this.startExamine(); return; }
      if (this.phase === 'examine') { this.endExamine(); return; }
      if (this.phase === 'returned' && this.nearPC()) { this.startExamine(); return; }
    }
    if (key === 'c') {
      if (this.phase === 'world' && !this.cine) this.toggleConsole();
      return;
    }
    if (key === 'm') {
      this.audio.setMuted(!this.audioMutedCache);
      this.audioMutedCache = !this.audioMutedCache;
      this.events.onToast(this.audioMutedCache ? 'ミュート ON' : 'ミュート OFF', 1600);
      return;
    }
    if (key === 'r' && this.phase === 'returned') {
      this.events.onRequestRestart();
      return;
    }
    this.keys.add(key);
  };
  private audioMutedCache = false;
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };
  private onBlur = () => this.keys.clear();

  private onMouseMove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
    if (document.pointerLockElement === this.canvas) {
      if (this.lookLocked()) {
        this.yaw -= e.movementX * 0.00215 * this.settingsLookSensitivity();
        this.pitch -= e.movementY * 0.00215 * this.settingsLookSensitivity();
        this.pitch = THREE.MathUtils.clamp(this.pitch, -1.35, 1.35);
      }
    } else if (this.dragging && this.lookLocked()) {
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.yaw -= dx * 0.0042;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0042, -1.35, 1.35);
      this.lastMouse = { x: e.clientX, y: e.clientY };
    }
  };
  private settingsLookSensitivity() {
    return 1;
  }
  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    this.lastMouse = { x: e.clientX, y: e.clientY };
    this.dragging = true;
    if (this.consoleWasOpen()) return;
    if (this.phase === 'examine') { this.handleExamineClick(); return; }
    if (this.walkPhase() && !this.cine) {
      if (document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock?.();
      }
    }
  };
  private onMouseUp = () => { this.dragging = false; };
  private onContextMenu = (e: MouseEvent) => { e.preventDefault(); };

  private onPointerLockChange = () => {
    if (
      document.pointerLockElement !== this.canvas &&
      this.walkPhase() &&
      !this.cine &&
      !this.consoleWasOpen()
    ) {
      this.events.onPauseRequest();
    }
  };
  private onVisibility = () => {
    if (document.hidden && this.walkPhase() && !this.cine) this.events.onPauseRequest();
  };
  private onResize = () => this.resize();

  private attachListeners() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('resize', this.onResize);
  }

  private detachListeners() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
  }

  private resize() {
    const parent = this.canvas.parentElement!;
    const w = Math.max(2, parent.clientWidth);
    const h = Math.max(2, parent.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ================= build ================= */

  private async init() {
    try {
      const [room, world] = await Promise.all([buildRoom(), buildWorld()]);
      this.room = room;
      this.world = world;
      this.roomScene = new THREE.Scene();
      this.roomScene.background = new THREE.Color(0x070a12);
      this.roomScene.fog = new THREE.Fog(0x070a12, 9.5, 21);
      this.roomScene.add(room.group);
      this.room.screenPlane.material = new THREE.MeshBasicMaterial({ map: this.bsod.texture, toneMapped: false, fog: false });

      this.worldScene = new THREE.Scene();
      this.worldScene.background = new THREE.Color(0x030d22);
      this.worldScene.fog = new THREE.FogExp2(0x04122b, 0.0235);
      this.worldScene.add(world.group);

      this.buildTunnel();

      // title attract camera
      this.currentScene = this.roomScene;
      this.setPhase('title');
      this.lastTime = performance.now();
      this.loop();
    } catch (err) {
      console.error('[engine] failed to build scenes', err);
      this.events.onToast('モデルの読み込みに失敗しました。再読み込みしてください。', 8000);
    }
  }

  private buildTunnel() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x010812);
    scene.fog = new THREE.Fog(0x010812, 4, 90);
    // streak texture
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = '#010814';
    g.fillRect(0, 0, 512, 512);
    const rnd = () => Math.random();
    for (let i = 0; i < 210; i++) {
      const y = rnd() * 512;
      const len = 30 + rnd() * 190;
      const hue = rnd();
      g.fillStyle = hue < 0.7 ? `rgba(90,225,255,${0.25 + rnd() * 0.6})` : hue < 0.85 ? 'rgba(255,255,255,0.8)' : 'rgba(255,150,60,0.75)';
      g.fillRect(rnd() * 512, y, len, 1.5 + rnd() * 3.2);
    }
    for (let i = 0; i < 130; i++) {
      g.fillStyle = `rgba(120,235,255,${0.14 + rnd() * 0.5})`;
      g.font = `${9 + rnd() * 15}px monospace`;
      g.fillText(['0xF4', 'NULL', 'WAKE', ':(', 'EOF', '0x0000', 'ERR', '再起動', 'FATAL'][Math.floor(rnd() * 9)], rnd() * 512, rnd() * 512);
    }
    this.tunnelTexture = new THREE.CanvasTexture(c);
    this.tunnelTexture.wrapS = this.tunnelTexture.wrapT = THREE.RepeatWrapping;
    this.tunnelTexture.repeat.set(4, 10);
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(3.1, 3.1, 150, 24, 1, true),
      new THREE.MeshBasicMaterial({ map: this.tunnelTexture, side: THREE.BackSide, color: 0x9fe8ff, blending: THREE.AdditiveBlending, fog: false })
    );
    tube.rotation.x = Math.PI / 2;
    tube.position.z = -44;
    scene.add(tube);
    // rings rushing at the camera
    for (let i = 0; i < 9; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.45 + (i % 3) * 0.32, 0.055 + (i % 4) * 0.028, 8, 40),
        new THREE.MeshBasicMaterial({ color: i % 3 === 2 ? 0xffab5e : 0x59e6ff, toneMapped: false, fog: false })
      );
      ring.position.z = 8 - i * 17;
      scene.add(ring);
      this.tunnelRings.push(ring);
    }
    // particle motes
    const N = 380;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2.7;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.sin(a) * r;
      pos[i * 3 + 2] = 12 - Math.random() * 145;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.tunnelPoints = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xcff6ff, size: 0.075, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(this.tunnelPoints);
    this.tunnelLightA = new THREE.PointLight(0x35d5ff, 12, 24, 1.4);
    this.tunnelLightA.position.set(0, 0, 4);
    scene.add(this.tunnelLightA);
    this.tunnelLightB = new THREE.PointLight(0xff7ad9, 7, 20, 1.4);
    this.tunnelLightB.position.set(0, 0, -18);
    scene.add(this.tunnelLightB);
    this.tunnel = scene;
  }

  /* ================= phase helpers ================= */

  private setPhase(p: Phase) {
    this.phase = p;
    this.events.onPhase(p);
  }
  private walkPhase() {
    return this.phase === 'room' || this.phase === 'world' || this.phase === 'returned';
  }
  private lookLocked() {
    return (this.walkPhase() && !this.consoleWasOpen()) || this.phase === 'examine';
  }
  private nearPC() {
    if (!this.room) return false;
    const p = this.camera.position;
    const dxz = Math.hypot(p.x - this.room.screenCenter.x, p.z - this.room.screenCenter.z);
    return dxz < 1.45;
  }
  private consoleWasOpen() {
    return this.consoleOpen;
  }
  consoleOpen = false;

  /* ================= public API ================= */

  startGame() {
    this.audio.init();
    this.audio.startRoomTone();
    this.setPhase('room');
    this.events.onObjective('自室。――机の上のPCを調べよう');
    const room = this.room!;
    this.camera.position.copy(room.spawn.pos).setY(EYE_HEIGHT);
    this.yaw = room.spawn.yaw;
    this.pitch = 0;
    this.baseFov = 71;
    this.camera.fov = 71;
    this.camera.updateProjectionMatrix();
  }

  returnToTitle() {
    // caller is expected to remount the engine; here we just stop input & audio
    this.audio.stopRoomTone();
    this.audio.stopWorldDrone();
    this.audio.stopFallWind();
  }

  setSettings(s: Settings) {
    this.settings = { ...s };
    this.audio.setVolume(s.volume / 100);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.quality === 'high' ? 1.75 : 1.1));
    if (this.room) {
      this.room.moonLight.castShadow = s.quality === 'high';
    }
  }

  openConsole() {
    if (this.phase !== 'world' || this.cine) return;
    this.consoleOpen = true;
    document.exitPointerLock?.();
    this.keys.clear();
    this.events.onConsoleOpen(true);
  }
  closeConsole() {
    if (!this.consoleOpen) return;
    this.consoleOpen = false;
    this.events.onConsoleOpen(false);
    if (this.phase === 'world' && !this.cine) {
      this.canvas.requestPointerLock?.();
    }
  }
  toggleConsole() {
    if (this.consoleOpen) this.closeConsole();
    else this.openConsole();
  }

  executeConsole(raw: string): ConsoleLine[] {
    const cmd = raw.trim();
    const lower = cmd.toLowerCase();
    const out: ConsoleLine[] = [];
    const push = (text: string, kind: ConsoleLine['kind'] = 'out') => out.push({ text, kind });

    if (!cmd) return out;
    if (lower === 'help') {
      push('利用可能なコマンド:', 'sys');
      push('  HELP ............ この一覧を表示', 'out');
      push('  STATUS .......... システム状態を表示', 'out');
      push('  DIR ............. 残存ファイルを一覧', 'out');
      push('  WHOAMI .......... 現在のユーザーを表示', 'out');
      push('  CLEAR ........... 画面を消去', 'out');
      push('  EXIT ............ コンソールを閉じる', 'out');
      if (this.wakeDiscovered) push('  WAKE_UP ......... 復帰コマンド', 'ok');
      else push('  ???? ............ ―― 地の底で、何かが名前を呼んでいる', 'dim');
      this.audio.consoleBeep(true);
      return out;
    }
    if (lower === 'status') {
      push('SYSTEM ......... KERNEL PANIC (0x000000F4)', 'err');
      push('メモリ ......... 破損 / 62% 読み取り不能', 'out');
      push('復帰プロセス ... 保留中 (ユーザーの介入待ち)', 'out');
      push('接続 ........... 切断されています (物理層なし)', 'dim');
      this.audio.consoleBeep(true);
      return out;
    }
    if (lower === 'dir') {
      push('ドライブ C: のディレクトリ', 'sys');
      push('  <DIR>  CRITICAL_PROCESS_DIED.dmp', 'out');
      push('  <DIR>  dump.bak', 'out');
      push('  4 KB   kernel_panic.log', 'out');
      push(this.wakeDiscovered ? '  1 KB   wake_up.cfg   ← 読み取り可能' : '  1 KB   wake_up.cfg   ← 暗号化', this.wakeDiscovered ? 'ok' : 'dim');
      this.audio.consoleBeep(true);
      return out;
    }
    if (lower === 'whoami') {
      push('USER …… あなたは、誰ですか？', 'dim');
      push('whoami: 識別子 "USER" は、この世界では無効です', 'err');
      this.audio.consoleBeep(false);
      return out;
    }
    if (lower === 'clear' || lower === 'cls') {
      return [{ text: '__CLEAR__', kind: 'sys' }];
    }
    if (lower === 'exit' || lower === 'quit' || lower === 'close') {
      this.closeConsole();
      return out;
    }
    if (lower === 'wake_up') {
      if (!this.wakeDiscovered) {
        push('WAKE_UP: 不明なコマンドです', 'err');
        push('…あるいは、あなたはまだ、それを見つけていない', 'dim');
        this.audio.consoleBeep(false);
        return out;
      }
      push('WAKE_UP …… 復帰シーケンスを初期化', 'ok');
      push('署名を検証中………………………… OK', 'ok');
      push('浅瀬を切断します。深度を保て。', 'sys');
      push('', 'out');
      push('** 世界を閉じます **', 'err');
      this.audio.wakeConfirmed();
      // collapse begins shortly after the text lands
      window.setTimeout(() => {
        this.closeConsole();
        this.startCollapse();
      }, 1500);
      return out;
    }
    // in-world denial, flavored
    const seed = Math.floor(Math.random() * 1e6);
    const hex = (n: number) => n.toString(16).toUpperCase().padStart(6, '0');
    const denials = [
      `エラー: "${cmd}" はこの世界では意味を持ちません`,
      `0x${hex(0x400000 + (seed % 0xbfffff))}: 参照先が見つかりません`,
      `"${cmd}" ……失敗。世界が応答を拒否しました (0x${hex(seed)})`,
      `入力は受理されましたが、何も起こりませんでした。${Math.floor(seed % 90) + 10}% の確率で、それは正しいことです`,
    ];
    push(denials[seed % denials.length], 'err');
    this.audio.consoleBeep(false);
    return out;
  }

  requestPause() {
    this.events.onPauseRequest();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.detachListeners();
    this.audio.stopRoomTone();
    this.audio.stopWorldDrone();
    this.audio.stopFallWind();
    this.audio.setMuffle(false);
    this.renderer.dispose();
    // remove engine-created overlays
    for (const el of [this.flashEl, this.vignetteEl, this.letterTop, this.letterBottom]) {
      el.parentElement?.removeChild(el);
    }
  }

  /* ================= examine flow ================= */

  private startExamine() {
    if (!this.room) return;
    this.walkPosAtExamine.copy(this.camera.position);
    this.walkFovAtExamine = this.camera.fov;
    this.examineBlend = 0;
    this.examineFrom = this.phase === 'returned' ? 'returned' : 'room';
    document.exitPointerLock?.();
    this.keys.clear();
    this.setPhase('examine');
    this.events.onPrompt(null);
    this.events.onObjective(this.bsod.residualMode ? '残像。……それだけだ。' : '「:(」に触れる');
    this.audio.uiClick();
  }

  private endExamine() {
    const phase = this.examineFrom;
    this.exitBlend = 1; // smooth blend back in updateWalk
    this.setPhase(phase);
    this.events.onObjective(null);
    this.audio.uiClick();
    this.canvas.requestPointerLock?.();
  }

  private handleExamineClick() {
    if (this.cine) return;
    // raycast into the BSOD plane
    this.raycaster.setFromCamera(this.mouseNdc, this.camera);
    const hits = this.raycaster.intersectObject(this.room!.screenPlane, false);
    if (hits.length === 0) return;
    const uv = hits[0].uv;
    if (!uv) return;
    if (this.bsod.residualMode) {
      // touching the dead screen does nothing… almost
      this.bsod.clickPunch();
      this.audio.bsodInfect(0.12);
      return;
    }
    if (uv && this.bsod.hotspotContains(uv.x, uv.y)) {
      this.corruption = Math.min(8, this.corruption + 1);
      const c = this.corruption / 8;
      this.bsod.corruption = c;
      this.bsod.clickPunch();
      this.audio.bsodInfect(c);
      this.events.onCorruption(this.corruption);
      this.shakeAmp = Math.max(this.shakeAmp, 0.02 + c * 0.05);
      this.shakeT = 0;
      // stage reactions
      if (this.corruption === 2) this.events.onToast('……画面が、軋む音がした', 3200);
      if (this.corruption === 4) { this.events.onToast('テキストが、剥がれ落ちていく', 3200); this.audio.whisper(); }
      if (this.corruption === 6) { this.audio.whisper(); this.events.onToast('部屋の影が、画面の青に沈んでいく', 3200); }
      if (this.corruption === 7) this.events.onToast('ひ  き  ず  り  こ  ま  れ  る', 2400);
      // the room itself curdles
      this.roomDread = Math.min(1, this.corruption / 8);
      this.applyDread();
      if (this.corruption >= 8) this.startDevoured();
    } else {
      // clicked elsewhere on the screen — a soft, wrong thud
      this.audio.uiDeny();
      this.bsod.clickPunch();
      this.shakeAmp = Math.max(this.shakeAmp, 0.012);
      this.shakeT = 0;
    }
  }

  private applyDread() {
    const room = this.room!;
    const d = this.roomDread;
    room.roomFill.intensity = lerp(0.95, 0.28, d);
    room.ceilingLight.intensity = lerp(14, 0.35, d);
    room.moonLight.intensity = lerp(1.15, 0.32, d);
    room.pcGlow.intensity = lerp(7.5, 12, d);
    room.lampLight.intensity = lerp(8.5, 0.4, d * d);
    room.crackDecals.forEach((decal) => {
      (decal.material as THREE.MeshBasicMaterial).opacity = d * 0.5;
    });
  }

  /* ================= devoured cinematic ================= */

  private startDevoured() {
    if (this.cine) return;
    this.cine = { kind: 'devoured', t: 0, dur: 11.2 };
    this.flashHold = 0;
    this.setPhase('devoured');
    this.setLetterbox(true);
    this.events.onPrompt(null);
    this.events.onObjective(null);
    document.exitPointerLock?.();
    this.audio.devouredRiser(6.1);
  }

  private updateDevoured(dt: number) {
    const cine = this.cine!;
    cine.t += dt;
    const t = cine.t;
    const room = this.room!;
    this.shakeT += dt;

    if (t < 6.1) {
      // camera is dragged toward the screen
      const p = clamp01(t / 6.1);
      const e = easeInQuart(p);
      const target = room.screenCenter.clone().addScaledVector(room.screenNormal, 0.012);
      const pos = this.walkPosAtExamine.clone().lerp(target, e);
      // resistance — the head tries to pull back
      const resist = Math.sin(t * 5.6) * 0.028 * (1 - p) + Math.sin(t * 9.7 + 1.3) * 0.011 * (1 - p * 0.6);
      pos.x += -room.screenNormal.z * resist;
      pos.z += room.screenNormal.x * resist;
      pos.y += Math.sin(t * 7.3) * 0.014 * (1 - p * 0.5);
      this.camera.position.copy(pos);
      // look locked onto the glyph, drifting closer
      this.camera.lookAt(room.screenCenter.x, room.screenCenter.y, room.screenCenter.z);
      this.camera.rotation.z += Math.sin(t * 3.4) * 0.02 * (1 + p * 3) + Math.sin(t * 11) * 0.006 * p;
      this.camera.fov = lerp(66, 74, p);
      this.camera.updateProjectionMatrix();
      // the face ascends
      this.bsod.overload = clamp01((t - 0.4) / 5.6);
      this.bsod.corruption = 1;
      this.roomDread = 1 - p * 0.35;
      this.applyDread();
      // room groans visually: fog closes in
      if (this.roomScene?.fog instanceof THREE.Fog) {
        this.roomScene.fog.near = lerp(6.5, 1.1, p);
        this.roomScene.fog.far = lerp(15.5, 4.2, p);
      }
      this.bsod.update(this.time, this.settings.reducedFlash);
      if (t >= 6.08 && this.flashTarget === 0) {
        this.flashTarget = 1;
        this.audio.devouredCut();
      }
    } else if (t < 6.32) {
      this.setFlash(Math.min(1, this.flash + dt * 9));
      // hold white; swap underneath
      if (this.currentScene !== this.tunnel) {
        this.currentScene = this.tunnel!;
        this.camera.position.set(0, 0, 9);
        this.camera.rotation.set(0, 0, 0);
        this.camera.fov = 78;
        this.camera.updateProjectionMatrix();
        this.audio.tunnelRush(3.6);
      }
      this.bsod.update(this.time, this.settings.reducedFlash);
    } else if (t < 9.9) {
      // falling through the monitor's throat
      this.setFlash(Math.max(0, this.flash - dt * 3.1));
      const pt = (t - 6.32) / 3.58;
      const e = easeInCubic(clamp01(pt));
      this.camera.position.z = lerp(9, -74, e);
      this.camera.position.x = Math.sin(t * 2.1) * 0.5 * (1 - pt);
      this.camera.position.y = Math.cos(t * 1.7) * 0.45 * (1 - pt);
      this.camera.rotation.z = Math.sin(t * 1.4) * 0.09 + pt * pt * 0.6;
      this.camera.rotation.x = Math.sin(t * 1.1) * 0.05;
      this.camera.fov = lerp(78, 73, pt);
      this.camera.updateProjectionMatrix();
      if (this.tunnelTexture) this.tunnelTexture.offset.y -= dt * (1.6 + pt * 7.5);
      // rings pulse as we pass
      for (const ring of this.tunnelRings) {
        const dz = ring.position.z - this.camera.position.z;
        const prox = clamp01(1 - Math.abs(dz) / 6);
        const s = 1 + prox * 0.35 + Math.sin(this.time * 6 + dz) * 0.03;
        ring.scale.setScalar(s);
        ring.rotation.z += dt * 0.6;
      }
      if (this.tunnelPoints) this.tunnelPoints.rotation.z = t * 0.15;
      if (pt > 0.86 && this.flashTarget === 1) {
        this.flashTarget = 2; // trigger final flash below
      }
    } else if (t >= 9.9) {
      // out the other side — the world
      this.setFlash(1);
      if (this.currentScene !== this.worldScene) {
        this.enterWorld();
        this.flashHold = 0;
      } else {
        this.flashHold += dt;
        if (this.flashHold > 0.42) this.setFlash(Math.max(0, 1 - (this.flashHold - 0.42) * 1.35));
      }
    }

    if (t >= cine.dur) {
      this.cine = null;
      this.setFlash(0);
      this.flashTarget = 0;
      this.flashHold = 0;
      this.setLetterbox(false);
      this.setPhase('world');
      this.events.onSubtitle('――ここは、どこ。');
      window.setTimeout(() => this.events.onSubtitle(null), 3400);
    }
  }

  private enterWorld() {
    const world = this.world!;
    this.currentScene = this.worldScene!;
    const gy = terrainHeightAt(world.spawn.pos.x, world.spawn.pos.z);
    const ground = Math.max(gy, 0);
    this.camera.position.set(world.spawn.pos.x, ground + WORLD_EYE + 5.5, world.spawn.pos.z);
    this.yaw = world.spawn.yaw;
    this.pitch = 0.32;
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.fov = 74;
    this.camera.updateProjectionMatrix();
    this.worldFallVel = 2.2;
    this.audio.startWorldDrone();
    this.events.onToast('C — コンソール', 5200);
  }

  /* ================= collapse cinematic ================= */

  startCollapse() {
    if (this.cine || !this.world) return;
    this.stopWalkKeys();
    this.cine = { kind: 'collapse', t: 0, dur: 13.6 };
    this.collapseFocusFrom = { yaw: this.yaw, pitch: this.pitch };
    this.setPhase('collapse');
    this.setLetterbox(true);
    this.events.onPrompt(null);
    this.events.onObjective(null);
    this.events.onSubtitle(null);
    document.exitPointerLock?.();
    this.audio.groan();
    this.audio.heartbeat(120, 5);
    const world = this.world;
    world.redBeacon.intensity = 14;
    world.rackLEDs.forEach((m) => (m.emissive.set(0xff2222), (m.emissiveIntensity = 3)));
    // camera shake of the initial shock
    this.shakeAmp = 0.05;
    this.shakeT = 0;
  }

  private stopWalkKeys() {
    this.keys.clear();
    this.footstepTimer = 0;
  }

  /** piecewise camera direction during the collapse, hand-tuned for dread */
  private collapsePose(t: number): { yawOffset: number; pitch: number; yBob: number; stepBack: number } {
    const keys: { t: number; yaw: number; pitch: number }[] = [
      { t: 0.0, yaw: 0.0, pitch: 0.1 },
      { t: 0.55, yaw: -0.62, pitch: 0.16 },   // whip left
      { t: 1.15, yaw: -0.58, pitch: 0.3 },    // hold, trembling
      { t: 1.75, yaw: 0.72, pitch: 0.12 },    // whip right
      { t: 2.35, yaw: 0.66, pitch: 0.34 },    // the structure is splitting
      { t: 3.0, yaw: 0.0, pitch: 0.42 },      // straight up at it
      { t: 3.75, yaw: 0.1, pitch: -1.02 },    // down — the crack
      { t: 4.45, yaw: -0.28, pitch: -0.95 },  // tracking it, stumbling back
      { t: 5.15, yaw: 0.34, pitch: -0.25 },   // scrambling upright
      { t: 5.6, yaw: 0.0, pitch: 0.5 },       // the ring lets go
      { t: 6.2, yaw: 0.15, pitch: 0.9 },      // falling — look up
    ];
    let a = keys[0], b = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].t && t <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
    }
    const span = Math.max(0.0001, b.t - a.t);
    const k = smoothstep(clamp01((t - a.t) / span));
    const panicky = t < 6.0 ? 1 : 0.4;
    const noise =
      (Math.sin(t * 9.1) * 0.5 + Math.sin(t * 15.7 + 1.2) * 0.3 + Math.sin(t * 23.3 + 2.9) * 0.2) *
      0.055 * panicky;
    const yawOffset = lerp(a.yaw, b.yaw, k) + noise;
    const pitch = lerp(a.pitch, b.pitch, k) + Math.sin(t * 11.7 + 0.4) * 0.035 * panicky;
    // involuntary stumbling steps away from the dais center
    const stepBack = t < 5.3 ? 0 : clamp01((t - 5.3) / 1.05) * 1.55;
    const yBob = t < 5.3 ? 0 : Math.abs(Math.sin((t - 5.3) * 6.4)) * 0.055 * Math.max(0, 1 - (t - 5.3) / 1.2);
    return { yawOffset, pitch, yBob, stepBack };
  }

  private updateCollapse(dt: number) {
    const cine = this.cine!;
    cine.t += dt;
    const t = cine.t;
    const world = this.world!;
    this.shakeT += dt;

    /* scheduled one-shots */
    const fire = (time: number, flag: string, fn: () => void) => {
      const bag = (cine as unknown as Record<string, boolean>);
      if (t >= time && !bag[flag]) { bag[flag] = true; fn(); }
    };
    fire(2.9, 's_tear', () => { this.audio.tear(); this.audio.heartbeat(150, 5); });
    fire(3.6, 's_crackin', () => { /* crack fades in via opacity below */ });
    fire(5.25, 's_boom1', () => {
      this.audio.boom(1.15);
      this.shakeAmp = 0.16;
      this.shakeT = 0;
      // the dais lets go
      world.daisCore.visible = false;
      world.crack.visible = true;
      for (const f of world.fallers) {
        f.visible = true;
        const dir = f.position.clone().setY(0).normalize().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)).normalize();
        f.userData.vel.set(dir.x * (1.2 + Math.random() * 2.4), 0.4 + Math.random() * 1.4, dir.z * (1.2 + Math.random() * 2.4));
        f.userData.angVel.set(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3);
      }
      const streaks = world.group.getObjectByName('fall_streaks') as THREE.Points | undefined;
      if (streaks?.material instanceof THREE.PointsMaterial) streaks.material.opacity = 0.0; // ramped during fall
    });
    fire(5.9, 's_wind', () => { this.audio.startFallWind(); this.audio.heartbeat(168, 8); });
    fire(6.4, 's_sub1', () => this.events.onSubtitle('――地面が、無い'));
    fire(7.4, 's_sub2', () => this.events.onSubtitle(null));
    fire(9.6, 's_sub3', () => this.events.onSubtitle('――下へ。青より深い、青へ。'));
    fire(10.6, 's_sub4', () => this.events.onSubtitle(null));

    /* crack & sign fates */
    const crackMat = world.crack.material as THREE.MeshBasicMaterial;
    if (t > 2.9 && t < 6.2) crackMat.opacity = clamp01(crackMat.opacity + dt * 1.35);
    if (t >= 5.25) crackMat.opacity = Math.max(0, crackMat.opacity - dt * 1.6);

    /* the ring gutters out */
    if (t < 5.25) world.wakeLight.intensity = Math.max(0, world.wakeLight.intensity - dt * 2.4);

    /* physics of the falling floor */
    if (t >= 5.25) {
      for (const f of world.fallers) {
        if (!f.visible) continue;
        f.userData.vel.y -= 13.5 * dt;
        f.position.addScaledVector(f.userData.vel, dt);
        f.rotation.x += f.userData.angVel.x * dt;
        f.rotation.y += f.userData.angVel.y * dt;
        f.rotation.z += f.userData.angVel.z * dt;
        if (f.position.y < -34) f.visible = false;
      }
    }

    /* camera */
    if (this.currentScene !== this.worldScene) {
      // already landed in the room — hold the pose, shake decays on its own
    } else if (t < 6.2) {
      // phase A: frantic looking around, stumbling back
      const pose = this.collapsePose(t);
      const baseYaw = this.collapseFocusFrom.yaw;
      const daisY = 0.32;
      const ground = Math.max(terrainHeightAt(this.camera.position.x, this.camera.position.z), daisY);
      // stumble direction: away from dais center
      const away = this.camera.position.clone().setY(0).normalize();
      if (away.lengthSq() < 0.01) away.set(0, 0, 1);
      const step = pose.stepBack;
      const targetPos = new THREE.Vector3(0, ground, 0);
      const ringPos = new THREE.Vector3().copy(away).multiplyScalar(4.6 + step);
      targetPos.x = ringPos.x;
      targetPos.z = ringPos.z;
      targetPos.y = ground + WORLD_EYE + pose.yBob;
      // ease into it (don't pop)
      this.camera.position.lerp(targetPos, 1 - Math.exp(-3.4 * dt));
      this.camera.rotation.set(pose.pitch, baseYaw + pose.yawOffset, Math.sin(t * 13) * 0.012 * (t < 6 ? 1 : 0));
      this.camera.fov = lerp(74, 70, clamp01(t / 6.2));
      this.camera.updateProjectionMatrix();
      this.fallVel = 0;
    } else {
      // phase B: the plunge
      this.fallVel = Math.min(46, this.fallVel + 21 * dt + (this.fallVel === 0 ? 2.4 : 0));
      this.camera.position.y -= this.fallVel * dt;
      this.camera.position.x += Math.sin(t * 0.9) * 0.22 * dt;
      this.camera.position.z += Math.cos(t * 0.8) * 0.22 * dt;
      const pose = this.collapsePose(t);
      this.camera.rotation.set(
        lerp(0.9, 0.25, clamp01((t - 6.2) / 5)),
        this.collapseFocusFrom.yaw + pose.yawOffset * 0.4 + Math.sin(t * 0.7) * 0.22,
        Math.sin(t * 0.83) * 0.19
      );
      this.camera.fov = Math.min(85, this.camera.fov + dt * 2.4);
      this.camera.updateProjectionMatrix();
      const streaks = world.group.getObjectByName('fall_streaks') as THREE.Points | undefined;
      if (streaks?.material instanceof THREE.PointsMaterial) {
        streaks.material.opacity = clamp01((t - 5.9) / 2.2) * 0.95;
      }
      if (streaks) streaks.position.y += this.fallVel * dt * 0.55;
      // structures recede — handled naturally by the fall; flare the beacons
      world.redBeacon.intensity = 14 + Math.sin(t * 9) * 8;
      // the light above narrows to a coin, then a star, then nothing
      if (this.roomScene) { /* noop */ }
    }

    /* impact into the room */
    if (t >= cine.dur - 1.15 && this.currentScene !== this.roomScene) {
      this.landInRoom();
    }

    if (t >= cine.dur) {
      this.cine = null;
      this.fallActive = false;
      this.setLetterbox(false);
      this.setFlash(0);
      this.setPhase('returned');
      this.events.onSubtitle('――おかえり。');
      window.setTimeout(() => this.events.onSubtitle(null), 4200);
      // let the ringing ears heal
      window.setTimeout(() => this.audio.setMuffle(false), 2400);
    }
  }

  private landInRoom() {
    const room = this.room!;
    applyAftermath(room);
    this.currentScene = this.roomScene!;
    // kill the devoured corruption tint; the room is back, but not the same
    this.roomDread = 0.32;
    this.applyDread();
    if (this.roomScene?.fog instanceof THREE.Fog) {
      this.roomScene.fog.near = 9.5;
      this.roomScene.fog.far = 21;
    }
    this.bsod.residualMode = true;
    this.bsod.corruption = 0;
    this.bsod.overload = 0;
    // dropped onto the rug, facing the dead screen
    this.camera.position.set(0.34, EYE_HEIGHT, -0.05);
    this.yaw = Math.atan2(-(room.screenCenter.x - 0.34), -(room.screenCenter.z - (-0.05)));
    this.pitch = 0.08;
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.fov = 71;
    this.camera.updateProjectionMatrix();
    this.audio.stopWorldDrone();
    this.audio.stopFallWind();
    this.audio.impact();
    this.audio.startRoomTone();
    this.audio.setMuffle(true);
    this.shakeAmp = 0.13;
    this.shakeT = 0;
    this.setFlash(1);
    window.setTimeout(() => { this.flashTarget = 0; }, 30);
    // the CRT by the bed wakes with what is left
    const mat = room.bedsideScreen.material as THREE.MeshBasicMaterial;
    mat.color.set(0x0d2a3a);
    try { localStorage.setItem('bsod_cleared', '1'); } catch { /* noop */ }
  }

  /* ================= frame loop ================= */

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const t = this.time;
    if (this.paused) {
      if (this.currentScene) this.renderer.render(this.currentScene, this.camera);
      return;
    }

    // flash easing
    if (this.flashTarget === 0 && this.flash > 0) this.setFlash(Math.max(0, this.flash - dt * 3.4));

    // camera shake envelope
    if (this.shakeAmp > 0.0005) {
      this.shakeT += dt;
      this.shakeAmp *= Math.exp(-dt * 2.35);
    } else {
      this.shakeAmp = 0;
    }
    const shakeX = (Math.sin(t * 39.7) + Math.sin(t * 27.1 + 1)) * 0.5 * this.shakeAmp;
    const shakeY = (Math.cos(t * 34.3) + Math.sin(t * 23.9 + 2)) * 0.5 * this.shakeAmp;

    if (this.phase === 'title') {
      this.updateTitleAttract(t);
    } else if (this.phase === 'devoured' && this.cine) {
      this.updateDevoured(dt);
    } else if (this.phase === 'collapse' && this.cine) {
      this.updateCollapse(dt);
    } else if (this.walkPhase()) {
      this.updateWalk(dt, t);
    } else if (this.phase === 'examine') {
      this.updateExamine(dt, t);
    }

    /* shared world animation */
    if (this.currentScene === this.worldScene && this.world) this.updateWorldAmbient(dt, t);
    if (this.currentScene === this.roomScene && this.room) this.updateRoomAmbient(dt, t);
    if (this.phase === 'examine' || this.phase === 'returned') {
      // BSOD texture animates whenever the screen may be visible
      if (this.phase === 'examine') this.bsod.update(t, this.settings.reducedFlash);
      else if (Math.random() < 0.02) this.bsod.update(t, this.settings.reducedFlash);
    }

    // apply shake as a final additive offset on top of whatever pose we computed
    this.camera.position.x += shakeX;
    this.camera.position.y += shakeY;
    this.camera.rotation.z += shakeX * 0.14;

    if (this.currentScene) this.renderer.render(this.currentScene, this.camera);
  };

  private updateTitleAttract(t: number) {
    this.titleOrbit += 0.0016;
    const room = this.room;
    if (!room) return;
    const a = this.titleOrbit;
    const px = -0.2 + Math.cos(a) * 1.75;
    const pz = -0.15 + Math.sin(a) * 1.75;
    this.camera.position.set(px, 1.32 + Math.sin(t * 0.4) * 0.07, pz);
    this.camera.lookAt(room.screenCenter.x, room.screenCenter.y - 0.05, room.screenCenter.z);
    this.camera.rotation.z += Math.sin(t * 0.23) * 0.006;
    // the screen glows from title — the room is never truly at rest
    this.bsod.update(t, this.settings.reducedFlash);
  }

  private updateRoomAmbient(dt: number, t: number) {
    const room = this.room!;
    // dust drift
    room.dust.rotation.y = t * 0.008;
    // lamp flicker — uneasy
    const flick = 0.86 + Math.sin(t * 7.3) * 0.05 + Math.sin(t * 23.7) * 0.035 + (Math.random() < 0.012 ? -0.42 : 0);
    room.lampLight.intensity = Math.max(0.2, 8.5 * flick * (1 - this.roomDread));
    // monitor pulse
    room.pcGlow.intensity = (7.5 + Math.sin(t * (this.bsod.residualMode ? 0.8 : 1.7)) * 1.1 + (this.phase === 'examine' ? Math.sin(t * 9.1) * 1.4 * this.bsod.corruption : 0)) * (1 + this.roomDread * 0.7);
    // crystals breathe
    if (room.aftermath) {
      for (const c of room.crystals) {
        c.rotation.y += dt * 0.35;
        const m = c.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = 2.1 + Math.sin(t * 1.7 + c.position.x * 9) * 0.7;
      }
      // the dead CRT whispers
      if (Math.random() < 0.0016) {
        const mat = room.bedsideScreen.material as THREE.MeshBasicMaterial;
        mat.color.set(0x1b3c4d);
        window.setTimeout(() => mat.color.set(0x05070c), 130 + Math.random() * 160);
        this.audio.whisper();
      }
    }
  }

  private updateWorldAmbient(dt: number, t: number) {
    const world = this.world!;
    // floating dialogs & glyphs bob
    const glyphs = world.floatingGlyphs;
    for (let i = 0; i < glyphs.length; i++) {
      const m = glyphs[i];
      m.position.y += Math.sin(t * 0.42 + i * 1.7) * 0.0016;
      m.rotation.y += dt * 0.03 * ((i % 2) ? 1 : -1);
    }
    // rack LEDs flicker
    for (let i = 0; i < world.rackLEDs.length; i++) {
      const led = world.rackLEDs[i];
      if (Math.random() < 0.06) led.emissiveIntensity = Math.random() < 0.18 ? 0.2 : 2.2 + Math.random() * 1.6;
    }
    // the office chair orbits the abyss
    const chair = world.group.getObjectByName('void_chair');
    if (chair) {
      const a = t * 0.085 + 1.2;
      chair.position.set(Math.cos(a) * 30, 21 + Math.sin(t * 0.3) * 2.4, Math.sin(a) * 30);
      chair.rotation.y = -a;
      chair.rotation.z = 0.24 + Math.sin(t * 0.22) * 0.1;
      chair.rotation.x = 0.4;
    }
    // WAKE_UP sign pulse once revealed
    if (this.wakeRevealT >= 0) {
      this.wakeRevealT += dt;
      const k = clamp01(this.wakeRevealT / 2.2);
      const m = world.wakeSign.material as THREE.MeshBasicMaterial;
      m.opacity = (0.62 + Math.sin(t * 2.3) * 0.2) * smoothstep(k);
      world.wakeLight.intensity = (8 + Math.sin(t * 2.3) * 2.4) * smoothstep(k);
      world.wakeSign.position.y = 7.2 + Math.sin(t * 0.8) * 0.16;
      world.wakeSign.lookAt(this.camera.position.x, world.wakeSign.position.y, this.camera.position.z);
    }
    // anomaly surges — silence is allowed too, but rarely
    world.surgeTimer -= dt;
    if (world.surgeTimer <= 0) {
      world.surgeTimer = 24 + Math.random() * 26;
      this.worldSurge(t);
    }


  }

  private worldSurge(t: number) {
    const world = this.world!;
    this.audio.voidPing();
    this.audio.whisper();
    // flare the fog and halo briefly
    const scene = this.worldScene!;
    const fog = scene.fog;
    if (fog instanceof THREE.FogExp2) {
      const base = fog.density;
      const start = t;
      const tick = () => {
        const k = clamp01((this.time - start) / 2.6);
        fog.density = base * (1 + Math.sin(k * Math.PI) * 1.5);
        if (k < 1 && !this.disposed) requestAnimationFrame(tick);
        else fog.density = base;
      };
      tick();
    }
    (world.halo.material as THREE.MeshBasicMaterial).opacity = 1;
  }

  private updateWalk(dt: number, t: number) {
    const isWorld = this.phase === 'world';
    const room = this.room!;
    const world = this.world!;
    const bounds = isWorld
      ? null
      : room.bounds;

    /* movement input */
    const forward = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
    const strafe = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
    const run = this.keys.has('shift');
    const speed = run ? 4.15 : 2.32;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // camera forward is -Z rotated by yaw about Y
    let mx = -sin * forward + cos * strafe;
    let mz = -cos * forward - sin * strafe;
    const len = Math.hypot(mx, mz);
    this.walkMoveAmount = len > 0.001 ? 1 : Math.max(0, this.walkMoveAmount - dt * 3);
    if (len > 0.001) {
      mx /= len; mz /= len;
      const step = speed * dt;
      this.moveActor(mx * step, mz * step, isWorld, bounds);
      // head bob
      this.bobPhase += speed * dt * 1.62;
      this.footstepTimer -= dt * (run ? 1.55 : 1);
      if (this.footstepTimer <= 0) {
        this.footstepTimer = 0.34;
        this.audio.footstep(run);
      }
    }

    const ground = isWorld ? this.worldGround(this.camera.position.x, this.camera.position.z) : 0;
    // just dropped into the new world — land with a thud
    if (isWorld && this.worldFallVel > 0) {
      this.worldFallVel += 15.5 * dt;
      const newY = this.camera.position.y - this.worldFallVel * dt;
      const restY = ground + WORLD_EYE;
      if (newY <= restY) {
        this.camera.position.y = restY;
        this.worldFallVel = 0;
        this.pitch = 0;
        this.shakeAmp = Math.max(this.shakeAmp, 0.075);
        this.shakeT = 0;
        this.audio.boom(0.55);
      } else {
        this.camera.position.y = newY;
      }
    } else {
      const bob = Math.sin(this.bobPhase * 2) * 0.024 * this.walkMoveAmount;
      const sway = Math.sin(t * 0.55) * 0.006;
      this.camera.position.y = ground + (isWorld ? WORLD_EYE : EYE_HEIGHT) + bob + sway;
    }
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bobPhase) * 0.0035 * this.walkMoveAmount);
    // ease fov back to base after sprint
    const targetFov = run && len > 0.01 ? 74.5 : 71;
    this.camera.fov = lerp(this.camera.fov, targetFov, 1 - Math.exp(-6 * dt));

    /* smooth return from the examine pose after leaving the screen */
    if (this.exitBlend > 0) {
      this.exitBlend = Math.max(0, this.exitBlend - dt * 1.5);
      const k = smoothstep(this.exitBlend);
      this.camera.position.lerp(this.lastExaminePos, k);
      this.camera.quaternion.slerp(this.lastExamineQuat, k);
      this.camera.fov = lerp(this.camera.fov, this.lastExamineFov, k);
    }
    this.camera.updateProjectionMatrix();

    /* prompts & discovery */
    if (!isWorld) {
      if (this.phase === 'room' && this.nearPC()) this.events.onPrompt('E — PCを調べる');
      else if (this.phase === 'returned' && this.nearPC()) this.events.onPrompt('E — モニターを見る');
      else this.events.onPrompt(null);
    } else {
      const d = Math.hypot(this.camera.position.x - world.center.x, this.camera.position.z - world.center.z);
      if (!this.wakeDiscovered && d < world.revealRadius) {
        this.wakeDiscovered = true;
        this.wakeRevealT = 0;
        this.events.onWakeDiscovered();
        this.events.onToast('WAKE_UP —— この言葉が、世界の中心に焼かれている', 6500);
        this.events.onObjective('復帰コマンド: WAKE_UP');
        this.audio.wakeConfirmed();
      }
      if (this.consoleOpen) this.events.onPrompt(null);
      else if (d < 16 && this.wakeDiscovered) this.events.onPrompt('C — カーネルコンソール');
      else this.events.onPrompt(null);
    }
  }

  private worldGround(x: number, z: number) {
    const base = terrainHeightAt(x, z);
    const d = Math.hypot(x, z);
    if (d < 9.4) return Math.max(base, 0.32); // dais top
    return base;
  }

  private moveActor(dx: number, dz: number, isWorld: boolean, roomBounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null) {
    const p = this.camera.position;
    const R = 0.32;
    const tryMove = (nx: number, nz: number) => {
      if (isWorld) {
        const world = this.world!;
        const d = Math.hypot(nx, nz);
        if (d > world.boundsRadius) return false;
        for (const c of world.colliders) {
          if (Math.hypot(nx - c.x, nz - c.z) < c.r + R) return false;
        }
        for (const b of world.boxColliders) {
          if (nx > b.minX - R && nx < b.maxX + R && nz > b.minZ - R && nz < b.maxZ + R) return false;
        }
        return true;
      }
      const room = this.room!;
      if (nx < roomBounds!.minX + R || nx > roomBounds!.maxX - R) return false;
      if (nz < roomBounds!.minZ + R || nz > roomBounds!.maxZ - R) return false;
      for (const b of room.colliders.boxes) {
        if (nx > b.minX - R && nx < b.maxX + R && nz > b.minZ - R && nz < b.maxZ + R) return false;
      }
      for (const c of room.colliders.circles) {
        if (Math.hypot(nx - c.x, nz - c.z) < c.r + R) return false;
      }
      return true;
    };
    if (tryMove(p.x + dx, p.z)) p.x += dx;
    if (tryMove(p.x, p.z + dz)) p.z += dz;
  }

  private updateExamine(dt: number, t: number) {
    this.examineBlend = Math.min(1, this.examineBlend + dt * 1.75);
    const k = smoothstep(this.examineBlend);
    const room = this.room!;
    // ease from walk pose into the screen-hugging pose
    const targetPos = room.examinePos.clone();
    const pos = this.walkPosAtExamine.clone().lerp(targetPos, k);
    pos.y += Math.sin(t * 1.35) * 0.008 * k;
    this.camera.position.copy(pos);
    const look = room.examineLook;
    this.camera.lookAt(look);
    this.camera.rotation.z += Math.sin(t * 0.9) * 0.004 * k;
    this.camera.fov = lerp(this.walkFovAtExamine, 66, k);
    this.camera.updateProjectionMatrix();
    // cache for the blend back to walking
    this.lastExaminePos.copy(this.camera.position);
    this.lastExamineQuat.copy(this.camera.quaternion);
    this.lastExamineFov = this.camera.fov;

    // BSOD hover raycast for the hotspot cursor
    this.raycaster.setFromCamera(this.mouseNdc, this.camera);
    const hits = this.raycaster.intersectObject(room.screenPlane, false);
    const hovering = hits.length > 0 && hits[0].uv ? this.bsod.hotspotContains(hits[0].uv.x, hits[0].uv.y) : false;
    this.bsod.hover = hovering;
    this.canvas.style.cursor = hits.length > 0 ? (hovering ? 'pointer' : 'crosshair') : 'default';
    // subtle breathing of the glyph while hovered handled inside BsodScreen
  }
}
