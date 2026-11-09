import * as THREE from "three";
import type { Assets } from "./assets";
import {
  BsodScreen,
  makeClockFaceTexture,
  makeGlowTexture,
  makeMatGlyph,
  makePosterTexture,
  makeStickerTexture,
  makeWindowGlowTexture,
} from "./canvas";
import { screenFrag, screenVert } from "./shaders";
import type { FirstPerson } from "./player";
import type { Interactable } from "./types";
import { Rng, TAU, clamp, damp, hash2, lerp, saturate, smoothstep } from "./util";

interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const FLOOR_Y = 0.02;

export class RoomScene {
  readonly scene = new THREE.Scene();
  readonly screen = new BsodScreen(1280, 720);
  readonly interactables: Interactable[] = [];
  readonly boot = new THREE.Vector3(1.35, FLOOR_Y + 1.62, 1.05);
  readonly bootYaw = 1.24;

  private screenMesh: THREE.Mesh | null = null;
  private screenMat!: THREE.ShaderMaterial;
  private screenGlow!: THREE.Sprite;
  private monitorLight!: THREE.PointLight;
  private moon!: THREE.DirectionalLight;
  private ambient!: THREE.HemisphereLight;
  private fillLight!: THREE.PointLight;
  private shards: { mesh: THREE.Mesh; base: THREE.Vector3; normal: THREE.Vector3; threshold: number; rot: THREE.Vector3; spin: number }[] = [];
  private mouth!: THREE.Mesh;
  private mouthMat!: THREE.MeshBasicMaterial;
  private roomRoot = new THREE.Group();
  private deskRoot = new THREE.Group();
  private chair!: THREE.Object3D;
  private aftermathGroup = new THREE.Group();
  private rain!: THREE.LineSegments;
  private rainPositions!: Float32Array;
  private lightning = 0;
  private lightningTimer = 7;
  private colliders: Collider[] = [];
  private corruption = 0;
  private clockMesh: THREE.Mesh | null = null;
  private phoneScreen: THREE.MeshBasicMaterial | null = null;
  private monitorBasePos = new THREE.Vector3();
  private crtScreenMat: THREE.MeshBasicMaterial | null = null;
  private after = false;
  private disposeList: (THREE.Material | THREE.BufferGeometry | THREE.Texture)[] = [];

  constructor(private assets: Assets) {
    this.scene.background = new THREE.Color(0x03050a);
    this.scene.fog = new THREE.FogExp2(0x03060d, 0.028);
  }

  get focusReady() {
    return !!this.screenMesh;
  }

  build() {
    this.buildRoom();
    this.buildDesk();
    this.buildProps();
    this.buildExterior();
    this.buildLighting();
    this.buildShards();
    this.buildInteractables();
    this.scene.add(this.aftermathGroup);
    this.aftermathGroup.visible = false;
  }

