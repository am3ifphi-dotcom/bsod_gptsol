import * as THREE from "three";
import { AudioEngine } from "./audio";
import type { Assets } from "./assets";
import { makeScrollTexture } from "./canvas";
import { FirstPerson } from "./player";
import { Input } from "./input";
import { PostFX } from "./post";
import { RoomScene } from "./room";
import { WorldScene, terrainHeight } from "./world";
import { Spring, clamp, damp, easeInOutCubic, easeOutCubic, lerp, saturate, smoothstep } from "./util";
import type { Phase } from "./types";

export type LogKind = "cmd" | "out" | "err" | "sys" | "dim" | "echo";
export interface LogLine {
  id: number;
  text: string;
  kind: LogKind;
}

export interface UIState {
  phase: Phase;
  prompt: { label: string; hint: string } | null;
  subtitle: { text: string; sub?: string; key: number } | null;
  objective: string | null;
  hint: string | null;
  corruption: number;
  consoleOpen: boolean;
  cursor: boolean;
  cursorHot: boolean;
  busy: boolean;
  locked: boolean;
  dragHint: boolean;
  areaCard: { jp: string; en: string; key: number } | null;
  ended: boolean;
  found: boolean;
  paused: boolean;
}

export interface EngineCallbacks {
  onUI: (patch: Partial<UIState>) => void;
  onLine: (line: Omit<LogLine, "id">) => void;
  onClearConsole: () => void;
}

