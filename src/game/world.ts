import * as THREE from "three";
import type { Assets } from "./assets";
import {
  makeGlowTexture,
  makeGlyphTexture,
  makeScrollTexture,
  makeStripeTexture,
  makeTextStrip,
  makeWakeUpTexture,
  makeWindowTexture,
} from "./canvas";
import { groundFrag, groundVert, skyFrag, skyVert } from "./shaders";
import { Rng, TAU, clamp, damp, hash2, lerp, saturate, smoothstep } from "./util";

const PLAQUE_X = 6.2;
const PLAQUE_Z = 12.4;
export const terrainHeight = (x: number, z: number) =>
  Math.sin(x * 0.062) * Math.cos(z * 0.049) * 0.72 +
  Math.sin((x * 0.7 + z * 0.8) * 0.135) * 0.34 +
  Math.sin(x * 0.021 + 1.7) * Math.cos(z * 0.017 - 0.6) * 1.35;

interface Debris {
  mesh: THREE.InstancedMesh;
  items: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Vector3; rv: THREE.Vector3; s: number }[];
  active: boolean;
}

const MONOLITH_R = 9.2;

export class WorldScene {
  readonly scene = new THREE.Scene();
  readonly spawn = new THREE.Vector3(21, 0, 58);
  readonly spawnYaw = Math.atan2(-(-21), -(58)) + Math.PI; // look at origin
  readonly plaque = new THREE.Vector3(PLAQUE_X, terrainHeight(PLAQUE_X, PLAQUE_Z) + 2.95, PLAQUE_Z);
  readonly plaqueYaw = Math.atan2(21 - PLAQUE_X, 58 - PLAQUE_Z);
  readonly monolith = new THREE.Vector3(0, 0, 0);

  private groundMat!: THREE.ShaderMaterial;
  private sky!: THREE.Mesh;
  private coreLight!: THREE.PointLight;
  private rimLight!: THREE.PointLight;
  private strips: { mesh: THREE.Mesh; base: THREE.Vector3; phase: number; speed: number }[] = [];
  private crts: { obj: THREE.Object3D; base: THREE.Vector3; phase: number; amp: number }[] = [];
  private rings: THREE.Mesh[] = [];
  private shards!: THREE.InstancedMesh;
  private shardData: { p: THREE.Vector3; sp: number; phase: number; rot: number }[] = [];
  private debris: Debris | null = null;
  private colliders: { x: number; z: number; r: number }[] = [];
  private anomaly = 0;
  private anomalyTimer = 16;
  private collapse = 0;
  private hole = new THREE.Vector2();
  private holeRadius = 0;
  private crack = 0;
  private wakeSeen = false;
  private shaftMats: THREE.MeshBasicMaterial[] = [];
  private windowMeshes: THREE.Mesh[] = [];
  private glyphTrail: THREE.Mesh[] = [];
  private beam!: THREE.Mesh;
  private disposeList: (THREE.Material | THREE.BufferGeometry | THREE.Texture)[] = [];

  constructor(private assets: Assets) {
    this.scene.background = new THREE.Color(0x03060e);
    this.scene.fog = new THREE.FogExp2(0x04101f, 0.0082);
    // spawn sits on the +x/+z side, looking back at the origin
    this.spawnYaw = Math.atan2(-this.spawn.x, -this.spawn.z) + Math.PI;
  }

  get wakeFound() {
    return this.wakeSeen;
  }

  build() {
    this.buildSky();
    this.buildGround();
    this.buildMonolith();
    this.buildStructures();
    this.buildFloating();
    this.buildLights();
    this.buildDebris();
  }