  /* ------------------------------------------------------------------ */
  private buildRoom() {
    const room = this.assets.models.room.scene;
    room.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats as THREE.MeshStandardMaterial[]) {
        if (!mat) continue;
        if (mat.map) {
          mat.map.anisotropy = 8;
          mat.map.needsUpdate = true;
        }
        mat.envMapIntensity = 0.35;
        if ("metalness" in mat) (mat as THREE.MeshStandardMaterial).metalness = 0.05;
        if ("roughness" in mat) (mat as THREE.MeshStandardMaterial).roughness = Math.max(0.55, (mat as THREE.MeshStandardMaterial).roughness ?? 0.8);
      }
    });
    this.roomRoot.add(room);
    this.scene.add(this.roomRoot);

    // --- enclose the cutaway: front wall + ceiling + door + skirting ---
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.assets.textures.wall,
      normalMap: this.assets.textures.wallNormal,
      color: 0x9aa7b6,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    wallMat.map!.repeat.set(1.6, 1.1);
    wallMat.normalScale = new THREE.Vector2(0.6, 0.6);
    this.disposeList.push(wallMat);

    const front = new THREE.Mesh(new THREE.PlaneGeometry(5.06, 3.2), wallMat);
    front.position.set(0.335, 1.58, 1.652);
    front.rotation.y = Math.PI;
    front.receiveShadow = true;
    this.roomRoot.add(front);

    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x8b97a5, roughness: 0.95, side: THREE.DoubleSide });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(5.06, 4.62), ceilingMat);
    this.ceilingMesh = ceiling;
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0.335, 3.16, -0.6);
    ceiling.receiveShadow = true;
    this.roomRoot.add(ceiling);

    // door on the front wall
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.72, metalness: 0.02 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.06, 0.06), doorMat);
    door.position.set(1.32, 1.05, 1.628);
    door.castShadow = true;
    door.receiveShadow = true;
    this.roomRoot.add(door);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.8 });
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.09), frameMat);
    frameTop.position.set(1.32, 2.11, 1.63);
    this.roomRoot.add(frameTop);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.1, 0.09), frameMat);
      side.position.set(1.32 + s * 0.49, 1.05, 1.63);
      this.roomRoot.add(side);
    }
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.12, 10),
      new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.8 }),
    );
    handle.rotation.z = Math.PI / 2;
    handle.position.set(0.93, 1.02, 1.59);
    this.roomRoot.add(handle);

    // skirting
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.8 });
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(5.06, 0.09, 0.03), skirtMat);
    skirt.position.set(0.335, 0.07, 1.636);
    this.roomRoot.add(skirt);

    // sockets / switches so the new wall does not read as blank
    const socketMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.6 });
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.012), socketMat);
    socket.position.set(0.55, 0.28, 1.638);
    this.roomRoot.add(socket);
    const lightSwitch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.13, 0.012), socketMat);
    lightSwitch.position.set(1.92, 1.22, 1.638);
    this.roomRoot.add(lightSwitch);

    this.colliders.push(
      { minX: -2.07, maxX: -1.99, minZ: -3.2, maxZ: 1.7 },
      { minX: -2.07, maxX: 3.0, minZ: 1.57, maxZ: 1.7 },
      { minX: 2.66, maxX: 3.0, minZ: -3.2, maxZ: 1.7 },
    );
  }

  /* ------------------------------------------------------------------ */
  private buildDesk() {
    const desk = this.assets.models.desk.scene;
    // neutralise the exaggerated emissive of the original monitor, we swap the screen itself
    desk.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats as THREE.MeshStandardMaterial[]) {
        if (!mat) continue;
        if (mat.map) mat.map.anisotropy = 4;
        if (mat.emissive && (mat.name === "BSOD_SCREEN_MAT" || mat.name?.includes("074_33"))) {
          mat.emissive = new THREE.Color(0x001428);
          mat.emissiveIntensity = 1;
        }
      }
    });

    const scale = 0.1;
    desk.scale.setScalar(scale);
    desk.rotation.y = 0; // model already faces +X
    desk.updateMatrixWorld(true);

    // find the desk slab, use it to align the whole unit
    let slab: THREE.Object3D | null = null;
    desk.traverse((o) => {
      if (!slab && (o.name === "Cube_Material_0" || o.name.startsWith("Cube_Material"))) slab = o;
    });
    const box = new THREE.Box3();
    if (slab) box.setFromObject(slab);
    else box.setFromObject(desk);

    // place: back edge against the left wall, top at 0.755, length centred on z = 0.72
    const cz = (box.min.z + box.max.z) / 2;
    desk.position.x += -2.03 - box.min.x;
    desk.position.z += 0.72 - cz;
    desk.position.y += 0.755 - box.max.y;
    desk.updateMatrixWorld(true);

    this.deskRoot.add(desk);
    this.scene.add(this.deskRoot);

    // legs (the original asset is a floating slab)
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.5 });
    const slabBox = new THREE.Box3().setFromObject(slab ?? desk);
    const legH = slabBox.min.y - FLOOR_Y;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, legH, 0.045), legMat);
        leg.position.set(
          (sx < 0 ? slabBox.min.x + 0.06 : slabBox.max.x - 0.06),
          FLOOR_Y + legH / 2,
          (sz < 0 ? slabBox.min.z + 0.06 : slabBox.max.z - 0.06),
        );
        leg.castShadow = true;
        this.scene.add(leg);
      }
    }

    // screen mesh → our BSOD shader
    let screen: THREE.Mesh | null = null;
    desk.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.name.includes("BSOD_SCREEN") || (m.material as THREE.Material)?.name === "BSOD_SCREEN_MAT")) {
        screen = m;
      }
    });
    if (screen) {
      this.screenMesh = screen;
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: this.screen.texture },
          uTime: { value: 0 },
          uCorruption: { value: 0 },
          uFlash: { value: 0 },
          uBright: { value: 0.82 },
          uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        },
        vertexShader: screenVert,
        fragmentShader: screenFrag,
        toneMapped: false,
      });
      this.screenMat = mat;
      (screen as THREE.Mesh).material = mat;
      (screen as THREE.Mesh).castShadow = false;
      // screen glow sprite + light
      const gBox = new THREE.Box3().setFromObject(screen as THREE.Mesh);
      const center = gBox.getCenter(new THREE.Vector3());
      const size = gBox.getSize(new THREE.Vector3());
      this.monitorBasePos.copy(center);

      const glowTex = makeGlowTexture();
      this.screenGlow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: 0x3f9bff,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.5,
        }),
      );
      this.screenGlow.position.copy(center).add(new THREE.Vector3(0.09, 0, 0));
      this.screenGlow.scale.setScalar(Math.max(size.y, 0.3) * 2.6);
      this.scene.add(this.screenGlow);
      this.disposeList.push(glowTex);
    }

    // cables from the case to the wall
    const cableGroup = this.assets.models.cables.scene;
    cableGroup.scale.setScalar(0.12);
    cableGroup.position.set(-1.72, 0.11, 1.25);
    cableGroup.rotation.y = 1.2;
    cableGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        (m.material as THREE.MeshStandardMaterial).color?.multiplyScalar(0.6);
      }
    });
    this.scene.add(cableGroup);

    // PC desk collider (against the left wall)
    this.colliders.push({ minX: -2.07, maxX: -1.28, minZ: -0.06, maxZ: 1.5 });
  }

  /* ------------------------------------------------------------------ */
  private buildProps() {
    const chair = this.assets.models.chair.scene;
    chair.scale.setScalar(0.78);
    chair.rotation.y = -Math.PI / 2; // faces +X, i.e. towards the desk
    chair.position.set(-0.92, FLOOR_Y, 0.72);
    chair.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    this.chair = chair;
    this.scene.add(chair);
    this.colliders.push({ minX: -1.22, maxX: -0.64, minZ: 0.42, maxZ: 1.04 });

    // CRT left on the window sill, a second, older eye in the room
    const crt = this.assets.models.crt.scene.clone(true);
    crt.scale.setScalar(0.92);
    crt.position.set(2.42, 0.905, -0.55);
    crt.rotation.y = -Math.PI / 2 + 0.12;
    crt.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      if (m.name.includes("glass")) {
        const mat = new THREE.MeshBasicMaterial({ color: 0x0a1c30, toneMapped: false });
        m.material = mat;
        this.crtScreenMat = mat;
        this.disposeList.push(mat);
      }
    });
    this.scene.add(crt);

    const propMat = (color: number, rough = 0.7, metal = 0) =>
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

    // mug
    const mug = new THREE.Group();
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.1, 16, 1, true), propMat(0xcfd3d8, 0.55));
    cup.position.y = 0.05;
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16), propMat(0xb9bec5, 0.6));
    bottom.rotation.x = -Math.PI / 2;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.007, 8, 16, Math.PI * 1.4), propMat(0xcfd3d8, 0.55));
    handle.position.set(0.045, 0.055, 0);
    handle.rotation.y = Math.PI / 2;
    mug.add(cup, bottom, handle);
    mug.position.set(-1.55, 0.757, 1.06);
    mug.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.scene.add(mug);

    // energy can
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.122, 18), propMat(0x4a5c73, 0.35, 0.65));
    can.position.set(-1.66, 0.816, 0.42);
    can.castShadow = true;
    this.scene.add(can);

    // headphones
    const hp = new THREE.Group();
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.011, 8, 24, Math.PI), propMat(0x14161a, 0.5));
    const cupL = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.03, 18), propMat(0x14161a, 0.5));
    const cupR = cupL.clone();
    cupL.rotation.z = Math.PI / 2;
    cupR.rotation.z = Math.PI / 2;
    cupL.position.set(-0.085, -0.005, 0);
    cupR.position.set(0.085, -0.005, 0);
    hp.add(band, cupL, cupR);
    hp.position.set(-1.38, 0.79, 0.16);
    hp.rotation.set(0.1, 0.4, 0.05);
    this.scene.add(hp);

    // scattered notes
    const paperTex = makeStickerTexture();
    this.disposeList.push(paperTex);
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xd7d9dc, roughness: 0.9, map: paperTex });
    this.disposeList.push(paperMat);
    const rng = new Rng(91);
    for (let i = 0; i < 7; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), paperMat);
      p.rotation.x = -Math.PI / 2;
      p.rotation.z = rng.range(0, TAU);
      if (i < 4) {
        p.position.set(rng.range(-1.98, -1.36), 0.762, rng.range(-0.02, 0.55));
      } else {
        p.position.set(rng.range(-1.2, -0.4), FLOOR_Y + 0.004, rng.range(0.2, 1.3));
        p.rotation.x = -Math.PI / 2 + rng.range(-0.03, 0.03);
      }
      p.receiveShadow = true;
      this.scene.add(p);
    }

    // phone with a lit screen
    const phone = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.008, 0.155), propMat(0x101216, 0.35, 0.4));
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x8fb6d8, toneMapped: false });
    this.phoneScreen = screenMat;
    this.disposeList.push(screenMat);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.145), screenMat);
    scr.rotation.x = -Math.PI / 2;
    scr.position.y = 0.005;
    phone.add(body, scr);
    phone.position.set(-1.42, 0.762, -0.02);
    phone.rotation.y = 0.5;
    this.scene.add(phone);

    // poster on the front wall
    const posterMat = new THREE.MeshStandardMaterial({
      map: makePosterTexture(this.assets.textures.poster),
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    this.disposeList.push(posterMat);
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.73), posterMat);
    poster.position.set(0.34, 1.72, 1.633);
    poster.rotation.y = Math.PI;
    this.poster = poster;
    this.scene.add(poster);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.77, 0.02), propMat(0x16181c, 0.7));
    frame.position.set(0.34, 1.72, 1.648);
    this.scene.add(frame);

    // alarm clock on the shelf behind the bed
    const clockTex = makeClockFaceTexture();
    this.disposeList.push(clockTex);
    const clock = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.08, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.5, map: clockTex, emissive: 0x223044, emissiveIntensity: 0.4 }),
    );
    clock.position.set(-1.62, 0.86, -2.2);
    clock.rotation.y = 0.25;
    this.clockMesh = clock;
    this.scene.add(clock);

    // clothes bundle at the foot of the bed
    for (let i = 0; i < 3; i++) {
      const cloth = new THREE.Mesh(
        new THREE.SphereGeometry(0.18 + i * 0.03, 10, 8),
        propMat([0x2b3340, 0x3a2f33, 0x232a33][i], 0.95),
      );
      cloth.scale.set(1.4, 0.42, 1.1);
      cloth.position.set(-0.55 + i * 0.22, FLOOR_Y + 0.055, -0.12 + (i % 2) * 0.1);
      cloth.castShadow = true;
      cloth.receiveShadow = true;
      this.scene.add(cloth);
    }

    // floating dust motes in the monitor light
    const moteCount = 120;
    const pos = new Float32Array(moteCount * 3);
    const rng2 = new Rng(7);
    for (let i = 0; i < moteCount; i++) {
      pos[i * 3] = rng2.range(-1.9, -0.6);
      pos[i * 3 + 1] = rng2.range(0.8, 2.2);
      pos[i * 3 + 2] = rng2.range(-0.2, 1.4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const moteTex = makeGlowTexture("rgba(200,230,255,0.9)", "rgba(80,140,220,0)");
    this.disposeList.push(moteTex);
    const motes = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 0.016,
        map: moteTex,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    motes.userData.drift = true;
    this.scene.add(motes);
    this.motes = motes;
  }

  private motes!: THREE.Points;
  private poster: THREE.Mesh | null = null;
  private ceilingMesh: THREE.Mesh | null = null;
  private bursts: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number }[] = [];

  /* ------------------------------------------------------------------ */
  private buildExterior() {
    // night skyline outside the window
    const W = 1024;
    const H = 512;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#040810");
    g.addColorStop(0.55, "#08182e");
    g.addColorStop(0.78, "#0d2a4a");
    g.addColorStop(1, "#050b16");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const rng = new Rng(5);
    for (let layer = 0; layer < 3; layer++) {
      const shade = [8, 14, 22][layer];
      const baseY = 300 + layer * 55;
      let x = -20;
      while (x < W + 40) {
        const bw = rng.range(38, 110);
        const bh = rng.range(70, 210) * (1 - layer * 0.2);
        ctx.fillStyle = `rgb(${shade},${shade + 6},${shade + 14})`;
        ctx.fillRect(x, baseY - bh, bw, bh + 220);
        // windows
        for (let wy = baseY - bh + 10; wy < baseY - 8; wy += 16) {
          for (let wx = x + 7; wx < x + bw - 10; wx += 14) {
            if (rng.next() > 0.82) {
              ctx.fillStyle = rng.next() > 0.5 ? "rgba(255,206,140,0.55)" : "rgba(150,200,255,0.4)";
              ctx.fillRect(wx, wy, 6, 8);
            }
          }
        }
        x += bw + rng.range(6, 22);
      }
    }
    const skyTex = new THREE.CanvasTexture(c);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.disposeList.push(skyTex);
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(15, 8),
      new THREE.MeshBasicMaterial({ map: skyTex, toneMapped: false }),
    );
    sky.position.set(6.2, 2.4, -0.6);
    sky.rotation.y = -Math.PI / 2;
    this.scene.add(sky);

    // rain outside the window
    const count = 320;
    this.rainPositions = new Float32Array(count * 6);
    const rngR = new Rng(21);
    for (let i = 0; i < count; i++) {
      const x = 2.85 + rngR.range(0, 3.2);
      const y = rngR.range(0.2, 4.2);
      const z = rngR.range(-2.2, 1.2);
      const len = rngR.range(0.06, 0.2);
      this.rainPositions[i * 6] = x;
      this.rainPositions[i * 6 + 1] = y;
      this.rainPositions[i * 6 + 2] = z;
      this.rainPositions[i * 6 + 3] = x + 0.02;
      this.rainPositions[i * 6 + 4] = y - len;
      this.rainPositions[i * 6 + 5] = z;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(this.rainPositions, 3));
    this.rain = new THREE.LineSegments(
      rg,
      new THREE.LineBasicMaterial({ color: 0x8fb6e0, transparent: true, opacity: 0.24, depthWrite: false }),
    );
    this.scene.add(this.rain);

    // warm lamp light spilling through the window from the street
    const winGlowTex = makeWindowGlowTexture();
    this.disposeList.push(winGlowTex);
    const winGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, 1.1),
      new THREE.MeshBasicMaterial({ map: winGlowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    winGlow.position.set(2.73, 1.06, -0.55);
    winGlow.rotation.y = -Math.PI / 2;
    this.scene.add(winGlow);
  }

  /* ------------------------------------------------------------------ */
  private buildLighting() {
    this.ambient = new THREE.HemisphereLight(0x22334d, 0x05070b, 0.5);
    this.scene.add(this.ambient);

    this.monitorLight = new THREE.PointLight(0x3f8ede, 4.2, 7, 2);
    this.monitorLight.position.copy(this.monitorBasePos).add(new THREE.Vector3(0.35, 0.05, 0));
    this.scene.add(this.monitorLight);

    this.fillLight = new THREE.PointLight(0x6fa8d8, 1.1, 6, 2);
    this.fillLight.position.set(2.2, 1.5, -0.6);
    this.scene.add(this.fillLight);

    this.moon = new THREE.DirectionalLight(0x9dbcff, 0.75);
    this.moon.position.set(5.5, 4.2, -1.2);
    this.moon.target.position.set(0.2, 1.0, 0.2);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(1024, 1024);
    this.moon.shadow.camera.left = -4.5;
    this.moon.shadow.camera.right = 4.5;
    this.moon.shadow.camera.top = 4.5;
    this.moon.shadow.camera.bottom = -4.5;
    this.moon.shadow.camera.near = 0.5;
    this.moon.shadow.camera.far = 16;
    this.moon.shadow.bias = -0.0007;
    this.moon.shadow.normalBias = 0.02;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);
  }

  /* ------------------------------------------------------------------ */
  private buildShards() {
    // wall / floor / ceiling plates that peel toward the monitor during the takeover
    const mats = [
      new THREE.MeshStandardMaterial({
        map: this.assets.textures.wall,
        color: 0x8d99a8,
        roughness: 0.9,
        side: THREE.DoubleSide,
        transparent: true,
        emissive: new THREE.Color(0x0d4f9c),
        emissiveIntensity: 0,
      }),
      new THREE.MeshStandardMaterial({
        map: this.assets.textures.floor,
        color: 0x6b6f78,
        roughness: 0.85,
        side: THREE.DoubleSide,
        transparent: true,
        emissive: new THREE.Color(0x0d4f9c),
        emissiveIntensity: 0,
      }),
    ];
    mats.forEach((m) => this.disposeList.push(m));
    const rng = new Rng(1234);
    const spots: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    // front wall
    for (let i = 0; i < 7; i++) {
      spots.push({
        p: new THREE.Vector3(rng.range(-1.9, 2.6), rng.range(0.3, 2.7), 1.6),
        n: new THREE.Vector3(0, 0, -1),
      });
    }
    // left wall
    for (let i = 0; i < 5; i++) {
      spots.push({
        p: new THREE.Vector3(-2.02, rng.range(0.4, 2.7), rng.range(-2.4, 1.4)),
        n: new THREE.Vector3(1, 0, 0),
      });
    }
    // floor + ceiling
    for (let i = 0; i < 5; i++) {
      spots.push({
        p: new THREE.Vector3(rng.range(-1.6, 2.3), 0.03, rng.range(-2.2, 1.2)),
        n: new THREE.Vector3(0, 1, 0),
      });
    }
    for (let i = 0; i < 4; i++) {
      spots.push({
        p: new THREE.Vector3(rng.range(-1.6, 2.3), 3.1, rng.range(-1.8, 1.2)),
        n: new THREE.Vector3(0, -1, 0),
      });
    }

    for (const s of spots) {
      const r = rng.range(0.18, 0.55);
      const shape = new THREE.Shape();
      const verts = 5 + Math.floor(rng.range(0, 3));
      for (let i = 0; i <= verts; i++) {
        const a = (i / verts) * TAU;
        const rr = r * rng.range(0.55, 1.0);
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      const geo = new THREE.ShapeGeometry(shape);
      // project planar UVs so the plaster/parquet texture reads correctly
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      const posAttr = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        if (Math.abs(s.n.z) > 0.5) uv.setXY(i, (s.p.x + x) * 0.5, (s.p.y + y) * 0.5);
        else if (Math.abs(s.n.x) > 0.5) uv.setXY(i, (s.p.z + x) * 0.5, (s.p.y + y) * 0.5);
        else uv.setXY(i, (s.p.x + x) * 0.5, (s.p.z + y) * 0.5);
      }
      const mesh = new THREE.Mesh(geo, mats[rng.next() > 0.45 ? 0 : 1]);
      mesh.position.copy(s.p).addScaledVector(s.n, 0.012);
      if (Math.abs(s.n.z) > 0.5) mesh.rotation.y = s.n.z > 0 ? 0 : Math.PI;
      else if (Math.abs(s.n.x) > 0.5) mesh.rotation.y = s.n.x > 0 ? Math.PI / 2 : -Math.PI / 2;
      else mesh.rotation.x = s.n.y > 0 ? -Math.PI / 2 : Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.shards.push({
        mesh,
        base: mesh.position.clone(),
        normal: s.n.clone(),
        threshold: rng.range(0.1, 0.92),
        rot: new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)),
        spin: rng.range(0.6, 2.2),
      });
    }

    // an aperture that opens where the screen used to be
    const apertureTex = makeMatGlyph(":(");
    this.disposeList.push(apertureTex);
    this.mouthMat = new THREE.MeshBasicMaterial({
      map: apertureTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.disposeList.push(this.mouthMat);
    this.mouth = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mouthMat);
    this.mouth.position.copy(this.monitorBasePos).add(new THREE.Vector3(0.1, 0, 0));
    this.mouth.rotation.y = -Math.PI / 2;
    this.mouth.renderOrder = 5;
    this.mouth.visible = false;
    this.scene.add(this.mouth);
  }

  private buildInteractables() {
    const screenAnchor = this.monitorBasePos.clone().add(new THREE.Vector3(0.25, 0, 0));
    this.interactables.push({
      id: "monitor",
      anchor: screenAnchor,
      radius: 1.9,
      label: this.after ? "モニターに触れる" : "PC を調べる",
      hint: "E",
      onInteract: () => {},
    });
    this.interactables.push({
      id: "tower",
      anchor: new THREE.Vector3(-1.5, 0.6, 1.32),
      radius: 1.0,
      label: "ケースに触れる",
      hint: "E",
      onInteract: () => {},
    });
    this.interactables.push({
      id: "door",
      anchor: new THREE.Vector3(1.3, 1.0, 1.5),
      radius: 1.2,
      label: "ドアを開けようとする",
      hint: "E",
      onInteract: () => {},
    });
    this.interactables.push({
      id: "bed",
      anchor: new THREE.Vector3(-0.2, 0.7, -0.35),
      radius: 1.1,
      label: "ベッドを見る",
      hint: "E",
      onInteract: () => {},
    });
    this.interactables.push({
      id: "window",
      anchor: new THREE.Vector3(2.5, 1.2, -0.5),
      radius: 1.5,
      label: "窓の外を見る",
      hint: "E",
      onInteract: () => {},
    });
  }

  /* ------------------------------------------------------------------ */
  setCorruption(v: number) {
    this.corruption = clamp(v, 0, 1);
    if (this.screenMat) this.screenMat.uniforms.uCorruption.value = this.corruption;
  }

  getScreenWorldInfo() {
    if (!this.screenMesh) return null;
    const box = new THREE.Box3().setFromObject(this.screenMesh);
    const center = box.getCenter(new THREE.Vector3());
    // the quad's local +Z is its front face (it points into the room)
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(this.screenMesh.matrixWorld).normalize();
    const size = box.getSize(new THREE.Vector3());
    const width = Math.abs(size.z);
    const height = size.y;
    const focusPos = center.clone().addScaledVector(normal, 0.55).add(new THREE.Vector3(0, 0.03, 0));
    return { center, normal, width, height, focusPos };
  }

  get focusPose() {
    const info = this.getScreenWorldInfo();
    if (!info) return null;
    return { position: info.focusPos.clone(), target: info.center.clone() };
  }

  /** The ":(" glyph occupies the upper-left of the monitor image. */
  static readonly FACE_RECT = { u0: 0.02, v0: 0.5, u1: 0.52, v1: 0.98 };

  /** Raycast the monitor surface; returns the hit uv (0..1) when the cursor is on the glass. */
  pickScreen(ndc: THREE.Vector2, camera: THREE.Camera): { hit: boolean; overFace: boolean; uv: THREE.Vector2 | null } {
    if (!this.screenMesh) return { hit: false, overFace: false, uv: null };
    camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(this.screenMesh, false);
    if (!hits.length || !hits[0].uv) return { hit: false, overFace: false, uv: null };
    const uv = hits[0].uv;
    const r = RoomScene.FACE_RECT;
    const overFace = uv.x >= r.u0 && uv.x <= r.u1 && uv.y >= r.v0 && uv.y <= r.v1;
    return { hit: true, overFace, uv };
  }

  setMouseUv(x: number, y: number) {
    if (this.screenMat) this.screenMat.uniforms.uMouse.value.set(x, y);
  }

  /* ------------------------------------------------------------------ */
  update(dt: number, time: number, player: FirstPerson | null) {
    const corruption = this.corruption;
    if (this.screenMat) {
      this.screenMat.uniforms.uTime.value = time;
      const flick = 0.78 + 0.12 * Math.sin(time * 2.1) + 0.06 * Math.sin(time * 17.3) + corruption * 0.25;
      this.screenMat.uniforms.uBright.value = flick;
    }
    this.screen.update(dt, corruption, {
      x: 0.5 + Math.sin(time * 0.7) * 0.2,
      y: 0.5 + Math.cos(time * 0.9) * 0.2,
    });

    // monitor light breathes with the screen
    const basePulse = 0.82 + Math.sin(time * 1.7) * 0.06 + Math.sin(time * 9.1) * 0.03;
    this.monitorLight.intensity = (3.2 + corruption * 5.5) * basePulse;
    this.monitorLight.color.setHSL(0.58, 0.75, lerp(0.55, 0.7, corruption));
    if (this.screenGlow) {
      const mat = this.screenGlow.material as THREE.SpriteMaterial;
      mat.opacity = 0.32 + corruption * 0.5 + Math.sin(time * 3.1) * 0.03;
      this.screenGlow.scale.setScalar((this.screenGlow.scale.x * 0.9 + 0.9 * 0.1) * 1.0);
    }

    // shards peeling off the room
    for (const s of this.shards) {
      const t = saturate((corruption - s.threshold * 0.55) / 0.45);
      s.mesh.visible = t > 0.001;
      if (!s.mesh.visible) continue;
      const dir = new THREE.Vector3().subVectors(this.monitorBasePos, s.base).normalize();
      const wobble = Math.sin(time * s.spin + s.threshold * 10) * 0.04 * t;
      s.mesh.position.copy(s.base).addScaledVector(dir, t * t * 1.4 * (0.4 + s.threshold));
      s.mesh.position.addScaledVector(s.normal, (1 - t) * 0.012 + t * 0.9);
      s.mesh.position.y += wobble;
      s.mesh.rotation.x += s.rot.x * dt * t * 1.2;
      s.mesh.rotation.y += s.rot.y * dt * t * 1.2;
      s.mesh.rotation.z += s.rot.z * dt * t * 1.2;
      const mat = s.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = t * 1.6;
      mat.opacity = t * 0.95;
    }

    // the aperture
    if (this.corruption > 0.03) this.mouth.visible = true;
    if (this.mouth.visible) {
      const k = smoothstep(0.35, 1, corruption);
      this.mouthMat.opacity = k * 0.85;
      const s = lerp(0.6, 5.5, k * k);
      this.mouth.scale.setScalar(s);
      this.mouth.rotation.z = Math.sin(time * 2.4) * 0.06;
    }

    // foreign lights
    if (this.crtScreenMat) {
      const v = 0.5 + 0.5 * Math.sin(time * 3.3) * Math.sin(time * 1.1);
      this.crtScreenMat.color.setRGB(0.02 + v * 0.05, 0.07 + v * 0.12, 0.12 + v * 0.16);
    }
    if (this.phoneScreen) {
      const v = 0.55 + 0.2 * Math.sin(time * 0.7);
      this.phoneScreen.color.setRGB(0.42 * v, 0.6 * v, 0.75 * v);
    }

    // rain
    if (this.rainPositions) {
      const arr = this.rainPositions;
      for (let i = 0; i < arr.length; i += 6) {
        const dy = dt * 6.4;
        arr[i + 1] -= dy;
        arr[i + 4] -= dy;
        if (arr[i + 4] < 0.05) {
          const y = 4.4;
          const len = 0.06 + Math.random() * 0.16;
          arr[i + 1] = y;
          arr[i + 4] = y - len;
        }
      }
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    // lightning
    this.lightningTimer -= dt;
    if (this.lightningTimer <= 0) {
      this.lightningTimer = 9 + Math.random() * 16;
      this.lightning = 1;
    }
    if (this.lightning > 0) {
      this.lightning = Math.max(0, this.lightning - dt * 3.6);
      const f = this.lightning * this.lightning;
      this.moon.intensity = 0.75 + f * 6;
      this.fillLight.intensity = 1.1 + f * 4;
      if (Math.random() < 0.02) this.lightning = Math.max(this.lightning, 0.75);
    } else {
      this.moon.intensity = damp(this.moon.intensity, 0.75, 4, dt);
      this.fillLight.intensity = damp(this.fillLight.intensity, 1.1, 4, dt);
    }

    // dust motes drift
    if (this.motes) {
      const p = this.motes.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + dt * 0.014 * (0.6 + hash2(i, 3));
        let x = p.getX(i) + Math.sin(time * 0.3 + i) * dt * 0.004;
        if (y > 2.4) y = 0.75;
        if (x > -0.55) x = -1.95;
        p.setXYZ(i, x, y, p.getZ(i));
      }
      p.needsUpdate = true;
    }

    this.updateBursts(dt);
    if (player) void player;
    void this.clockMesh;
  }

  setCeilingVisible(v: boolean) {
    if (this.ceilingMesh) this.ceilingMesh.visible = v;
  }

  /** Chunks of plaster / debris that rain down for the return sequence. */
  burst(x: number, y: number, z: number, count: number) {
    const rng = new Rng(Math.floor(x * 1000 + z * 977 + count));
    const geo = new THREE.TetrahedronGeometry(0.07, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9aa5b2,
      roughness: 0.95,
      emissive: new THREE.Color(0x0a2b52),
      emissiveIntensity: 0.6,
      flatShading: true,
    });
    this.disposeList.push(geo, mat);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x + rng.range(-0.9, 0.9), y + rng.range(-0.15, 0.15), z + rng.range(-0.9, 0.9));
      m.scale.setScalar(rng.range(0.5, 2.2));
      m.rotation.set(rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU));
      this.scene.add(m);
      this.bursts.push({
        mesh: m,
        vel: new THREE.Vector3(rng.range(-1.6, 1.6), rng.range(-1.5, 2.5), rng.range(-1.6, 1.6)),
        spin: new THREE.Vector3(rng.range(-7, 7), rng.range(-7, 7), rng.range(-7, 7)),
        life: rng.range(3.5, 7),
      });
    }
  }

  private updateBursts(dt: number) {
    if (!this.bursts.length) return;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      b.vel.y -= 12 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
      if (b.mesh.position.y < FLOOR_Y + 0.02) {
        b.mesh.position.y = FLOOR_Y + 0.02;
        b.vel.multiplyScalar(0.35);
        b.vel.y = Math.abs(b.vel.y) * 0.28;
        b.spin.multiplyScalar(0.5);
        if (Math.abs(b.vel.y) < 0.2) b.vel.y = 0;
      }
      if (b.life < 0.6) {
        const mat = b.mesh.material as THREE.MeshStandardMaterial;
        mat.opacity = Math.max(0, b.life / 0.6);
        mat.transparent = true;
      }
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bursts.splice(i, 1);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  private makeAnomalies() {
    const rng = new Rng(555);
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0x1d4f8f,
      emissive: new THREE.Color(0x2f8fff),
      emissiveIntensity: 1.6,
      roughness: 0.25,
      metalness: 0.1,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
    });
    this.disposeList.push(shardMat);
    const geos = [new THREE.TetrahedronGeometry(1, 0), new THREE.OctahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 0)];
    geos.forEach((g) => this.disposeList.push(g));
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(geos[i % geos.length], shardMat.clone());
      const onDesk = i < 6;
      if (onDesk) {
        m.position.set(rng.range(-1.95, -1.4), 0.775, rng.range(-0.05, 1.35));
      } else {
        m.position.set(rng.range(-1.2, 1.1), FLOOR_Y + 0.03, rng.range(-0.4, 1.25));
      }
      const s = rng.range(0.018, 0.062);
      m.scale.setScalar(s);
      m.rotation.set(rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU));
      m.castShadow = true;
      this.aftermathGroup.add(m);
    }
    // a scorch ring under the monitor and a crooked poster
    const ringGeo = new THREE.RingGeometry(0.35, 0.42, 48);
    this.disposeList.push(ringGeo);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x2a6fc0,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposeList.push(ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(-0.9, FLOOR_Y + 0.006, 0.72);
    this.aftermathGroup.add(ring);
  }

  applyAftermath() {
    if (this.after) return;
    this.after = true;
    this.makeAnomalies();
    this.aftermathGroup.visible = true;
    // chair knocked away and turned round
    this.chair.position.set(-0.72, FLOOR_Y, 0.22);
    this.chair.rotation.y = -Math.PI / 2 + 2.3;
    this.chair.rotation.z = 0.16;
    this.chair.rotation.x = -0.08;
    // the monitor keeps a face on it
    this.setCorruption(0.16);
    const i = this.interactables.find((x) => x.id === "monitor");
    if (i) i.label = "モニターを調べる";
    // crooked poster
    if (this.poster) this.poster.rotation.z = 0.055;
  }

  resetAftermath() {
    this.after = false;
    this.aftermathGroup.visible = false;
    this.aftermathGroup.clear();
    this.chair.position.set(-0.92, FLOOR_Y, 0.72);
    this.chair.rotation.set(0, -Math.PI / 2, 0);
    this.setCorruption(0);
  }

  /* ------------------------------------------------------------------ */
  readonly surface = {
    ground: () => FLOOR_Y,
    resolve: (x: number, z: number, radius: number, fromX?: number, fromZ?: number) => {
      const push = (px: number, pz: number) => {
        let ox = px;
        let oz = pz;
        for (let pass = 0; pass < 4; pass++) {
          let moved = false;
          for (const c of this.colliders) {
            const cx = clamp(ox, c.minX, c.maxX);
            const cz = clamp(oz, c.minZ, c.maxZ);
            const dx = ox - cx;
            const dz = oz - cz;
            const d2 = dx * dx + dz * dz;
            if (d2 >= radius * radius) continue;
            moved = true;
            if (d2 > 1e-8) {
              const d = Math.sqrt(d2);
              ox = cx + (dx / d) * radius;
              oz = cz + (dz / d) * radius;
            } else {
              const left = ox - c.minX;
              const right = c.maxX - ox;
              const back = oz - c.minZ;
              const front = c.maxZ - oz;
              const m = Math.min(left, right, back, front);
              if (m === left) ox = c.minX - radius;
              else if (m === right) ox = c.maxX + radius;
              else if (m === back) oz = c.minZ - radius;
              else oz = c.maxZ + radius;
            }
          }
          if (!moved) break;
        }
        return { x: ox, z: oz };
      };
      const hits = (px: number, pz: number) =>
        this.colliders.some((c) => {
          const dx = px - clamp(px, c.minX, c.maxX);
          const dz = pz - clamp(pz, c.minZ, c.maxZ);
          return dx * dx + dz * dz < radius * radius - 1e-6;
        });

      let out = push(x, z);
      if (hits(out.x, out.z)) {
        const ax = push(x, fromZ ?? z);
        if (!hits(ax.x, ax.z)) out = ax;
        else {
          const az = push(fromX ?? x, z);
          if (!hits(az.x, az.z)) out = az;
          else out = { x: fromX ?? x, z: fromZ ?? z };
          if (hits(out.x, out.z)) out = push(x, z);
        }
      }
      out.x = clamp(out.x, -1.77, 2.44);
      out.z = clamp(out.z, -2.56, 1.35);
      return out;
    },
  };

  dispose() {
    for (const d of this.disposeList) d.dispose();
    this.disposeList.length = 0;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
