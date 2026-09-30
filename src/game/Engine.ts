import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GameAudio } from './Audio';
import { createRoom, type Collider, type RoomModel } from './room';
import { createPassage, createWorld, groundHeight, MONUMENT, type PassageModel, type WorldModel } from './world';
import { initialSnapshot, isPlayable, type GamePreferences, type GameSnapshot, type Phase } from './types';
import { textTexture } from './textures';

const ROOM_START = new THREE.Vector3(-0.65, 1.65, 2.25);
const ROOM_YAW = -0.4;
const FOCUS_POSITION = new THREE.Vector3(1.53, 1.684, -1.36);
const WORLD_START = new THREE.Vector3(1.53, 1.65 + groundHeight(1.53, -23.5), -23.5);
const clamp = THREE.MathUtils.clamp;
const smooth = (value: number, from: number, to: number) => THREE.MathUtils.smoothstep(value, from, to);
const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

const atmosphereShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    amount: { value: 0 },
    grain: { value: 0.018 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float amount;
    uniform float grain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      float band = sin(uv.y * 47.0 + time * 3.0) * sin(uv.y * 18.0 - time * 2.0);
      uv.x += band * amount * 0.24;
      float shift = amount * 0.27;
      vec3 color;
      color.r = texture2D(tDiffuse, uv + vec2(shift, 0.0)).r;
      color.g = texture2D(tDiffuse, uv).g;
      color.b = texture2D(tDiffuse, uv - vec2(shift, 0.0)).b;
      float vignette = smoothstep(0.84, 0.2, length(vUv - 0.5));
      color *= mix(0.64, 1.0, vignette);
      color += (hash(vUv * vec2(1400.0, 900.0) + fract(time)) - 0.5) * grain;
      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `,
};

export interface CommandResult {
  lines: string[];
  error?: boolean;
  clear?: boolean;
}

type GazeKey = [time: number, yaw: number, pitch: number, roll: number];

export class GameEngine {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(59, 1, 0.045, 240);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly atmosphere: ShaderPass;
  private readonly room: RoomModel;
  private readonly world: WorldModel;
  private readonly passage: PassageModel;
  private readonly audio = new GameAudio();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly snapshot: GameSnapshot = { ...initialSnapshot };
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly temp = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly forcedRotation = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly transitionOrigin = new THREE.Vector3();
  private readonly transitionRotation = new THREE.Quaternion();
  private readonly savedRoomPosition = new THREE.Vector3();
  private readonly savedRoomRotation = new THREE.Quaternion();
  private readonly collapseOrigin = new THREE.Vector3();
  private readonly roomOffset = new THREE.Vector3();
  private readonly fallDecor = new THREE.Group();
  private readonly heroMouse = new THREE.Vector2();
  private preferences: GamePreferences;
  private phaseTime = 0;
  private time = 0;
  private lastFrame = 0;
  private lastEmission = 0;
  private lastSnapshot = '';
  private messageUntil = 0;
  private yaw = ROOM_YAW;
  private pitch = 0;
  private targetYaw = ROOM_YAW;
  private targetPitch = 0;
  private yawVelocity = 0;
  private pitchVelocity = 0;
  private collapseYaw = 0;
  private collapsePitch = 0;
  private distanceWalked = 0;
  private lastStep = 0;
  private holdingFace = false;
  private dragLook = false;
  private dragX = 0;
  private dragY = 0;
  private suppressUnlock = false;
  private destroyed = false;
  private landed = false;
  private crackPlayed = false;
  private glitchImpulse = 0;
  private swallowCurve: THREE.CatmullRomCurve3 | null = null;
  private focusWasReturned = false;
  private readonly touchDevice = window.matchMedia('(pointer: coarse)').matches;
  private readonly onUpdate: (snapshot: GameSnapshot) => void;
  private readonly onError: (message: string) => void;

  constructor(
    container: HTMLDivElement,
    preferences: GamePreferences,
    onUpdate: (snapshot: GameSnapshot) => void,
    onError: (message: string) => void,
  ) {
    this.preferences = preferences;
    this.onUpdate = onUpdate;
    this.onError = onError;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '一人称ホラー体験の3D画面。WASDで移動、マウスで視点操作。');
    this.renderer.domElement.tabIndex = -1;
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#070e18');
    this.scene.fog = new THREE.FogExp2('#080f1b', 0.026);
    this.camera.rotation.order = 'YXZ';
    this.room = createRoom();
    this.world = createWorld();
    this.passage = createPassage();
    this.scene.add(this.room.group, this.world.group, this.passage.group, this.fallDecor);
    this.fallDecor.visible = false;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.68, 0.65);
    this.composer.addPass(this.bloom);
    this.atmosphere = new ShaderPass(atmosphereShader);
    this.composer.addPass(this.atmosphere);
    this.composer.addPass(new OutputPass());
    this.resize();
    this.setPreferences(preferences);
    this.titleCamera();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('contextmenu', this.preventContextMenu);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.setAnimationLoop(this.frame);
    this.emit(true);
  }

  private resize = () => {
    if (this.destroyed) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = this.preferences.quality === 'low' ? 1 : Math.min(window.devicePixelRatio, this.touchDevice ? 1.25 : 1.6);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height);
    this.composer?.setPixelRatio(ratio);
    this.composer?.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  setPreferences(preferences: GamePreferences) {
    this.preferences = preferences;
    this.audio.setVolume(preferences.volume, preferences.muted);
    this.renderer.shadowMap.enabled = preferences.quality === 'high';
    this.bloom.enabled = preferences.quality === 'high';
    this.atmosphere.uniforms.grain.value = preferences.gentle ? 0.01 : 0.018;
    this.resize();
  }

  start() {
    if (this.snapshot.phase !== 'title') return;
    void this.audio.start();
    this.audio.setPaused(false);
    this.audio.setScene('room');
    this.room.setDesktop(true);
    this.transitionOrigin.copy(this.camera.position);
    this.transitionRotation.copy(this.camera.quaternion);
    this.changePhase('entering');
    this.requestPointer();
  }

  restart() {
    this.reset();
    this.start();
  }

  toTitle() {
    this.reset();
    this.audio.setPaused(true);
  }

  private reset() {
    this.releasePointer();
    Object.assign(this.snapshot, initialSnapshot);
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.room.reset();
    this.world.reset();
    this.room.group.visible = true;
    this.world.group.visible = false;
    this.passage.group.visible = false;
    this.fallDecor.visible = false;
    this.roomOffset.set(0, 0, 0);
    this.phaseTime = 0;
    this.messageUntil = 0;
    this.holdingFace = false;
    this.glitchImpulse = 0;
    this.yaw = this.targetYaw = ROOM_YAW;
    this.pitch = this.targetPitch = 0;
    this.yawVelocity = this.pitchVelocity = 0;
    this.camera.fov = 59;
    this.setRoomAtmosphere();
    this.titleCamera();
    this.camera.updateProjectionMatrix();
    this.emit(true);
  }

  pause() {
    if (this.snapshot.phase === 'title' || this.snapshot.paused) return;
    this.snapshot.paused = true;
    this.holdingFace = false;
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.audio.setPaused(true);
    this.releasePointer();
    this.emit(true);
  }

  resume() {
    if (!this.snapshot.paused) return;
    this.snapshot.paused = false;
    this.audio.setPaused(false);
    void this.audio.start();
    if (isPlayable(this.snapshot.phase)) this.requestPointer();
    this.emit(true);
  }

  requestPointer() {
    if (this.touchDevice || this.snapshot.consoleOpen || this.snapshot.paused || this.destroyed) return;
    const element = this.renderer.domElement;
    if (document.pointerLockElement === element) return;
    try {
      const request = element.requestPointerLock?.();
      if (request && typeof request.catch === 'function') request.catch(() => this.onPointerLockError());
    } catch {
      this.onPointerLockError();
    }
  }

  private releasePointer() {
    this.dragLook = false;
    if (document.pointerLockElement === this.renderer.domElement) {
      this.suppressUnlock = true;
      document.exitPointerLock();
    }
  }

  private onPointerLockChange = () => {
    this.snapshot.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    if (!this.snapshot.pointerLocked) {
      if (!this.suppressUnlock && isPlayable(this.snapshot.phase) && !this.snapshot.consoleOpen && !this.snapshot.paused) this.pause();
      this.suppressUnlock = false;
    }
    this.emit(true);
  };

  private onPointerLockError = () => {
    this.snapshot.pointerLocked = false;
    this.emit(true);
  };

  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.pause();
    this.onError('3D画面との接続が切れました。再接続して、もう一度お試しください。');
  };

  private onBlur = () => {
    this.keys.clear();
    this.holdingFace = false;
    if (this.snapshot.phase !== 'title' && !this.snapshot.consoleOpen) this.pause();
  };

  private onVisibility = () => {
    if (document.hidden) this.onBlur();
    this.lastFrame = 0;
  };

  private preventContextMenu = (event: Event) => event.preventDefault();

  setKey(key: string, pressed: boolean) {
    if (pressed) this.keys.add(key);
    else this.keys.delete(key);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const element = event.target as HTMLElement;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element?.isContentEditable) return;
    if (event.code === 'Escape') {
      if (this.snapshot.consoleOpen) this.closeConsole();
      else if (this.snapshot.paused) this.resume();
      else if (this.snapshot.phase === 'focus' || this.snapshot.phase === 'approach') this.leaveMonitor();
      else if (isPlayable(this.snapshot.phase)) this.pause();
      return;
    }
    if (this.snapshot.paused || this.snapshot.consoleOpen || this.snapshot.phase === 'title') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    if (event.code === 'KeyE' && !event.repeat) this.interact();
    if (event.code === 'KeyC' && !event.repeat && this.snapshot.phase === 'world') this.openConsole();
    if ((event.code === 'Space' || event.code === 'Enter') && this.snapshot.phase === 'focus') {
      if (!event.repeat) this.touchFace();
      this.holdingFace = true;
      return;
    }
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
    if (event.code === 'Space' || event.code === 'Enter') this.holdingFace = false;
  };

  private updateFaceHover(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.room.screen, false)[0];
    this.snapshot.faceHovered = !!hit?.uv && hit.uv.x > 0.035 && hit.uv.x < 0.22 && hit.uv.y > 0.67 && hit.uv.y < 0.94;
    this.renderer.domElement.style.cursor = this.snapshot.faceHovered ? 'pointer' : 'default';
    return this.snapshot.faceHovered;
  }

  private onPointerMove = (event: PointerEvent) => {
    if (this.snapshot.phase === 'title') {
      this.heroMouse.set(event.clientX / window.innerWidth - 0.5, event.clientY / window.innerHeight - 0.5);
      return;
    }
    if (this.snapshot.paused || this.snapshot.consoleOpen) return;
    if (this.snapshot.phase === 'focus') {
      if (event.pointerType !== 'touch') this.updateFaceHover(event.clientX, event.clientY);
      return;
    }
    if (!isPlayable(this.snapshot.phase)) return;
    if (this.snapshot.pointerLocked) {
      this.look(event.movementX, event.movementY);
    } else if (this.dragLook) {
      this.look(event.clientX - this.dragX, event.clientY - this.dragY);
      this.dragX = event.clientX;
      this.dragY = event.clientY;
    }
  };

  private look(x: number, y: number) {
    this.targetYaw -= clamp(x, -150, 150) * 0.0021;
    this.targetPitch = clamp(this.targetPitch - clamp(y, -150, 150) * 0.0019, -1.42, 1.42);
  }

  private onPointerDown = (event: PointerEvent) => {
    if (this.snapshot.paused || this.snapshot.consoleOpen || event.button !== 0) return;
    if (this.snapshot.phase === 'focus') {
      if (this.updateFaceHover(event.clientX, event.clientY)) {
        this.touchFace();
        this.holdingFace = true;
        this.renderer.domElement.setPointerCapture(event.pointerId);
      }
      return;
    }
    if (!isPlayable(this.snapshot.phase)) return;
    if (this.snapshot.pointerLocked && this.snapshot.nearPC) {
      this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
      if (this.raycaster.intersectObject(this.room.screen, false).length) this.interact();
      return;
    }
    this.dragLook = true;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    if (event.pointerType !== 'touch') this.requestPointer();
  };

  private onPointerUp = () => {
    this.holdingFace = false;
    this.dragLook = false;
  };

  interact() {
    if (this.snapshot.paused || this.snapshot.consoleOpen) return;
    if (this.snapshot.phase === 'focus') {
      this.leaveMonitor();
      return;
    }
    if ((this.snapshot.phase === 'room' || this.snapshot.phase === 'returned') && this.snapshot.nearPC) {
      this.focusWasReturned = this.snapshot.phase === 'returned';
      this.savedRoomPosition.copy(this.camera.position);
      this.savedRoomRotation.copy(this.camera.quaternion);
      this.transitionOrigin.copy(this.camera.position);
      this.transitionRotation.copy(this.camera.quaternion);
      this.room.setDesktop(false);
      this.snapshot.progress = 0;
      this.snapshot.faceHovered = false;
      this.changePhase('approach');
      this.releasePointer();
      this.keys.clear();
      this.velocity.set(0, 0, 0);
      this.audio.tone(640, 0.13, 0.07, 280);
    }
  }

  private leaveMonitor() {
    this.holdingFace = false;
    this.snapshot.progress = 0;
    this.snapshot.faceHovered = false;
    this.room.group.rotation.set(0, 0, 0);
    this.room.screen.visible = true;
    this.room.fragments.visible = false;
    this.camera.position.copy(this.savedRoomPosition);
    this.camera.quaternion.copy(this.savedRoomRotation);
    this.forcedRotation.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = this.targetYaw = this.forcedRotation.y;
    this.pitch = this.targetPitch = this.forcedRotation.x;
    this.camera.fov = 59;
    this.camera.updateProjectionMatrix();
    this.room.setDesktop(!this.focusWasReturned);
    this.changePhase(this.focusWasReturned ? 'returned' : 'room');
    this.renderer.domElement.style.cursor = 'default';
    this.requestPointer();
  }

  private touchFace() {
    this.snapshot.progress = Math.min(1, this.snapshot.progress + 0.14);
    this.audio.tone(120 + this.snapshot.progress * 120, 0.2, 0.06, 47);
    this.audio.noise(0.11, 0.04, 2000);
  }

  openConsole() {
    if (this.snapshot.phase !== 'world' || this.snapshot.paused) return;
    this.snapshot.consoleOpen = true;
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.releasePointer();
    this.audio.tone(880, 0.06, 0.05);
    this.emit(true);
  }

  closeConsole() {
    if (!this.snapshot.consoleOpen) return;
    this.snapshot.consoleOpen = false;
    this.keys.clear();
    this.requestPointer();
    this.emit(true);
  }

  executeCommand(input: string): CommandResult {
    if (this.snapshot.phase !== 'world' || !this.snapshot.consoleOpen) return { lines: [] };
    const command = input.trim().toUpperCase();
    if (!command) return { lines: [] };
    if (command === 'HELP') return { lines: ['AVAILABLE: HELP / STATUS / CLEAR / EXIT', '復元ルーチンは、この空間のどこかに保存されている。'] };
    if (command === 'STATUS') return { lines: ['SESSION: 0317 / SUBJECT: CONNECTED', `MEMORY: ${this.snapshot.discovered ? 'RECOVERY_SIGNATURE_FOUND' : 'RECOVERY_SIGNATURE_MISSING'}`, '現実との接続を検索中...'] };
    if (command === 'CLEAR') return { lines: [], clear: true };
    if (command === 'EXIT') {
      this.closeConsole();
      return { lines: ['TERMINAL CLOSED.'] };
    }
    if (command === 'WAKE_UP') {
      this.snapshot.consoleOpen = false;
      this.requestPointer();
      this.beginCollapse();
      return { lines: ['RESTORE ACCEPTED. RELEASING REALITY...'] };
    }
    this.audio.tone(158, 0.19, 0.085, 91);
    this.glitchImpulse = 0.011;
    return { lines: [`ERR_UNKNOWN_ROUTINE: ${input.trim().slice(0, 80)}`, '応答がない。ここに記された言葉を思い出せ。'], error: true };
  }

  private beginSwallow() {
    this.holdingFace = false;
    this.transitionOrigin.copy(this.camera.position);
    this.swallowCurve = new THREE.CatmullRomCurve3([
      this.camera.position.clone(),
      new THREE.Vector3(1.53, 1.684, -2.72),
      new THREE.Vector3(1.53, 1.64, -5.5),
      new THREE.Vector3(1.53, 1.64, -12.3),
      WORLD_START.clone(),
    ]);
    this.keys.clear();
    this.snapshot.message = '';
    this.passage.group.visible = true;
    this.world.reset();
    this.audio.tone(130, 3.9, 0.25, 25);
    this.audio.noise(2.1, 0.11, 750);
    this.changePhase('swallow');
  }

  private buildFallDecor() {
    this.fallDecor.children.forEach((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        mats.forEach((mat) => mat.dispose());
      }
    });
    this.fallDecor.clear();
    this.fallDecor.position.set(this.collapseOrigin.x, 0, this.collapseOrigin.z);
    for (let i = 0; i < 12; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4.3 + Math.sin(i * 2.3) * 0.7, 0.013, 4, 56, Math.PI * 1.6), new THREE.MeshBasicMaterial({
        color: '#588fff', transparent: true, opacity: 0.23,
      }));
      ring.position.y = -5 - i * 6.1;
      ring.rotation.set(Math.PI / 2, 0, i * 0.8);
      this.fallDecor.add(ring);
      if (i % 2 === 0) {
        const label = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.5), new THREE.MeshBasicMaterial({
          map: textTexture(['DISCONNECTING...'], { width: 900, height: 160, size: 49 }),
          transparent: true, opacity: 0.45, side: THREE.DoubleSide,
        }));
        label.position.set(i % 4 ? 4.4 : -4.4, -5 - i * 6.1, -1);
        label.rotation.y = i % 4 ? -0.5 : 0.5;
        this.fallDecor.add(label);
      }
    }
  }

  private beginCollapse() {
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.collapseOrigin.copy(this.camera.position);
    this.collapseYaw = this.yaw;
    this.collapsePitch = this.pitch;
    this.yawVelocity = this.pitchVelocity = 0;
    this.landed = this.crackPlayed = false;
    this.world.beginCollapse(this.collapseOrigin);
    this.room.reset();
    this.roomOffset.set(this.collapseOrigin.x - ROOM_START.x, -80, this.collapseOrigin.z - ROOM_START.z);
    this.room.group.position.copy(this.roomOffset);
    this.room.ceiling.visible = false;
    this.room.group.visible = false;
    this.buildFallDecor();
    this.audio.tone(880, 0.27, 0.09, 55);
    this.message('復元処理が始まった。', 1.5);
    this.changePhase('collapse');
  }

  private changePhase(phase: Phase) {
    this.snapshot.phase = phase;
    this.phaseTime = 0;
    this.emit(true);
  }

  private message(text: string, seconds = 5) {
    this.snapshot.message = text;
    this.messageUntil = this.time + seconds;
    this.emit(true);
  }

  private emit(force = false) {
    if (!force && this.time - this.lastEmission < 0.1) return;
    this.lastEmission = this.time;
    const serialized = JSON.stringify(this.snapshot);
    if (serialized === this.lastSnapshot) return;
    this.lastSnapshot = serialized;
    this.onUpdate({ ...this.snapshot });
  }

  private titleCamera() {
    const portrait = window.innerWidth / window.innerHeight < 1;
    const motion = this.preferences.gentle ? 0 : 1;
    this.camera.position.set(0.03 + this.heroMouse.x * 0.1 * motion, 1.88 + Math.sin(this.time * 0.33) * 0.012 * motion, 3.65);
    this.camera.lookAt(portrait ? 1.35 : -0.46, 1.35 + this.heroMouse.y * 0.035 * motion, -2.86);
  }

  private setRoomAtmosphere() {
    (this.scene.background as THREE.Color).set('#070e18');
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set('#080f1b');
    fog.density = 0.026;
    this.bloom.strength = 0.35;
  }

  private validPosition(x: number, z: number, colliders: Collider[]) {
    const radius = 0.19;
    return !colliders.some((c) => x > c.minX - radius && x < c.maxX + radius && z > c.minZ - radius && z < c.maxZ + radius);
  }

  private movePlayer(dt: number) {
    if (this.snapshot.paused || this.snapshot.consoleOpen) return;
    const world = this.snapshot.phase === 'world';
    const forwardInput = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const sideInput = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const moving = forwardInput !== 0 || sideInput !== 0;
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = world ? (sprint ? 6.3 : 3.8) : sprint ? 3.3 : 2.25;
    this.temp.set(sideInput, 0, -forwardInput);
    if (moving) this.temp.normalize().multiplyScalar(speed).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
    this.velocity.lerp(this.temp, 1 - Math.exp(-dt * 10));
    const colliderList = world ? [
      { minX: MONUMENT.x - 3.8, maxX: MONUMENT.x - 2.59, minZ: -68.3, maxZ: -65.7 },
      { minX: MONUMENT.x + 2.59, maxX: MONUMENT.x + 3.8, minZ: -68.3, maxZ: -65.7 },
      { minX: MONUMENT.x - 2.45, maxX: MONUMENT.x + 2.45, minZ: -67.94, maxZ: -67.31 },
    ] : this.room.colliders;
    const nextX = clamp(this.camera.position.x + this.velocity.x * dt, world ? -30.3 : -4.17, world ? 33.3 : 4.17);
    const nextZ = clamp(this.camera.position.z + this.velocity.z * dt, world ? -104.9 : -3.77, world ? -20.85 : 3.77);
    if (this.validPosition(nextX, this.camera.position.z, colliderList)) this.camera.position.x = nextX;
    else this.velocity.x = 0;
    if (this.validPosition(this.camera.position.x, nextZ, colliderList)) this.camera.position.z = nextZ;
    else this.velocity.z = 0;
    this.yaw += angleDifference(this.targetYaw, this.yaw) * (1 - Math.exp(-dt * 21));
    this.pitch = THREE.MathUtils.lerp(this.pitch, this.targetPitch, 1 - Math.exp(-dt * 21));
    const traveled = this.velocity.length() * dt;
    this.distanceWalked += traveled;
    let floorHeight = world ? groundHeight(this.camera.position.x, this.camera.position.z) : 0;
    if (world && Math.abs(this.camera.position.x - MONUMENT.x) < 4.5 && Math.abs(this.camera.position.z + 67) < 2.9) floorHeight = 0.455;
    const bob = this.preferences.gentle ? 0 : Math.sin(this.distanceWalked * 9) * Math.min(this.velocity.length() / 3, 1) * 0.024;
    const breath = this.preferences.gentle ? 0 : Math.sin(this.time * 1.35) * 0.004;
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, floorHeight + 1.65 + bob + breath, 1 - Math.exp(-dt * 13));
    this.camera.rotation.set(this.pitch, this.yaw, this.preferences.gentle ? 0 : Math.sin(this.distanceWalked * 4.5) * Number(moving) * 0.003, 'YXZ');
    if (moving && traveled > 0.004 && this.distanceWalked - this.lastStep > (world ? 1.43 : 1.12)) {
      this.audio.step(world);
      this.lastStep = this.distanceWalked;
    }
    const targetFov = world ? (sprint && moving ? 68 : 63) : 59;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, dt * 4);
    this.camera.updateProjectionMatrix();
  }

  private updateRoomHint() {
    this.camera.getWorldDirection(this.forward);
    this.temp.set(1.53 - this.camera.position.x, 0, -2.898 - this.camera.position.z);
    const distance = this.temp.length();
    this.temp.normalize();
    this.snapshot.nearPC = distance < 2.6 && this.temp.dot(this.forward) > 0.28;
  }

  private approachMonitor() {
    const amount = smooth(this.phaseTime, 0, 1.6);
    this.camera.position.lerpVectors(this.transitionOrigin, FOCUS_POSITION, amount);
    const focusRotation = new THREE.Quaternion();
    this.forcedRotation.set(0, 0, 0, 'YXZ');
    focusRotation.setFromEuler(this.forcedRotation);
    this.camera.quaternion.slerpQuaternions(this.transitionRotation, focusRotation, amount);
    this.camera.fov = THREE.MathUtils.lerp(59, 51, amount);
    this.camera.updateProjectionMatrix();
    if (this.phaseTime >= 1.6) this.changePhase('focus');
  }

  private swallow() {
    const t = this.phaseTime;
    const progress = smooth(t, 1.4, 9.8);
    const growth = smooth(t, 0.2, 3.6);
    this.passage.update(this.time, growth, this.preferences.gentle);
    this.world.group.visible = t > 1.6;
    this.room.screen.visible = t < 1.4;
    this.room.backWall.visible = t < 2.9;
    this.room.group.rotation.z = this.preferences.gentle ? 0 : Math.sin(t * 1.1) * growth * 0.033;
    this.camera.position.copy(this.swallowCurve!.getPointAt(progress));
    const ahead = this.swallowCurve!.getPointAt(Math.min(progress + 0.016, 1));
    if (progress < 0.998) this.camera.lookAt(ahead);
    this.camera.rotation.z += this.preferences.gentle ? 0 : Math.sin(t * 1.5) * Math.sin(progress * Math.PI) * 0.033;
    this.camera.fov = 51 + Math.sin(progress * Math.PI) * (this.preferences.gentle ? 10 : 28) + progress * 12;
    this.camera.updateProjectionMatrix();
    if (this.camera.position.z < -4.3) this.room.group.visible = false;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.lerpColors(new THREE.Color('#080f1b'), new THREE.Color('#08275c'), growth);
    fog.density = 0.026 - growth * 0.012;
    (this.scene.background as THREE.Color).lerpColors(new THREE.Color('#070e18'), new THREE.Color('#082456'), growth);
    this.atmosphere.uniforms.amount.value = this.preferences.gentle ? 0.002 : Math.sin(progress * Math.PI) * 0.022;
    this.bloom.strength = 0.35 + Math.sin(progress * Math.PI) * 0.22;
    if (t >= 9.85) {
      this.room.group.visible = false;
      this.passage.group.visible = false;
      this.camera.position.copy(WORLD_START);
      this.yaw = this.targetYaw = 0;
      this.pitch = this.targetPitch = -0.025;
      this.camera.rotation.set(this.pitch, 0, 0, 'YXZ');
      this.snapshot.nearPC = false;
      this.snapshot.progress = 0;
      this.snapshot.faceHovered = false;
      this.audio.setScene('world');
      this.renderer.domElement.style.cursor = 'default';
      this.changePhase('world');
      this.message('ここは、画面の裏側だ。', 5);
    }
  }

  private gazeAt(keys: GazeKey[], elapsed: number, dt: number) {
    let a = keys[0];
    let b = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (elapsed >= keys[i][0] && elapsed < keys[i + 1][0]) {
        a = keys[i];
        b = keys[i + 1];
        break;
      }
    }
    if (elapsed >= keys[keys.length - 1][0]) a = b;
    const fraction = a === b ? 1 : smooth(elapsed, a[0], b[0]);
    const yaw = THREE.MathUtils.lerp(a[1], b[1], fraction);
    const pitch = THREE.MathUtils.lerp(a[2], b[2], fraction);
    const roll = THREE.MathUtils.lerp(a[3], b[3], fraction);
    // A damped head, rather than fixed-speed camera rotations, gives the gaze weight and hesitation.
    this.yawVelocity += (angleDifference(yaw, this.yaw) * 54 - this.yawVelocity * 12) * dt;
    this.pitchVelocity += ((pitch - this.pitch) * 60 - this.pitchVelocity * 13) * dt;
    this.yaw += this.yawVelocity * dt;
    this.pitch += this.pitchVelocity * dt;
    this.camera.rotation.set(this.pitch, this.yaw, this.preferences.gentle ? roll * 0.2 : roll, 'YXZ');
  }

  private collapse(dt: number) {
    const t = this.phaseTime;
    const y = this.collapseYaw;
    const finalYaw = y + angleDifference(ROOM_YAW, y);
    const panic = this.preferences.gentle ? 0.65 : 1;
    const keys: GazeKey[] = [
      [0, y, this.collapsePitch, 0],
      [0.34, y + 0.05, -0.04, -0.006],
      [0.78, y + 0.63 * panic, 0.07, -0.03],
      [1.13, y + 0.58 * panic, 0.04, -0.02],
      [1.74, y - 0.72 * panic, -0.02, 0.035],
      [2.14, y - 0.68 * panic, -0.13, 0.015],
      [2.77, y - 0.07, -1.02, -0.017],
      [3.17, y + 0.29, -1.14, 0.016],
      [3.48, y + 0.24, -0.91, 0.009],
      [4.2, y - 0.19, -1.36, -0.026],
      [4.78, y - 0.09, -1.3, -0.018],
      [5.32, y + 0.2, -0.45, 0.045],
      [6.14, y + 0.35, 0.93, -0.023],
      [6.58, y + 0.28, 0.98, -0.01],
      [7.25, finalYaw + 0.18, -1.25, 0.033],
      [8.68, finalYaw, -0.96, -0.015],
      [9.4, finalYaw, -0.64, 0.025],
      [10.53, finalYaw, -0.012, 0],
    ];
    this.gazeAt(keys, t, dt);
    this.camera.position.x = this.collapseOrigin.x + Math.sin(t * 0.73) * 0.028 * panic;
    this.camera.position.z = this.collapseOrigin.z + Math.sin(t * 0.58) * 0.03 * panic;
    const fallTime = Math.max(0, t - 4.8);
    const landingY = this.roomOffset.y + 1.65;
    const fallingY = this.collapseOrigin.y - fallTime * fallTime * 4;
    if (fallingY > landingY) {
      this.camera.position.y = fallingY + (t < 4.8 ? Math.sin(t * 1.8) * 0.011 : 0);
    } else {
      if (!this.landed) {
        this.landed = true;
        this.audio.land();
        this.audio.setScene('room');
      }
      const impactTime = t - (4.8 + Math.sqrt((this.collapseOrigin.y - landingY) / 4));
      this.camera.position.y = landingY - Math.sin(Math.min(impactTime / 0.8, 1) * Math.PI) * 0.34 * Math.exp(-impactTime * 1.2);
    }
    if (t > 2.24 && !this.crackPlayed) {
      this.crackPlayed = true;
      this.audio.crack();
    }
    if (t > 4.8 && !this.landed) this.audio.setScene('fall');
    this.world.collapse(t, this.collapseOrigin);
    this.room.group.visible = t > 6.1;
    this.fallDecor.visible = t > 4.5 && t < 10.4;
    this.camera.fov = 63 + smooth(t, 4.8, 7.9) * (this.preferences.gentle ? 6 : 16) - smooth(t, 9.1, 10.65) * (this.preferences.gentle ? 10 : 20);
    this.camera.updateProjectionMatrix();
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = 0.014 - smooth(t, 4.4, 6.4) * 0.009 + smooth(t, 8.65, 10.65) * 0.021;
    fog.color.lerpColors(new THREE.Color('#08275c'), new THREE.Color('#080f1b'), smooth(t, 7.9, 10.1));
    (this.scene.background as THREE.Color).lerpColors(new THREE.Color('#082456'), new THREE.Color('#070e18'), smooth(t, 7.5, 10.4));
    this.atmosphere.uniforms.amount.value = this.preferences.gentle ? 0 : 0.008 * (1 - smooth(t, 8.8, 10.2));
    if (t >= 10.95) {
      // Rebase only after landing. The visible room and camera keep precisely the same relative pose.
      this.camera.position.sub(this.roomOffset);
      this.camera.position.x = ROOM_START.x;
      this.camera.position.z = ROOM_START.z;
      this.room.group.position.set(0, 0, 0);
      this.room.ceiling.visible = true;
      this.world.group.visible = false;
      this.fallDecor.visible = false;
      this.yaw = this.targetYaw = ROOM_YAW;
      this.pitch = this.targetPitch = -0.012;
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      this.keys.clear();
      this.velocity.set(0, 0, 0);
      this.snapshot.paused = false;
      this.snapshot.consoleOpen = false;
      this.audio.setPaused(false);
      this.audio.setScene('room');
      this.setRoomAtmosphere();
      this.changePhase('returned');
      this.message('自室だ。...本当に？', 7);
    }
  }

  private frame = (now: number) => {
    if (this.destroyed) return;
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.04) : 1 / 60;
    this.lastFrame = now;
    if (document.hidden) return;
    this.time += dt;
    if (this.snapshot.message && this.time > this.messageUntil) this.snapshot.message = '';
    const active = !this.snapshot.paused && !this.snapshot.consoleOpen;
    if (active) this.phaseTime += dt;
    this.glitchImpulse *= Math.exp(-dt * 4);
    this.atmosphere.uniforms.time.value = this.time;
    this.atmosphere.uniforms.amount.value = this.preferences.gentle ? 0 : this.glitchImpulse;
    const phase = this.snapshot.phase;
    const corruption = phase === 'focus' ? this.snapshot.progress : phase === 'swallow' ? Math.min(1, 0.6 + this.phaseTime * 0.15) : 0;
    const returning = phase === 'returned' || phase === 'collapse';
    this.room.update(this.time, corruption, returning);
    if (this.world.group.visible) this.world.update(this.time, this.camera.position, this.preferences.gentle);
    if (phase === 'title') this.titleCamera();
    else if (phase === 'entering' && active) {
      const progress = smooth(this.phaseTime, 0, 1.6);
      this.camera.position.lerpVectors(this.transitionOrigin, ROOM_START, progress);
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ROOM_YAW, 0, 'YXZ'));
      this.camera.quaternion.slerpQuaternions(this.transitionRotation, rotation, progress);
      if (this.phaseTime >= 1.6) {
        this.yaw = this.targetYaw = ROOM_YAW;
        this.pitch = this.targetPitch = 0;
        this.changePhase('room');
        this.message('雨音だけが、いつもと同じだった。', 5);
      }
    } else if (isPlayable(phase)) {
      this.movePlayer(dt);
      if (phase === 'world') {
        const distance = Math.hypot(this.camera.position.x - MONUMENT.x, this.camera.position.z - MONUMENT.z);
        if (distance < 9 && this.camera.position.z > -66.5 && !this.snapshot.discovered) {
          this.snapshot.discovered = true;
          this.audio.tone(420, 0.8, 0.06, 280);
          this.message('刻まれた文字。これは、命令なのか。', 6);
        }
        const anomaly = this.phaseTime % 21;
        if (anomaly > 17 && anomaly < 17.6 && !this.preferences.gentle) {
          this.atmosphere.uniforms.amount.value = Math.sin((anomaly - 17) / 0.6 * Math.PI) * 0.007;
        }
      } else this.updateRoomHint();
    } else if (phase === 'approach' && active) this.approachMonitor();
    else if (phase === 'focus' && active) {
      if (this.holdingFace) this.snapshot.progress = Math.min(1, this.snapshot.progress + dt * 0.24);
      this.atmosphere.uniforms.amount.value = this.preferences.gentle ? 0 : this.snapshot.progress * 0.012;
      this.room.group.rotation.z = this.preferences.gentle ? 0 : Math.sin(this.time * 1.6) * this.snapshot.progress * 0.005;
      this.audio.update(this.time, this.snapshot.progress);
      if (this.snapshot.progress >= 1) this.beginSwallow();
    } else if (phase === 'swallow' && active) this.swallow();
    else if (phase === 'collapse' && active) this.collapse(dt);
    if (phase !== 'focus') this.audio.update(this.time, phase === 'collapse' ? 0.9 : phase === 'swallow' ? 0.7 : 0);
    this.emit();
    this.composer.render(dt);
  };

  dispose() {
    this.destroyed = true;
    this.renderer.setAnimationLoop(null);
    this.releasePointer();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.audio.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat) => {
          materials.add(mat);
          Object.values(mat).forEach((value) => {
            if (value instanceof THREE.Texture) textures.add(value);
          });
        });
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((mat) => mat.dispose());
    textures.forEach((texture) => texture.dispose());
    this.composer.passes.forEach((pass) => pass.dispose());
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}