  /* ------------------------------------------------------------------ */
  private buildSky() {
    const geo = new THREE.SphereGeometry(260, 32, 24);
    const mat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uWorldY: { value: 0 } },
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);
    this.disposeList.push(geo, mat);
  }

  private buildGround() {
    const geo = new THREE.PlaneGeometry(420, 420, 200, 200);
    geo.rotateX(-Math.PI / 2);
    this.groundMat = new THREE.ShaderMaterial({
      vertexShader: groundVert,
      fragmentShader: groundFrag,
      uniforms: {
        uTime: { value: 0 },
        uHole: { value: new THREE.Vector3(0, 0, 0) },
        uHoleRadius: { value: 0 },
        uCrack: { value: 0 },
        uBase: { value: new THREE.Color(0.016, 0.035, 0.072) },
        uLine: { value: new THREE.Color(0.16, 0.52, 1.0) },
        uFog: { value: new THREE.Color(0.016, 0.055, 0.11) },
        uFogNear: { value: 24 },
        uFogFar: { value: 190 },
        uPlayer: { value: new THREE.Vector2() },
        uPulse: { value: 0 },
        uLightDir: { value: new THREE.Vector3(0.3, 0.85, 0.4).normalize() },
      },
    });
    const ground = new THREE.Mesh(geo, this.groundMat);
    ground.frustumCulled = false;
    this.scene.add(ground);
    this.disposeList.push(geo, this.groundMat);
  }

  private buildMonolith() {
    const cray = this.assets.models.cray.scene.clone(true);
    cray.scale.setScalar(4.9);
    cray.position.set(0, -0.4, 0);
    cray.rotation.y = Math.PI * 0.06;
    cray.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.material as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshLambertMaterial({
        color: src.color ? src.color.clone() : new THREE.Color(0x9aa4b2),
        map: src.map ?? null,
        emissive: new THREE.Color(0x0a1c33),
        emissiveIntensity: 1,
      });
      m.material = mat;
    });
    this.scene.add(cray);

    // plinth
    const plinthGeo = new THREE.CylinderGeometry(11.5, 12.2, 0.7, 64);
    const plinthMat = new THREE.MeshLambertMaterial({ color: 0x0a1424, emissive: 0x050d19 });
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = 0.1;
    this.scene.add(plinth);

    const rimGeo = new THREE.RingGeometry(11.4, 12.1, 64);
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0x53b6ff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.47;
    this.scene.add(rim);

    // the secret: WAKE_UP
    const plaqueTex = makeWakeUpTexture();
    this.disposeList.push(plaqueTex);
    const plaqueMat = new THREE.MeshBasicMaterial({ map: plaqueTex, toneMapped: false });
    this.disposeList.push(plaqueMat);
    const normal = new THREE.Vector3(Math.sin(this.plaqueYaw), 0, Math.cos(this.plaqueYaw));
    const groundY = this.plaque.y - 2.95;
    const slabGeo = new THREE.BoxGeometry(5.9, 6.2, 0.42);
    const slabMat = new THREE.MeshLambertMaterial({ color: 0x070d18, emissive: 0x040c18 });
    this.disposeList.push(slabGeo, slabMat);
    const obelisk = new THREE.Mesh(slabGeo, slabMat);
    obelisk.position.copy(this.plaque).addScaledVector(normal, -0.26);
    obelisk.position.y = groundY + 3.1;
    obelisk.rotation.y = this.plaqueYaw;
    this.scene.add(obelisk);

    const baseGeo = new THREE.BoxGeometry(7.0, 0.5, 1.6);
    const base = new THREE.Mesh(baseGeo, slabMat);
    base.position.copy(this.plaque).addScaledVector(normal, -0.26);
    base.position.y = groundY + 0.25;
    base.rotation.y = this.plaqueYaw;
    this.scene.add(base);
    this.disposeList.push(baseGeo);

    const frameGeo = new THREE.PlaneGeometry(5.6, 3.0);
    const frameMat = new THREE.MeshBasicMaterial({
      color: 0x4aa8ff,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.disposeList.push(frameGeo, frameMat);
    const halo = new THREE.Mesh(frameGeo, frameMat);
    halo.position.copy(this.plaque).addScaledVector(normal, -0.02);
    halo.rotation.y = this.plaqueYaw;
    this.scene.add(halo);

    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6), plaqueMat);
    plaque.position.copy(this.plaque).addScaledVector(normal, 0.04);
    plaque.rotation.y = this.plaqueYaw;
    this.scene.add(plaque);

    // halo + core
    const glow = makeGlowTexture();
    this.disposeList.push(glow);
    const coreSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow, color: 0x6fc3ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 }),
    );
    coreSprite.position.set(0, 7.4, 0);
    coreSprite.scale.setScalar(22);
    this.scene.add(coreSprite);

    const ringGeo = new THREE.TorusGeometry(15, 0.09, 6, 96);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x7fc8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    this.disposeList.push(ringGeo, ringMat);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 4 + i * 2.4;
      ring.rotation.x = Math.PI / 2 + (i - 1) * 0.18;
      ring.rotation.z = i * 0.6;
      this.rings.push(ring);
      this.scene.add(ring);
    }

    // vertical light beam
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x4aa8ff,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      map: makeStripeTexture(),
    });
    const beamGeo = new THREE.CylinderGeometry(4.5, 9, 90, 24, 1, true);
    this.beam = new THREE.Mesh(beamGeo, beamMat);
    this.beam.position.y = 45;
    this.scene.add(this.beam);
    this.disposeList.push(beamGeo, beamMat);

    this.colliders.push({ x: 0, z: 0, r: MONOLITH_R });
    this.colliders.push({ x: PLAQUE_X, z: PLAQUE_Z, r: 2.6 });
  }

  /* ------------------------------------------------------------------ */
  private buildStructures() {
    const rng = new Rng(4242);
    const rackSrc = this.assets.models.rack.scene;
    const rackGeo: THREE.Object3D[] = [];
    rackSrc.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) rackGeo.push(o);
    });

    // ring of server monoliths
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + rng.range(-0.1, 0.1);
      const r = rng.range(30, 88);
      const clone = rackSrc.clone(true);
      const s = rng.range(1.5, 3.6);
      clone.scale.setScalar(s);
      clone.position.set(Math.cos(a) * r, terrainHeight(Math.cos(a) * r, Math.sin(a) * r) - 0.05, Math.sin(a) * r);
      clone.rotation.y = a + Math.PI / 2 + rng.range(-0.3, 0.3);
      clone.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        m.material = new THREE.MeshLambertMaterial({
          color: src.color ? src.color.clone().multiplyScalar(0.55) : new THREE.Color(0x22303f),
          map: src.map ?? null,
          emissive: new THREE.Color(0x06121f),
        });
      });
      this.scene.add(clone);
      this.colliders.push({ x: clone.position.x, z: clone.position.z, r: s * 0.62 });
    }

    // distant silhouettes: thin towers that fade into fog
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    const towerMat = new THREE.MeshLambertMaterial({ color: 0x0a1626, emissive: 0x040b14 });
    for (let i = 0; i < 42; i++) {
      const a = rng.range(0, TAU);
      const r = rng.range(80, 165);
      const t = new THREE.Mesh(towerGeo, towerMat);
      const h = rng.range(16, 74);
      t.scale.set(rng.range(3, 11), h, rng.range(3, 11));
      t.position.set(Math.cos(a) * r, terrainHeight(Math.cos(a) * r, Math.sin(a) * r) + h / 2 - 4, Math.sin(a) * r);
      t.rotation.y = rng.range(0, TAU);
      this.scene.add(t);
    }
    this.disposeList.push(towerGeo, towerMat);

    // light shafts
    const shaftTex = makeStripeTexture();
    this.disposeList.push(shaftTex);
    for (let i = 0; i < 7; i++) {
      const a = rng.range(0, TAU);
      const r = rng.range(24, 96);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x4f9fe0,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        map: shaftTex,
      });
      this.shaftMats.push(mat);
      const geo = new THREE.PlaneGeometry(rng.range(6, 22), rng.range(50, 90));
      const shaft = new THREE.Mesh(geo, mat);
      shaft.position.set(Math.cos(a) * r, rng.range(24, 40), Math.sin(a) * r);
      shaft.lookAt(0, 10, 0);
      shaft.rotation.z += rng.range(-0.3, 0.3);
      this.scene.add(shaft);
    }
  }

  /* ------------------------------------------------------------------ */
  private buildFloating() {
    const rng = new Rng(808);
    // CRT screens, drifting
    for (let i = 0; i < 22; i++) {
      const crt = this.assets.models.crt.scene.clone(true);
      const s = rng.range(0.7, 2.6);
      crt.scale.setScalar(s);
      const a = rng.range(0, TAU);
      const r = rng.range(16, 92);
      const y = rng.range(3.5, 20);
      crt.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      crt.rotation.set(rng.range(-0.2, 0.2), rng.range(0, TAU), rng.range(-0.16, 0.16));
      crt.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (m.name.includes("glass")) {
          const col = rng.next() > 0.3 ? 0x123a63 : 0x2a5f8a;
          m.material = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
        } else {
          const src = m.material as THREE.MeshStandardMaterial;
          m.material = new THREE.MeshLambertMaterial({
            color: src.color ? src.color.clone().multiplyScalar(0.5) : new THREE.Color(0x2a2f38),
            map: src.map ?? null,
            emissive: new THREE.Color(0x050c16),
          });
        }
      });
      this.scene.add(crt);
      this.crts.push({ obj: crt, base: crt.position.clone(), phase: rng.range(0, TAU), amp: rng.range(0.25, 0.9) });
    }

    // motherboards as broken platforms
    for (let i = 0; i < 9; i++) {
      const board = this.assets.models.board.scene.clone(true);
      const s = rng.range(12, 34);
      board.scale.setScalar(s);
      const a = rng.range(0, TAU);
      const r = rng.range(26, 96);
      const y = rng.range(2, 22);
      board.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      board.rotation.set(rng.range(-1.2, 1.2), rng.range(0, TAU), rng.range(-1.2, 1.2));
      board.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        m.material = new THREE.MeshLambertMaterial({
          color: 0x1b2b3f,
          map: src.map ?? null,
          emissive: new THREE.Color(0x0a2438),
          transparent: true,
          opacity: 0.94,
          side: THREE.DoubleSide,
        });
      });
      this.scene.add(board);
    }

    // floating UI windows
    const windows = [
      { title: "system_fault.exe", body: ["0x000000F4", "CRITICAL_OBJECT_TERMINATION", "", "the process could not be", "restored."], footer: "[ 続行 ]" },
      { title: "memory.exe", body: ["あなたの記憶は", "ここに保存されています。", "", "?> 削除しますか"], footer: "y / n" },
      { title: "WAKE_UP.dll", body: ["AWAITING COMMAND", "", "> _"], footer: "console ready" },
      { title: "user.log", body: ["02:47 入室", "02:47 電源 ON", "02:48 ??????", "03:00 まだ这里にいる"], footer: "1 of 3" },
      { title: "explorer.exe", body: ["この PC を参照できません。", "デスクトップの経路が", "破損しています。"], footer: "再試行" },
    ];
    windows.forEach((w, i) => {
      const tex = makeWindowTexture(w.title, w.body, w.footer);
      this.disposeList.push(tex);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      });
      const a = (i / windows.length) * TAU + 0.4;
      const r = 90 + rng.range(-16, 30);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(26, 17), mat);
      mesh.position.set(Math.cos(a) * r, rng.range(22, 58), Math.sin(a) * r);
      mesh.lookAt(0, mesh.position.y * 0.6, 0);
      this.scene.add(mesh);
      this.windowMeshes.push(mesh);
    });

    // drifting error text
    const lines = [
      "STOP: 0x000000F4",
      "CLOCK_WATCHDOG_TIMEOUT",
      "PAGE_FAULT_IN_NONPAGED_AREA",
      "the device is not responding",
      "SYSTEM_SERVICE_EXCEPTION",
      "戻れない",
      "IRQL_NOT_LESS_OR_EQUAL",
      "MEMORY_MANAGEMENT",
      "UNEXPECTED_KERNEL_MODE_TRAP",
      "ここは君の部屋ではない",
      "KERNEL_SECURITY_CHECK_FAILURE",
      "BAD_SYSTEM_CONFIG_INFO",
    ];
    lines.forEach((line, i) => {
      const tex = makeTextStrip(line, i % 2 ? "#7fc4ff" : "#ffffff");
      this.disposeList.push(tex);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const a = rng.range(0, TAU);
      const r = rng.range(14, 74);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(rng.range(6, 12), rng.range(0.56, 1.12)), mat);
      mesh.position.set(Math.cos(a) * r, rng.range(2.4, 18), Math.sin(a) * r);
      mesh.lookAt(0, mesh.position.y, 0);
      this.scene.add(mesh);
      this.strips.push({ mesh, base: mesh.position.clone(), phase: rng.range(0, TAU), speed: rng.range(0.2, 0.9) });
    });

    // scrolling log monoliths
    for (let i = 0; i < 5; i++) {
      const rows: string[] = [];
      for (let j = 0; j < 36; j++) {
        rows.push(`${(0x1000 + Math.floor(rng.next() * 0xefff)).toString(16).toUpperCase()}  ${rng.next() > 0.5 ? "NULL" : "0x00"}  ${["USER32", "NTOSKRNL", "NULL_STUDIO", "HAL", "WIN32K"][j % 5]}`);
      }
      const tex = makeScrollTexture(rows);
      this.disposeList.push(tex);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const a = rng.range(0, TAU);
      const r = rng.range(40, 96);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 18), mat);
      mesh.position.set(Math.cos(a) * r, rng.range(9, 24), Math.sin(a) * r);
      mesh.lookAt(0, mesh.position.y, 0);
      this.scene.add(mesh);
    }

    // a trail of glowing glyphs that leads to the monolith
    const glyphs = [":(", "0", "1", ";", "/", "_", "#"];
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      const a = this.spawnYaw + Math.PI + Math.sin(t * 2.4) * 0.55;
      const r = lerp(52, 13, t);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const tex = makeGlyphTexture(glyphs[i % glyphs.length]);
      this.disposeList.push(tex);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.5 - t * 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), mat);
      m.position.set(x, terrainHeight(x, z) + 0.25, z);
      m.rotation.x = -Math.PI / 2 + 0.2;
      m.rotation.y = i * 0.4;
      this.glyphTrail.push(m);
      this.scene.add(m);
    }

    // ambient shards
    const geo = new THREE.TetrahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0x8fd4ff, transparent: true, opacity: 0.5, toneMapped: false });
    this.shards = new THREE.InstancedMesh(geo, mat, 420);
    this.shards.frustumCulled = false;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 420; i++) {
      const a = rng.range(0, TAU);
      const r = rng.range(6, 120);
      const p = new THREE.Vector3(Math.cos(a) * r, rng.range(-2, 46), Math.sin(a) * r);
      this.shardData.push({ p, sp: rng.range(0.15, 1.4), phase: rng.range(0, TAU), rot: rng.range(0, TAU) });
      m4.makeTranslation(p.x, p.y, p.z);
      this.shards.setMatrixAt(i, m4);
    }
    this.scene.add(this.shards);
    this.disposeList.push(geo, mat);
  }

  /* ------------------------------------------------------------------ */
  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x2c5c96, 0x040810, 1.15));

    this.coreLight = new THREE.PointLight(0x6fc3ff, 90, 90, 2);
    this.coreLight.position.set(0, 8, 0);
    this.scene.add(this.coreLight);

    this.rimLight = new THREE.PointLight(0x2f6fd0, 45, 70, 2);
    this.rimLight.position.set(-14, 10, 16);
    this.scene.add(this.rimLight);

    const back = new THREE.PointLight(0x9a5cff, 26, 60, 2);
    back.position.set(18, 9, -22);
    this.scene.add(back);
  }

  private buildDebris() {
    const geo = new THREE.TetrahedronGeometry(0.55, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x16283c, emissive: new THREE.Color(0x0a2c50) });
    const mesh = new THREE.InstancedMesh(geo, mat, 160);
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.scene.add(mesh);
    this.disposeList.push(geo, mat);
    this.debris = { mesh, items: [], active: false };
  }

  /* ------------------------------------------------------------------ */
  /** Kick off falling chunks around a point (used when the floor breaks). */
  spawnDebris(count: number, center: THREE.Vector3, radius: number) {
    if (!this.debris) return;
    const rng = new Rng(999);
    this.debris.items = [];
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, TAU);
      const r = rng.range(radius * 0.25, radius);
      this.debris.items.push({
        p: new THREE.Vector3(center.x + Math.cos(a) * r, center.y + rng.range(-0.2, 0.2), center.z + Math.sin(a) * r),
        v: new THREE.Vector3(Math.cos(a) * rng.range(0.4, 2.2), rng.range(0.2, 1.6), Math.sin(a) * rng.range(0.4, 2.2)),
        r: new THREE.Vector3(rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)),
        rv: new THREE.Vector3(rng.range(-2.5, 2.5), rng.range(-2.5, 2.5), rng.range(-2.5, 2.5)),
        s: rng.range(0.3, 1.5),
      });
    }
    this.debris.mesh.visible = true;
    this.debris.active = true;
  }

  private updateDebris(dt: number) {
    const d = this.debris;
    if (!d || !d.active) return;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    for (let i = 0; i < d.mesh.count; i++) {
      const it = d.items[i];
      if (!it) {
        m4.makeScale(0, 0, 0);
        d.mesh.setMatrixAt(i, m4);
        continue;
      }
      it.v.y -= 22 * dt;
      it.p.addScaledVector(it.v, dt);
      it.r.addScaledVector(it.rv, dt);
      e.copy(it.r as unknown as THREE.Euler);
      q.setFromEuler(new THREE.Euler(it.r.x, it.r.y, it.r.z));
      s.setScalar(it.s);
      m4.compose(it.p, q, s);
      d.mesh.setMatrixAt(i, m4);
      if (it.p.y < -60) it.p.y = -60;
    }
    d.mesh.instanceMatrix.needsUpdate = true;
  }

  setHole(center: THREE.Vector3, radius: number) {
    this.hole.set(center.x, center.z);
    this.holeRadius = radius;
    const u = this.groundMat.uniforms;
    (u.uHole.value as THREE.Vector3).set(center.x, 0, center.z);
    u.uHoleRadius.value = radius;
  }

  setCrack(v: number) {
    this.crack = clamp(v, 0, 1);
    this.groundMat.uniforms.uCrack.value = this.crack;
  }

  setAnomaly(v: number) {
    this.anomaly = clamp(v, 0, 1);
  }

  setCollapse(v: number) {
    this.collapse = clamp(v, 0, 1);
  }

  /* ------------------------------------------------------------------ */
  update(dt: number, time: number, playerPos: THREE.Vector3) {
    const u = this.groundMat.uniforms;
    u.uTime.value = time;
    u.uPulse.value = this.anomaly;
    (u.uPlayer.value as THREE.Vector2).set(playerPos.x, playerPos.z);
    this.sky.position.copy(playerPos).setY(0);

    // slow anomaly breathing
    this.anomalyTimer -= dt;
    if (this.anomalyTimer <= 0) {
      this.anomalyTimer = 15 + Math.random() * 13;
      this.anomaly = 1;
    }
    if (this.anomaly > 0) this.anomaly = Math.max(0, this.anomaly - dt * 0.7);

    // core pulse (heartbeat)
    const beat = Math.pow(Math.max(0, Math.sin(time * 1.15)), 14);
    this.coreLight.intensity = 70 + beat * 60 + this.anomaly * 60 + this.collapse * 90;
    this.rimLight.intensity = 32 + Math.sin(time * 0.7) * 10 + this.anomaly * 30;
    if (this.beam) {
      const mat = this.beam.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.1 + beat * 0.14 + this.anomaly * 0.15;
    }
    for (const m of this.shaftMats) m.opacity = 0.07 + Math.sin(time * 0.35) * 0.03 + this.anomaly * 0.1;

    // rings
    this.rings.forEach((r, i) => {
      r.rotation.z += dt * (0.05 + i * 0.02) * (1 + this.collapse);
      r.rotation.x = Math.PI / 2 + Math.sin(time * 0.2 + i) * 0.3;
      (r.material as THREE.MeshBasicMaterial).opacity = 0.35 + beat * 0.3;
    });

    // floating text
    for (const s of this.strips) {
      s.mesh.position.y = s.base.y + Math.sin(time * s.speed + s.phase) * 0.9;
      s.mesh.position.x = s.base.x + Math.cos(time * s.speed * 0.7 + s.phase) * 0.5;
      s.mesh.rotation.z = Math.sin(time * 0.3 + s.phase) * 0.04;
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.32 + 0.2 * Math.sin(time * 1.3 + s.phase) + this.anomaly * 0.3;
    }

    // drifting CRTs
    for (const c of this.crts) {
      c.obj.position.y = c.base.y + Math.sin(time * 0.55 + c.phase) * c.amp;
      c.obj.rotation.y += dt * 0.05;
      c.obj.rotation.z = Math.sin(time * 0.4 + c.phase) * 0.05;
      const glass = c.obj.children.length ? null : null;
      void glass;
    }

    // shards
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (let i = 0; i < this.shardData.length; i++) {
      const d = this.shardData[i];
      d.p.y += d.sp * dt * (0.4 + this.collapse * 2);
      if (d.p.y > 52) d.p.y = -3;
      q.setFromEuler(new THREE.Euler(time * 0.2 + d.rot, time * 0.15 + d.phase, d.phase));
      s.setScalar(0.25 + Math.sin(time + d.phase) * 0.06);
      m4.compose(d.p, q, s);
      this.shards.setMatrixAt(i, m4);
    }
    this.shards.instanceMatrix.needsUpdate = true;
    (this.shards.material as THREE.MeshBasicMaterial).opacity = 0.35 + this.anomaly * 0.4;

    // glyph trail breathing
    this.glyphTrail.forEach((g, i) => {
      g.position.y = terrainHeight(g.position.x, g.position.z) + 0.28 + Math.sin(time * 1.4 + i) * 0.06;
      g.rotation.z = Math.sin(time * 0.6 + i * 0.7) * 0.12;
    });

    // windows drift
    this.windowMeshes.forEach((w, i) => {
      w.position.y += Math.sin(time * 0.25 + i) * dt * 0.4;
      (w.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.2 * Math.sin(time * 0.6 + i * 1.3) + this.anomaly * 0.25;
    });

    this.updateDebris(dt);
    void this.hole;
    void this.holeRadius;
    void this.crack;
  }

  /* ------------------------------------------------------------------ */
  readonly surface = {
    ground: (x: number, z: number) => terrainHeight(x, z),
    resolve: (x: number, z: number, radius: number, fromX?: number, fromZ?: number) => {
      const push = (px: number, pz: number) => {
        let ox = px;
        let oz = pz;
        for (let pass = 0; pass < 3; pass++) {
          let moved = false;
          for (const c of this.colliders) {
            const dx = ox - c.x;
            const dz = oz - c.z;
            const d = Math.hypot(dx, dz);
            const min = c.r + radius;
            if (d < min && d > 1e-5) {
              ox = c.x + (dx / d) * min;
              oz = c.z + (dz / d) * min;
              moved = true;
            }
          }
          if (!moved) break;
        }
        return { x: ox, z: oz };
      };
      const hits = (px: number, pz: number) =>
        this.colliders.some((c) => Math.hypot(px - c.x, pz - c.z) < c.r + radius - 1e-5);

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
      const rr = Math.hypot(out.x, out.z);
      const maxR = 118;
      if (rr > maxR) {
        out.x = (out.x / rr) * maxR;
        out.z = (out.z / rr) * maxR;
      }
      return out;
    },
  };

  checkWake(playerPos: THREE.Vector3) {
    if (this.wakeSeen) return false;
    const d = Math.hypot(playerPos.x - this.plaque.x, playerPos.z - this.plaque.z);
    if (d < 13) {
      this.wakeSeen = true;
      return true;
    }
    return false;
  }

  getDistanceToCore(p: THREE.Vector3) {
    return Math.hypot(p.x, p.z);
  }

  get anomalyLevel() {
    return this.anomaly;
  }

  reset() {
    this.wakeSeen = false;
    this.collapse = 0;
    this.crack = 0;
    this.anomaly = 0;
    this.anomalyTimer = 16;
    this.holeRadius = 0;
    this.setCrack(0);
    this.setHole(new THREE.Vector3(0, 0, 0), 0);
    if (this.debris) {
      this.debris.active = false;
      this.debris.items = [];
      this.debris.mesh.visible = false;
    }
  }

  dispose() {
    for (const d of this.disposeList) d.dispose();
    this.disposeList.length = 0;
  }
}

export const smoothClamp = (v: number) => saturate(v);
export const tweenHelper = { damp, smoothstep, hash2 };