const FOV_GAME = 68;

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private post: PostFX;
  private input: Input;
  private audio: AudioEngine;
  private player = new FirstPerson();
  private room: RoomScene;
  private world: WorldScene;
  private phase: Phase = "boot";
  private clock = 0;
  private raf = 0;
  private last = 0;
  private disposed = false;
  private paused = false;

  /* camera state used by scripted sequences */
  private camPos = new THREE.Vector3(1.35, 1.64, 1.05);
  private yaw = 1.24;
  private pitch = 0;
  private roll = 0;
  private fov = FOV_GAME;
  private yawSpring = new Spring(1.24);
  private pitchSpring = new Spring(0);
  private rollSpring = new Spring(0);
  private shake = 0;
  private flash = 0;
  private glitch = 0;
  private warp = 0;
  private radial = 0;
  private chroma = 0.01;
  private pixel = 0;
  private inside = 0;

  /* sequence state */
  private seqT = 0;
  private focusT = 0;
  private corruption = 0;
  private focusFrom = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private focusPose: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private cursorNdc = new THREE.Vector2(0, 0);
  private cursorPx = { x: 0, y: 0 };
  private hot = false;
  private collapseBaseYaw = 0;
  private collapseT = 0;
  private fallV = 0;
  private landed = false;
  private clickLock = 0;
  private hudPrompt: string | null = null;
  private pointerSeen = false;
  private tunnelScene: THREE.Scene | null = null;
  private tunnelCam: THREE.PerspectiveCamera | null = null;
  private tunnelScroll: THREE.Mesh[] = [];
  private subKey = 0;
  private areaKey = 0;
  private ended = false;
  private found = false;
  private currentObjective: string | null = null;
  private activeInteract: string | null = null;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly surfaceRoom;
  private readonly surfaceWorld;

  constructor(
    private canvas: HTMLCanvasElement,
    assets: Assets,
    audioCtx: AudioContext,
    private cb: EngineCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
      alpha: false,
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x03050a, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));

    this.camera = new THREE.PerspectiveCamera(FOV_GAME, 1, 0.03, 400);
    this.camera.position.copy(this.camPos);
    this.post = new PostFX(this.renderer);
    this.input = new Input(canvas);
    this.audio = new AudioEngine(audioCtx, assets);

    this.room = new RoomScene(assets);
    this.room.build();
    this.world = new WorldScene(assets);
    this.world.build();
    this.surfaceRoom = this.room.surface;
    this.surfaceWorld = this.world.surface;

    this.player.onStep = (running) => this.audio.footstep(running);
    this.player.reset(this.room.boot.x, this.room.boot.z, this.room.bootYaw, this.surfaceRoom);
    this.camPos.copy(this.player.eye);

    this.bindInput();
    this.resize();
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /* ------------------------------------------------------------------ */
  async init() {
    this.setPhase("title");
    this.cb.onLine({ kind: "dim", text: "NULL_STUDIO kernel recovery console v0.9.4" });
    this.cb.onLine({ kind: "dim", text: "接続を待機しています…" });
    this.startLoop();
  }

  private startLoop() {
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      if (dt <= 0) return;
      this.clock += dt;
      if (!this.paused) this.update(dt);
      this.render();
      this.audio.update(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h, this.renderer.getPixelRatio());
  };

  private onVisibility = () => {
    if (document.hidden) {
      this.setPaused(true);
    }
  };

  /* ------------------------------------------------------------------ */
  start() {
    if (this.phase !== "title") return;
    this.audio.resume();
    this.setPhase("room");
    this.room.setCorruption(0);
    this.corruption = 0;
    this.setObjective("机の上の PC に近づく");
    this.say("02:47。部屋の電気はつけていない。", undefined, 4.2);
    this.audio.bed("room-tone", "room_tone", 0.34);
    this.audio.bed("fan", "pc_fan_hum", 0.16);
    this.audio.bed("clock", "clock_tick", 0.06, { rate: 0.94 });
    this.audio.bed("drone", "bgm_dread_drone", 0.1);
    this.input.requestLock();
    this.emitUI({ objective: this.currentObjective, hint: "WASD 移動 / SHIFT 走る / E 調べる / M ミュート" });
    setTimeout(() => this.emitUI({ dragHint: this.input.lockDenied }), 1400);
  }

  setPhase(p: Phase) {
    this.phase = p;
    this.emitUI({ phase: p });
  }

  private setObjective(text: string | null) {
    this.currentObjective = text;
    this.emitUI({ objective: text });
  }

  private say(text: string, sub: string | undefined, duration = 4.6) {
    this.subKey++;
    this.emitUI({ subtitle: { text, sub, key: this.subKey } });
    window.clearTimeout((this as unknown as { _subT?: number })._subT);
    (this as unknown as { _subT?: number })._subT = window.setTimeout(() => {
      this.emitUI({ subtitle: null });
    }, duration * 1000);
  }

  private card(jp: string, en: string, ms = 3200) {
    this.areaKey++;
    this.emitUI({ areaCard: { jp, en, key: this.areaKey } });
    window.setTimeout(() => this.emitUI({ areaCard: null }), ms);
  }

  private uiCache: Partial<UIState> = {};
  private emitUI(patch: Partial<UIState>) {
    const out: Partial<UIState> = {};
    let any = false;
    for (const k of Object.keys(patch) as (keyof UIState)[]) {
      const next = patch[k];
      const prev = this.uiCache[k];
      if (typeof next === "number" && typeof prev === "number") {
        if (Math.abs(next - prev) < 0.004) continue;
      } else if (next === prev) {
        continue;
      }
      (this.uiCache as Record<string, unknown>)[k] = next;
      (out as Record<string, unknown>)[k] = next;
      any = true;
    }
    if (any) this.cb.onUI(out);
  }

  private push(kind: LogKind, text: string) {
    this.cb.onLine({ kind, text });
  }

  /* ------------------------------------------------------------------ */
  private bindInput() {
    this.input.onKeyDown_((code, ev) => {
      if (code === "Escape") {
        if (this.isConsoleOpen) {
          this.closeConsole();
          return;
        }
        if (this.paused) {
          this.setPaused(false);
          return;
        }
        if (this.phase === "room" || this.phase === "world" || this.phase === "aftermath") {
          this.setPaused(true);
        }
        return;
      }
      if (this.paused) return;
      if (code === "KeyM") {
        this.audio.setMuted(!this.audio.isMuted);
        this.push("dim", this.audio.isMuted ? "mute: on" : "mute: off");
        return;
      }
      if (this.phase === "world" && code === "KeyC") {
        this.openConsole();
        ev.preventDefault();
        return;
      }
      if (this.phase === "focus") {
        if (code === "KeyQ") {
          if (this.corruption < 0.55) this.exitFocus();
          return;
        }
        if (code === "Space" || code === "Enter") {
          this.hitFace(0.12);
          return;
        }
      }
      if (code === "KeyR" && this.phase === "aftermath") {
        this.restart();
        return;
      }
      if (code === "KeyE" || code === "KeyF") {
        if (this.phase === "room" || this.phase === "aftermath") this.interact();
      }
    });

    this.input.onClick_((x, y) => {
      if (this.paused || this.isConsoleOpen) return;
      if (this.phase === "focus") {
        this.cursorPx = { x, y };
        this.updateCursor(x, y);
        if (this.clickLock > 0) return;
        const pick = this.room.pickScreen(this.cursorNdc, this.camera);
        if (pick.hit) this.hitFace(pick.overFace ? 0.13 : 0.055);
      }
      if (!this.input.pointerLocked && (this.phase === "room" || this.phase === "world" || this.phase === "aftermath")) {
        this.input.requestLock();
      }
    });

    window.addEventListener("mousemove", this.onMouseMove);

    this.input.onLockChange_((locked) => {
      if (locked) return;
      if (this.phase !== "room" && this.phase !== "world" && this.phase !== "aftermath") return;
      if (this.isConsoleOpen || this.paused) return;
      this.setPaused(true);
    });
  }

  private onMouseMove = (e: MouseEvent) => {
    this.cursorPx = { x: e.clientX, y: e.clientY };
    if (this.phase === "focus") this.updateCursor(e.clientX, e.clientY);
  };

  private updateCursor(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    this.cursorNdc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    const pick = this.room.pickScreen(this.cursorNdc, this.camera);
    if (pick.overFace !== this.hot) {
      this.hot = pick.overFace;
      this.emitUI({ cursorHot: this.hot });
    }
    if (pick.uv) this.room.setMouseUv(pick.uv.x, pick.uv.y);
  }

  /* ------------------------------------------------------------------ */
  private interact() {
    const id = this.activeInteract;
    if (!id) return;
    if (id === "monitor") {
      if (this.phase === "aftermath") {
        if (this.restartPending) return;
        this.restartPending = true;
        this.player.enabled = false;
        this.audio.play("void_swell", { volume: 0.4 });
        this.say("……戻るなら、今。", "再起動します", 2.4);
        this.flash = 0.25;
        this.glitch = 0.5;
        window.setTimeout(() => {
          this.restartPending = false;
          this.restart();
        }, 1900);
        return;
      }
      this.enterFocus();
      return;
    }
    if (id === "door") {
      this.audio.play("creak_room", { volume: 0.34, rate: 0.8 });
      this.say("鍵がかかっている。……内側から、か。", undefined, 4.2);
      this.audio.play("sub_boom", { volume: 0.18 });
      return;
    }
    if (id === "tower") {
      this.audio.play("mouse_click", { volume: 0.2 });
      this.audio.play("static_elec", { volume: 0.12 });
      this.say("ファンは回っている。ケースの側面が、少し熱い。", undefined, 4);
      return;
    }
    if (id === "bed") {
      this.say("眠るには、まだ早い。……早い、はずだった。", undefined, 4);
      return;
    }
    if (id === "window") {
      this.audio.play("swoosh_thunder", { volume: 0.22, rate: 1.1 });
      this.say("雨は降り続けている。街の明かりは、一つも動かない。", undefined, 4.4);
      return;
    }
  }

  /* ---------------- focus / BSOD ---------------- */
  private enterFocus() {
    const pose = this.room.focusPose;
    if (!pose) return;
    this.focusPose = pose;
    this.focusFrom.pos.copy(this.camPos);
    this.focusFrom.yaw = this.yaw;
    this.focusFrom.pitch = this.pitch;
    this.focusT = 0;
    this.corruption = 0;
    this.room.setCorruption(0);
    this.player.enabled = false;
    this.setPhase("focus");
    this.input.exitLock();
    this.emitUI({ cursor: true, prompt: null, corruption: 0, busy: false });
    this.setObjective("画面の顔を、クリックする");
    this.audio.bed("monitor", "monitor_glitch", 0.12, { rate: 0.9 });
    this.audio.setBedGain("fan", 0.24, 1.2);
    this.say("画面が青い。「:(」がこちらを見ている。", undefined, 4);
    setTimeout(() => {
      if (this.phase === "focus") this.say("カーソルを重ねて、クリック。", undefined, 3.4);
    }, 4200);
  }

  private exitFocus() {
    if (this.phase !== "focus") return;
    this.emitUI({ cursor: false });
    this.audio.stopBed("monitor", 0.8);
    this.setCorruption(0);
    this.room.setCorruption(0);
    this.focusT = 0;
    this.focusFrom.pos.copy(this.camPos);
    this.focusFrom.yaw = this.yaw;
    this.focusFrom.pitch = this.pitch;
    this.player.enabled = true;
    this.setPhase("room");
    this.setObjective("机の上の PC に近づく");
    this.input.requestLock();
  }

  private setCorruption(v: number) {
    this.corruption = clamp(v, 0, 1);
    this.room.setCorruption(this.corruption);
    this.emitUI({ corruption: this.corruption });
  }

  private hitFace(amount: number) {
    if (this.phase !== "focus") return;
    this.setCorruption(this.corruption + amount);
    this.shake = Math.min(1, this.shake + 0.35 + this.corruption * 0.4);
    this.clickLock = 0.09;
    this.audio.play("glitch_short", { volume: 0.4 + this.corruption * 0.2, rate: 0.9 + Math.random() * 0.3 });
    this.audio.play("mouse_click", { volume: 0.25 });
    if (this.corruption > 0.35 && Math.random() < 0.5) this.audio.play("static_elec", { volume: 0.2 });
    if (this.corruption > 0.6 && Math.random() < 0.5) this.audio.play("heartbeat", { volume: 0.3 });

    const milestones: [number, string][] = [
      [0.22, "画面の文字が、少しだけ滲んだ。"],
      [0.45, "「:(」が、大きくなっている。……気のせいだ。"],
      [0.62, "壁の漆喰が、内側から押されている。"],
      [0.78, "部屋の音が、全部モニターへ吸い込まれていく。"],
      [0.92, "逃げられない。もう、遅い。"],
    ];
    for (const [m, text] of milestones) {
      if (this.corruption >= m && !this.firedMilestones.has(m)) {
        this.firedMilestones.add(m);
        this.say(text, undefined, 4);
        this.audio.play("creak_room", { volume: 0.2, rate: 0.7 });
      }
    }
    if (this.corruption >= 1) {
      this.firedMilestones.clear();
      this.beginEaten();
    }
  }

  private firedMilestones = new Set<number>();
  private restartPending = false;

  /* ---------------- eaten transition ---------------- */
  private beginEaten() {
    this.setPhase("eaten");
    this.seqT = 0;
    this.emitUI({ cursor: false, prompt: null, busy: true, corruption: 1 });
    this.setObjective(null);
    this.audio.stopBed("monitor", 0.4);
    this.audio.play("horror_riser", { volume: 0.7 });
    this.audio.play("void_swell", { volume: 0.55 });
    this.say("――まずい。", undefined, 2);
    this.camPos.copy(this.camera.position);
  }

  private buildTunnel() {
    if (this.tunnelScene) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02132b);
    const cam = new THREE.PerspectiveCamera(96, this.camera.aspect, 0.05, 200);
    scene.add(cam);
    this.tunnelCam = cam;

    const rows: string[] = [];
    for (let i = 0; i < 40; i++) {
      rows.push(
        `${["0x000000F4", "CRITICAL", ":(", "WAKE_UP", "0xDEADBEEF", "NOT RESPONDING"][i % 6]}` +
          `  ${["NTOSKRNL", "USER32", "NULL", "HAL", "STOP"][i % 5]}  0x${(1000 + i * 137).toString(16).toUpperCase()}`,
      );
    }
    const tex = makeScrollTexture(rows);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 5);
    const geo = new THREE.CylinderGeometry(4.2, 4.2, 140, 40, 1, true);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const tunnel = new THREE.Mesh(geo, mat);
    tunnel.position.z = -55;
    scene.add(tunnel);
    this.tunnelScroll.push(tunnel);

    const geo2 = new THREE.CylinderGeometry(2.6, 2.6, 140, 24, 1, true);
    geo2.rotateX(Math.PI / 2);
    const mat2 = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      color: 0x9fd8ff,
    });
    const inner = new THREE.Mesh(geo2, mat2);
    inner.position.z = -35;
    scene.add(inner);
    this.tunnelScroll.push(inner);
    this.tunnelScene = scene;

    const light = new THREE.PointLight(0x9fd8ff, 20, 80, 2);
    scene.add(light);
  }

  /* ---------------- world ---------------- */
  private enterWorld() {
    this.player.reset(this.world.spawn.x, this.world.spawn.z, this.world.spawnYaw, this.surfaceWorld);
    this.player.eyeHeight = 0.62;
    this.player.enabled = false;
    this.player.pitch = 0;
    this.fov = 100;
    this.camPos.copy(this.player.eye);
    this.setPhase("world");
    this.seqT = 0;
    this.emitUI({ busy: true, cursor: false, corruption: 0 });
    this.setObjective("中心の構造物へ");
    this.card("システムメモリ", "SYSTEM MEMORY / 0x000000F4");
    this.audio.stopAllBeds(0.6);
    this.audio.play("static_elec", { volume: 0.4 });
    this.audio.play("transition_solemn", { volume: 0.5 });
    this.audio.bed("world", "bgm_glitch_world", 0.32);
    this.audio.bed("void", "bgm_dread_drone", 0.14, { rate: 0.78 });
    this.audio.bed("fan", "pc_fan_hum", 0.05, { rate: 0.6 });
    this.say("ここは、どこだ。", undefined, 4);
    this.found = false;
    this.emitUI({ found: false, hint: "WASD 移動 / SHIFT 走る" });
  }

  private enterCollapse() {
    this.setPhase("collapse");
    this.collapseT = 0;
    this.seqT = 0;
    this.fallV = 0;
    this.landed = false;
    this.collapseBaseYaw = this.yaw;
    this.yawSpring.reset(this.yaw);
    this.pitchSpring.reset(this.pitch);
    this.rollSpring.reset(0);
    this.emitUI({ busy: true, prompt: null, consoleOpen: false });
    this.setObjective(null);
    this.audio.stopAllBeds(1.4);
    this.audio.play("earthquake", { volume: 0.75 });
    this.audio.play("sub_boom", { volume: 0.6 });
    this.audio.play("heartbeat", { volume: 0.5 });
    this.audio.bed("fall", "fall_wind", 0.0);
    this.say("……コンソールが、応答した。", undefined, 2.4);
  }

  /* ---------------- console ---------------- */
  private commandHistory: string[] = [];

  openConsole() {
    if (this.phase !== "world" || this.isConsoleOpen) return;
    this.isConsoleOpen = true;
    this.input.textMode = true;
    this.input.exitLock();
    this.emitUI({ consoleOpen: true, prompt: null });
    this.audio.play("void_swell", { volume: 0.2, rate: 1.4 });
  }

  closeConsole() {
    if (!this.isConsoleOpen) return;
    this.isConsoleOpen = false;
    this.input.textMode = false;
    this.emitUI({ consoleOpen: false });
    if (this.phase === "world") this.input.requestLock();
  }

  private isConsoleOpen = false;

  submitCommand(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;
    this.commandHistory.push(cmd);
    this.push("cmd", `> ${cmd}`);
    this.audio.play(`key${1 + Math.floor(Math.random() * 4)}` as "key1", { volume: 0.25 });
    const norm = cmd.toLowerCase().replace(/[\s_-]+/g, "");
    const delay = (ms: number, fn: () => void) => window.setTimeout(fn, ms);

    if (norm === "wakeup") {
      if (!this.world.wakeFound) {
        this.push("sys", "…その言葉を、どこで知った？");
        this.push("dim", "resolving command chain ... done");
      } else {
        this.push("sys", "> wake_up --force --return");
        this.push("dim", "ヒープ領域を開放しています ...");
      }
      this.push("err", "WARNING: この操作は、この世界を終了させます。");
      this.closeConsole();
      delay(900, () => {
        this.audio.play("core_scanner", { volume: 0.6 });
        this.say("世界が、応答した。", undefined, 2.2);
      });
      delay(1700, () => this.enterCollapse());
      return;
    }

    switch (norm) {
      case "help":
      case "commands":
        this.push("out", "利用可能なコマンド:");
        this.push("dim", "  help     この一覧を表示");
        this.push("dim", "  ls       カレント領域の内容");
        this.push("dim", "  cat <f>  ファイルを読む");
        this.push("dim", "  whoami   実行ユーザー");
        this.push("dim", "  status   カーネル状態");
        this.push("dim", "  clear    ログを消去");
        this.push("dim", "  exit     コンソールを閉じる");
        this.push("dim", "  それ以外は、世界が適当に解釈します。");
        return;
      case "ls":
      case "dir":
        this.push("out", "core.log        memory.dmp      user_02_47.log");
        this.push("out", "dream.img       self.exe        .wake");
        this.push("dim", "4 objects, 1 hidden, 1 知らないもの");
        return;
      case "cat":
        this.push("err", "usage: cat <file>");
        return;
      case "whoami":
        this.push("out", "user (uid=0247, 02:47 からログイン中)");
        return;
      case "status":
        this.push("sys", "kernel: NULL_STUDIO 0.9.4  state: NOT RESPONDING");
        this.push("dim", `memory: ${(this.corruption * 100).toFixed(0)}% 侵食  /  uptime: 13y 4m 02d`);
        this.push("dim", "self: intact?");
        return;
      case "clear":
        this.cb.onClearConsole();
        return;
      case "exit":
      case "quit":
        this.push("err", "このコンソールは、まだ閉じません。");
        this.audio.play("console_error", { volume: 0.3 });
        return;
      case "sudo":
      case "sudoexit":
        this.push("err", "user is not in the sudoers file. この世界に root はいない。");
        this.audio.play("console_error", { volume: 0.35 });
        return;
      case "pwd":
        this.push("out", "/dev/null/null/null/room");
        return;
      case "cd":
        this.push("err", "cd: ここから出る方法を探してください。");
        return;
      case "rm":
        this.push("err", "rm: 拒否されました。自分の部屋は消せません。");
        return;
      case "echo":
        this.push("echo", "…");
        return;
      case "open":
        this.push("err", "open: そんなファイルはありません。");
        return;
    }

    if (norm.startsWith("cat")) {
      const file = cmd.split(/\s+/)[1] ?? "";
      this.catFile(file.toLowerCase());
      return;
    }
    if (norm.startsWith("echo")) {
      this.push("echo", cmd.slice(4).trim() || "…");
      return;
    }
    if (["hello", "hi", "konnichiwa", "こんにちは"].includes(norm)) {
      this.push("out", "こんにちは、user。ここは静かでしょう。");
      return;
    }
    if (norm.includes("help")) {
      this.push("err", "助けは、自分で見つけてください。");
      return;
    }
    // unknown
    this.push("err", `${cmd}: command not found`);
    if (Math.random() < 0.5) {
      this.push("dim", "世界が、あなたの言葉を理解できませんでした。");
      this.audio.play("console_error", { volume: 0.22 });
      this.world.setAnomaly(0.8);
    } else {
      this.push("dim", "そのコマンドは、ここでは意味を持ちません。");
    }
  }

  private catFile(file: string) {
    switch (file) {
      case "core.log":
        this.push("out", "02:47:03  boot ... ok");
        this.push("out", "02:47:04  user session started");
        this.push("out", "02:47:56  ??? が 部屋 を 参照しました");
        this.push("out", "02:47:57  STOP 0x000000F4");
        return;
      case "user_02_47.log":
        this.push("out", "02:47  ただいま");
        this.push("out", "02:47  ねむい");
        this.push("out", "02:47  しごとがおわらない");
        this.push("out", "02:47  ???");
        return;
      case "self.exe":
        this.push("err", "cannot execute: file is already running");
        return;
      case ".wake":
        this.push("sys", "このファイルを読むことはできます。");
        this.push("dim", "中身: W A K E _ U P");
        this.say("……書いてある。WAKE_UP、と。", undefined, 4);
        return;
      case "dream.img":
        this.push("out", "マウントできません。このイメージは既に展開されています。");
        return;
      default:
        this.push("err", `cat: ${file || "?"}: そのようなファイルはありません`);
    }
  }

  /* ---------------- pause ---------------- */
  setPaused(v: boolean) {
    if (this.phase === "title" || this.phase === "boot") return;
    if (v && this.phase === "eaten") return;
    this.paused = v;
    this.emitUI({ paused: v });
    this.audio.setDuck(v ? 0.25 : 1, 0.25);
    this.emitUI({ busy: v });
    if (v) {
      this.input.textMode = true;
      this.input.exitLock();
    } else {
      this.input.textMode = this.isConsoleOpen;
      if (!this.isConsoleOpen && (this.phase === "room" || this.phase === "world" || this.phase === "aftermath")) {
        this.input.requestLock();
      }
    }
  }

  get isPaused() {
    return this.paused;
  }

  setVolume(v: number) {
    this.audio.setVolume(v);
  }

  setMuted(v: boolean) {
    this.audio.setMuted(v);
  }

  restart() {
    this.paused = false;
    this.seqT = 0;
    this.focusT = 0;
    this.focusPose = null;
    this.renderScene = null;
    this.tunnelCamera = null;
    this.firedMilestones.clear();
    this.clickLock = 0;
    this.hot = false;
    this.hudPrompt = null;
    this.activeInteract = null;
    this.shake = 0;
    this.flash = 0;
    this.glitch = 0;
    this.warp = 0;
    this.radial = 0;
    this.pixel = 0;
    this.chroma = 0.012;
    this.inside = 0;
    this.roomFall = false;
    this.holeSpawned = false;
    this.crackedAudio = false;
    this.ceilingBurst = false;
    this.afterDone = false;
    this.landed = false;
    this.room.resetAftermath();
    this.room.setCorruption(0);
    this.room.setCeilingVisible(true);
    this.world.reset();
    this.corruption = 0;
    this.ended = false;
    this.found = false;
    this.isConsoleOpen = false;
    this.input.textMode = false;
    this.player.reset(this.room.boot.x, this.room.boot.z, this.room.bootYaw, this.surfaceRoom);
    this.camPos.copy(this.player.eye);
    this.yaw = this.player.yaw;
    this.pitch = 0;
    this.fov = FOV_GAME;
    this.player.enabled = true;
    this.player.eyeHeight = 1.62;
    this.audio.stopAllBeds(0.35);
    this.audio.bed("room-tone", "room_tone", 0.34);
    this.audio.bed("fan", "pc_fan_hum", 0.16);
    this.audio.bed("clock", "clock_tick", 0.06, { rate: 0.94 });
    this.audio.bed("drone", "bgm_dread_drone", 0.1);
    this.audio.setBedGain("fan", 0.16, 0.1);
    this.setPhase("room");
    this.emitUI({
      ended: false,
      found: false,
      paused: false,
      corruption: 0,
      cursor: false,
      cursorHot: false,
      subtitle: null,
      areaCard: null,
      prompt: null,
      busy: false,
      consoleOpen: false,
      hint: "WASD 移動 / SHIFT 走る / E 調べる",
    });
    this.setObjective("机の上の PC に近づく");
    this.audio.bed("room-tone", "room_tone", 0.34);
    this.audio.bed("fan", "pc_fan_hum", 0.16);
    this.audio.play("tape_stop", { volume: 0.4 });
    this.say("……もう一度、最初から。", undefined, 3.6);
    this.input.requestLock();
  }

  /* ================================================================== */
  private update(dt: number) {
    const look = this.input.consumeLook();
    if (this.phase === "room" || this.phase === "aftermath" || this.phase === "world") {
      if (!this.isConsoleOpen) this.player.addLook(look.x, look.y);
    }
    this.shake = Math.max(0, this.shake - dt * 1.7);
    this.flash = Math.max(0, this.flash - dt * 2.4);
    this.clickLock = Math.max(0, this.clickLock - dt);

    switch (this.phase) {
      case "room":
      case "aftermath":
        this.updateRoom(dt);
        break;
      case "focus":
        this.updateFocus(dt);
        break;
      case "eaten":
        this.updateEaten(dt);
        break;
      case "world":
        this.updateWorld(dt);
        break;
      case "collapse":
        this.updateCollapse(dt);
        break;
      default:
        break;
    }

    this.updatePost(dt);
    const roomVisible = !(this.phase === "world" || (this.phase === "collapse" && !this.roomFall));
    this.room.update(roomVisible ? dt : 0, this.clock, this.player);
    const worldVisible = this.phase === "world" || (this.phase === "collapse" && !this.roomFall);
    this.world.update(worldVisible ? dt : 0, this.clock, this.camera.position);
  }

  /* ---------------- room ---------------- */
  private updateRoom(dt: number) {
    this.player.enabled = !this.paused;
    this.player.update(dt, this.input, this.surfaceRoom);
    this.player.applyToCamera(this.camera);
    this.camPos.copy(this.camera.position);
    this.yaw = this.player.yaw;
    this.pitch = this.player.pitch;
    this.roll = this.player.roll;
    this.fov = damp(this.fov, FOV_GAME, 6, dt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    // interact pick
    const found = this.findInteractable();
    this.setPrompt(found);
  }

  private findInteractable(): string | null {
    const cam = this.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    let best: { id: string; label: string; score: number } | null = null;
    for (const it of this.room.interactables) {
      const d = cam.position.distanceTo(it.anchor);
      if (d > it.radius + 1.2) continue;
      this.tmpV.subVectors(it.anchor, cam.position).normalize();
      const dot = this.tmpV.dot(fwd);
      if (dot < 0.5) continue;
      const score = dot * 2 - d * 0.4;
      if (!best || score > best.score) best = { id: it.id, label: it.label, score };
    }
    this.activeInteract = best?.id ?? null;
    return best ? best.id : null;
  }

  private setPrompt(id: string | null) {
    if (id === this.hudPrompt) return;
    this.hudPrompt = id;
    if (!id) {
      this.emitUI({ prompt: null });
      return;
    }
    const it = this.room.interactables.find((i) => i.id === id);
    this.emitUI({ prompt: it ? { label: it.label, hint: it.hint ?? "E" } : null });
  }

  /* ---------------- focus ---------------- */
  private updateFocus(dt: number) {
    const pose = this.focusPose;
    if (!pose) return;
    this.focusT = Math.min(1, this.focusT + dt / 0.85);
    const e = easeInOutCubic(this.focusT);

    // approach the glass, with a small arc and a hesitation at the end
    const targetPos = pose.position;
    this.tmpV.lerpVectors(this.focusFrom.pos, targetPos, e);
    this.tmpV.y += Math.sin(e * Math.PI) * 0.055;
    const yawT = Math.atan2(-(pose.target.x - this.tmpV.x), -(pose.target.z - this.tmpV.z));
    const pitchT = Math.atan2(pose.target.y - this.tmpV.y, Math.hypot(pose.target.x - this.tmpV.x, pose.target.z - this.tmpV.z));

    this.yaw = yawT;
    this.pitch = damp(this.pitch, pitchT, 8, dt);

    // handheld drift + fear shake
    const sh = this.corruption;
    this.camPos.set(
      this.tmpV.x + Math.sin(this.clock * 11.3) * 0.0016 + this.shake * Math.sin(this.clock * 61) * 0.012,
      this.tmpV.y + Math.sin(this.clock * 9.1) * 0.0014 + this.shake * Math.cos(this.clock * 53) * 0.01,
      this.tmpV.z + Math.sin(this.clock * 7.7) * 0.0012,
    );
    this.roll = Math.sin(this.clock * 2.1) * 0.0025 + this.shake * Math.sin(this.clock * 41) * 0.02;
    this.fov = damp(this.fov, FOV_GAME - 12 + sh * 10, 3, dt);
    this.applyCam();

    // keep the cursor hit-test fresh (camera is moving)
    if (this.pointerSeen) this.updateCursor(this.cursorPx.x, this.cursorPx.y);
    this.pointerSeen = true;
  }

  private applyCam() {
    this.camera.position.copy(this.camPos);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
    this.camera.rotateZ(this.roll);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- eaten ---------------- */
  private updateEaten(dt: number) {
    this.seqT += dt;
    const t = this.seqT;
    const info = this.room.getScreenWorldInfo();
    this.yawSpring.update(this.yaw, 26, 9, dt);
    this.pitchSpring.update(this.pitch, 26, 9, dt);

    const lunge = smoothstep(0.45, 1.5, t);
    const plunge = smoothstep(1.5, 2.05, t);

    if (info) {
      const center = info.center;
      const normal = info.normal;
      // hesitation: pull back a touch before the plunge
      const back = Math.sin(saturate((t - 0.1) / 0.6) * Math.PI) * 0.12;
      const base = this.tmpV.copy(this.camPos);
      const target = this.tmpV2.copy(center).addScaledVector(normal, lerp(0.55, 0.02, lunge) + back);
      target.y = lerp(this.camPos.y, center.y, lunge * 0.6);
      this.camPos.lerpVectors(base, target, lunge);
      const toCenter = this.tmpV2.copy(center).sub(this.camPos);
      this.pitch = lerp(this.pitch, Math.atan2(toCenter.y, Math.hypot(toCenter.x, toCenter.z) + 0.001), lunge * 0.6);
      this.yaw = lerp(this.yaw, Math.atan2(-(center.x - this.camPos.x), -(center.z - this.camPos.z)), lunge * 0.6);
      this.roll = Math.sin(t * 3) * 0.03 * lunge + plunge * 0.2;
    }

    this.fov = lerp(FOV_GAME, 118, easeOutCubic(lunge)) + plunge * 24;
    const pulse = Math.exp(-Math.pow((t - 2.06) / 0.17, 2)) * 0.92;
    if (t > 1.5 && t < 2.6) this.flash = Math.max(this.flash, pulse);
    this.glitch = lerp(0.35, 1, lunge) * (t < 2.05 ? 1 : 0.2);
    this.warp = lunge * 0.35 + plunge * 0.6;
    this.radial = lunge * 0.6 + plunge * 1.2;
    this.chroma = 0.03 + lunge * 0.16;
    this.pixel = plunge * 0.35;
    this.shake = Math.max(this.shake, lunge * 0.8);
    this.applyCam();

    if (t > 2.05 && this.tunnelScene === null) {
      this.buildTunnel();
    }
    if (t > 2.05 && t < 3.9) {
      // fly through the tunnel
      const k = saturate((t - 2.05) / 1.85);
      const cam = this.tunnelCam!;
      this.renderScene = this.tunnelScene!;
      this.tunnelCamera = cam;
      cam.position.set(Math.sin(k * 6) * 0.35, Math.cos(k * 5) * 0.3, lerp(34, -46, easeOutCubic(k)));
      cam.rotation.set(0, 0, Math.sin(k * 8) * 0.06);
      cam.fov = lerp(96, 120, k);
      cam.aspect = this.camera.aspect;
      cam.updateProjectionMatrix();
      const tex = (this.tunnelScroll[0].material as THREE.MeshBasicMaterial).map!;
      tex.offset.y = (tex.offset.y - dt * 2.2) % 1;
      const tex2 = (this.tunnelScroll[1].material as THREE.MeshBasicMaterial).map!;
      tex2.offset.y = (tex2.offset.y - dt * 3.4) % 1;
      this.flash = Math.max(this.flash, Math.sin(k * Math.PI) * 0.35);
      this.glitch = 0.5 + Math.sin(k * 20) * 0.2;
      this.radial = 1.3;
      this.warp = 0.4;
    }
    if (t >= 3.85) {
      this.renderScene = null;
      this.tunnelCamera = null;
      this.flash = 1;
      this.enterWorld();
    }
  }

  private renderScene: THREE.Scene | null = null;
  private tunnelCamera: THREE.PerspectiveCamera | null = null;

  /* ---------------- world ---------------- */
  private updateWorld(dt: number) {
    this.seqT += dt;
    const rising = this.seqT < 1.3;
    this.player.enabled = this.seqT > 1.3 && !this.paused;
    this.player.eyeHeight = rising ? lerp(0.62, 1.62, smoothstep(0.05, 1.25, this.seqT)) : 1.62;
    if (rising) {
      this.pitch = lerp(this.pitch, -0.12, 1 - Math.exp(-2.2 * dt));
      this.player.pitch = this.pitch;
    }
    this.player.update(dt, this.input, this.surfaceWorld);
    this.player.applyToCamera(this.camera);
    this.camPos.copy(this.camera.position);
    this.yaw = this.player.yaw;
    this.pitch = this.player.pitch;
    this.roll = this.player.roll;
    this.fov = damp(this.fov, FOV_GAME, 4, dt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    if (this.seqT > 1.3 && this.wasRising) {
      this.wasRising = false;
      this.emitUI({ busy: false });
      this.input.requestLock();
    }
    if (this.seqT <= 1.3) this.wasRising = true;

    // discovery of WAKE_UP
    if (!this.found) {
      const near = this.player.eye.distanceTo(this.world.plaque) < 16;
      if (near) this.emitUI({ hint: "C コンソール" });
      if (this.world.checkWake(this.player.eye)) {
        this.found = true;
        this.emitUI({ found: true });
        this.setObjective("コンソールで「WAKE_UP」を実行する");
        this.say("WAKE_UP", "――脱出コマンド。世界の秘密。", 6);
        this.audio.play("reality_rift", { volume: 0.55 });
        this.audio.play("core_scanner", { volume: 0.4 });
        this.glitch = Math.max(this.glitch, 0.7);
        this.flash = 0.12;
        window.setTimeout(() => {
          if (this.phase === "world") this.emitUI({ hint: "C コンソール / Esc ポーズ" });
        }, 6500);
      }
    }
  }

  private wasRising = true;

  /* ---------------- collapse ---------------- */
  private updateCollapse(dt: number) {
    this.collapseT += dt;
    const t = this.collapseT;
    const p = this.player;

    // -------- world phase: look around, then the floor gives way --------
    if (t < 7.95) {
      const yawTarget =
        t < 0.55
          ? this.collapseBaseYaw
          : t < 1.15
            ? this.collapseBaseYaw + 0.95
            : t < 1.7
              ? this.collapseBaseYaw - 0.85
              : t < 2.5
                ? this.collapseBaseYaw - 0.2
                : this.collapseBaseYaw + 0.35;
      const pitchTarget = t < 0.5 ? 0 : t < 1.2 ? 0.08 : t < 2.0 ? -0.55 : -1.05;
      this.yawSpring.update(yawTarget, 30, 11, dt);
      this.pitchSpring.update(pitchTarget, 30, 11, dt);
      this.yaw = this.yawSpring.value;
      this.pitch = this.pitchSpring.value;

      // pre-shake, then the ground breaks
      const rumble = smoothstep(0.4, 3.0, t) * 0.5 + smoothstep(3.2, 3.7, t) * 1.4;
      this.shake = Math.max(this.shake, rumble * 0.5 + (t > 3.3 ? 0.4 : 0));

      const crack = smoothstep(2.4, 3.5, t);
      this.world.setCrack(crack);
      const holeR = smoothstep(3.35, 3.95, t) * 7.2;
      if (holeR > 0 && this.holeSpawned !== true) {
        this.holeSpawned = true;
        this.world.spawnDebris(90, new THREE.Vector3(p.eye.x, terrainHeight(p.eye.x, p.eye.z), p.eye.z), 6.5);
        this.audio.play("shatter", { volume: 0.8 });
        this.audio.play("sub_boom", { volume: 0.7 });
        this.audio.setBedGain("fall", 0.4, 1.2);
      }
      this.world.setHole(p.eye, holeR);

      if (t > 3.9) {
        // free fall through the hole
        this.fallV += 24 * dt;
        p.eye.y -= this.fallV * dt * 0.55;
        this.pitch = lerp(this.pitch, 0.35, 1 - Math.exp(-1.6 * dt));
        this.roll = lerp(this.roll, Math.sin(t * 2.1) * 0.12, 1 - Math.exp(-1.2 * dt));
        this.fov = lerp(this.fov, 92, 1 - Math.exp(-1.4 * dt));
        this.radial = smoothstep(3.9, 5.1, t) * 1.5;
        this.glitch = 0.15 + saturate(this.fallV / 70) * 0.4;
        this.chroma = 0.02 + saturate(this.fallV / 70) * 0.08;
        this.world.setCollapse(saturate((t - 3.9) / 3));
        if (t > 7.4) this.flash = saturate((t - 7.4) / 0.5) * 0.95;
      } else {
        this.fov = lerp(this.fov, 72 + crack * 8, 1 - Math.exp(-2 * dt));
      }
      this.camPos.copy(p.eye);
      this.applyCam();

      if (t > 7.35 && !this.crackedAudio) {
        this.crackedAudio = true;
        this.audio.play("glitch_stutter", { volume: 0.7 });
        this.audio.play("static_elec", { volume: 0.6 });
      }
      return;
    }

    // -------- room phase: fall into our own bedroom --------
    if (!this.roomFall) {
      this.roomFall = true;
      this.camPos.set(-0.34, 7.4, 0.42);
      this.pitch = -0.58;
      this.roll = 0;
      this.fallV = 1;
      this.fov = 86;
      this.room.setCeilingVisible(false);
      this.flash = 1;
      this.audio.play("wormhole_suck", { volume: 0.6 });
    }
    if (!this.landed) {
      this.fallV += 14 * dt;
      const y = this.camPos.y - this.fallV * dt;
      this.camPos.y = Math.max(y, 1.52);
      this.camPos.x = damp(this.camPos.x, -0.34, 3, dt);
      this.camPos.z = damp(this.camPos.z, 0.42, 3, dt);
      this.pitch = lerp(this.pitch, -0.62, 1 - Math.exp(-3 * dt));
      this.roll *= 0.98;
      this.yaw = damp(this.yaw, this.collapseBaseYaw + 0.25, 2, dt);
      this.fov = lerp(this.fov, 84, 1 - Math.exp(-2 * dt));
      this.radial = 1.4;
      this.glitch = 0.35;

      // crash through the ceiling
      if (!this.ceilingBurst && this.camPos.y < 3.2) {
        this.ceilingBurst = true;
        this.room.setCeilingVisible(true);
        this.room.burst(this.camPos.x, 2.9, this.camPos.z, 26);
        this.audio.play("shatter", { volume: 0.75 });
        this.flash = 0.55;
        this.shake = 0.9;
      }

      if (this.camPos.y <= 1.53 || t > 9.9) {
        this.landed = true;
        this.audio.play("land_impact", { volume: 0.95 });
        this.audio.play("sub_boom", { volume: 0.8 });
        this.audio.play("gasp", { volume: 0.5 });
        this.audio.setBedGain("fall", 0, 1.6);
        this.audio.play("breathing_panic", { volume: 0.5 });
        this.flash = 0.4;
        this.shake = 1.2;
        this.room.burst(this.camPos.x, 0.2, this.camPos.z, 16);
        this.camPos.y = 1.12;
        this.landingStart = t;
      }
      this.applyCam();
      return;
    }

    // -------- recovery --------
    const rt = t - this.landingStart;
    const rise = smoothstep(0.25, 2.3, rt);
    this.camPos.y = lerp(1.12, 1.62, rise);
    this.pitch = lerp(-0.62, 0.02, smoothstep(0.35, 2.4, rt));
    this.yaw = damp(this.yaw, this.collapseBaseYaw + 0.42, 1.6, dt);
    this.roll = lerp(this.roll, 0, 1 - Math.exp(-2 * dt));
    this.fov = lerp(this.fov, FOV_GAME, 1 - Math.exp(-2.5 * dt));
    this.radial = lerp(this.radial, 0, 1 - Math.exp(-4 * dt));
    this.glitch = lerp(this.glitch, 0.06, 1 - Math.exp(-3 * dt));
    this.chroma = lerp(this.chroma, 0.012, 1 - Math.exp(-3 * dt));
    this.applyCam();

    if (rt > 1.15 && !this.afterDone) {
      this.afterDone = true;
      this.room.applyAftermath();
      this.audio.play("aftermath_piano", { volume: 0.42 });
      this.audio.bed("room-tone", "room_tone", 0.24);
      this.audio.bed("clock", "clock_tick", 0.05, { rate: 0.9 });
      this.audio.bed("world", "bgm_glitch_world", 0.06, { rate: 0.72 });
      this.say("……戻ってきた。", "自分の部屋。02:47 のまま。", 5);
    }
    if (rt > 2.9 && !this.ended) {
      this.ended = true;
      this.player.reset(this.camPos.x, this.camPos.z, this.yaw, this.surfaceRoom);
      this.player.eye.y = 1.62;
      this.player.enabled = true;
      this.setPhase("aftermath");
      this.emitUI({
        busy: false,
        ended: true,
        hint: "WASD 移動 / E モニター / Esc メニュー",
        prompt: null,
      });
      this.setObjective("部屋を確かめる");
      window.setTimeout(() => {
        this.say("机の上のモニターが、まだ青い。", undefined, 4.6);
      }, 3200);
      window.setTimeout(() => {
        if (this.phase === "aftermath") this.setObjective("モニターに触れると、もう一度");
      }, 11000);
    }
  }

  private roomFall = false;
  private holeSpawned = false;
  private crackedAudio = false;
  private ceilingBurst = false;
  private landingStart = 0;
  private afterDone = false;

  /* ---------------- post ---------------- */
  private updatePost(dt: number) {
    const u = this.post.uniforms;
    u.uTime.value = this.clock;
    let exposure = 1.06;
    let bloom = 0.5;
    let grain = 0.03;
    let vignette = 0.58;
    let scan = 0.05;

    switch (this.phase) {
      case "focus":
        bloom = 0.65 + this.corruption * 0.5;
        grain = 0.035 + this.corruption * 0.05;
        vignette = 0.55 + this.corruption * 0.3;
        scan = 0.08;
        break;
      case "eaten":
        exposure = 1.15;
        bloom = 1.1;
        vignette = 0.8;
        break;
      case "world":
        exposure = 1.02;
        bloom = 0.95;
        grain = 0.045;
        vignette = 0.7;
        scan = 0.1;
        break;
      case "collapse":
        exposure = 1.1;
        bloom = 1.0;
        vignette = 0.85;
        break;
      case "aftermath":
        bloom = 0.6;
        vignette = 0.64;
        break;
      default:
        break;
    }

    const anomaly = this.phase === "world" ? this.world.anomalyLevel : 0;
    u.uExposure.value = exposure;
    u.uBloom.value = bloom;
    u.uGrain.value = grain;
    u.uVignette.value = vignette;
    u.uScan.value = scan;
    u.uGlitch.value = Math.max(this.glitch, this.phase === "world" ? anomaly * 0.35 : 0);
    u.uChroma.value = this.chroma + (this.phase === "world" ? anomaly * 0.05 : 0);
    u.uWarp.value = this.warp + (this.phase === "world" ? anomaly * 0.02 : 0);
    u.uRadial.value = this.radial;
    u.uPixel.value = this.pixel;
    u.uInside.value = this.inside;
    u.uFlash.value = this.flash;
    u.uDesat.value = 0;
    const tint = u.uTint.value as THREE.Color;
    if (this.phase === "world") tint.setRGB(0.94, 1.0, 1.08);
    else if (this.phase === "aftermath") tint.setRGB(0.96, 1.0, 1.06);
    else tint.setRGB(1, 1, 1);

    this.glitch = damp(this.glitch, 0, 3.5, dt);
    this.warp = damp(this.warp, 0, 3.5, dt);
    this.radial = damp(this.radial, 0, 4, dt);
    this.pixel = damp(this.pixel, 0, 4, dt);
    this.inside = 0;
  }

  private render() {
    let scene: THREE.Scene;
    let cam: THREE.Camera;
    if (this.renderScene) {
      scene = this.renderScene;
      cam = this.tunnelCamera ?? this.camera;
    } else if (this.phase === "world" || (this.phase === "collapse" && !this.roomFall)) {
      scene = this.world.scene;
      cam = this.camera;
    } else {
      scene = this.room.scene;
      cam = this.camera;
    }
    this.post.render(scene, cam);
  }

  /* ---------------- misc ---------------- */
  get pointerLocked() {
    return this.input.pointerLocked;
  }

  setTouchAxis(x: number, y: number) {
    this.input.touchAxis = { x, y };
  }

  touchInteract() {
    if (this.paused) return;
    if (this.phase === "focus") this.hitFace(0.12);
    else if (this.phase === "room" || this.phase === "aftermath") this.interact();
  }

  toggleConsole() {
    if (this.phase !== "world") return;
    if (this.isConsoleOpen) this.closeConsole();
    else this.openConsole();
  }

  get currentPhase() {
    return this.phase;
  }

  requestLock() {
    this.input.requestLock();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.input.dispose();
    this.audio.dispose();
    this.room.dispose();
    this.world.dispose();
    this.post.dispose();
    this.renderer.dispose();
  }
}

