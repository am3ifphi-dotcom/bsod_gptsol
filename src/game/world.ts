/* The fatal-error realm — a walkable BSOD. Beautiful, vast, wrong. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  fbm2,
  makeCircuitGridTexture,
  makeGlyphColumnTexture,
  makeDialogTexture,
  makeRuneRingTexture,
  makeWakeTextTexture,
  makeCrackTexture,
  makeDotTexture,
  seededRandom,
} from './textures';

export interface WorldBuild {
  group: THREE.Group;
  /** distance from world center where WAKE_UP becomes readable */
  revealRadius: number;
  center: THREE.Vector3;
  cray: THREE.Group;
  daisCore: THREE.Mesh;
  daisRing: THREE.Mesh;
  wakeSign: THREE.Mesh;
  halo: THREE.Mesh;
  wakeLight: THREE.PointLight;
  redBeacon: THREE.SpotLight;
  crack: THREE.Mesh;
  shards: THREE.Mesh[];
  fallers: THREE.Mesh[];
  colliders: { x: number; z: number; r: number }[];
  boxColliders: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  boundsRadius: number;
  spawn: { pos: THREE.Vector3; yaw: number };
  surgeTimer: number;
  floatingGlyphs: THREE.Mesh[];
  rackLEDs: THREE.MeshStandardMaterial[];
}

const WORLD_RADIUS = 66;

export async function buildWorld(): Promise<WorldBuild> {
  const loader = new GLTFLoader();
  const load = (path: string) =>
    new Promise<THREE.Group>((resolve, reject) => {
      loader.load(path, (g) => resolve(g.scene as THREE.Group), undefined, reject);
    });

  const group = new THREE.Group();
  group.name = 'glitchworld';
  const rnd = seededRandom('world-seed');

  /* ---------- lights & fog ---------- */
  const hemi = new THREE.HemisphereLight(0x2b4a77, 0x02040a, 0.75);
  group.add(hemi);
  const moon = new THREE.DirectionalLight(0x9fd0ff, 0.65);
  moon.position.set(-18, 32, 9);
  group.add(moon);
  const rimCyan = new THREE.PointLight(0x1ec8ff, 30, 60, 1.8);
  rimCyan.position.set(16, 6, -14);
  group.add(rimCyan);
  const rimMagenta = new THREE.PointLight(0xb44bff, 18, 55, 1.8);
  rimMagenta.position.set(-19, 8, 12);
  group.add(rimMagenta);
  const amber = new THREE.PointLight(0xff9a3c, 10, 40, 1.9);
  amber.position.set(4, 2.5, 17);
  group.add(amber);

  /* ---------- terrain: displaced disc ---------- */
  const TER = 140;
  const terrainGeo = new THREE.CircleGeometry(WORLD_RADIUS + 14, 128, 0, Math.PI * 2);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const d = Math.sqrt(x * x + z * z);
    const dune = (fbm2(x * 0.055 + 9, z * 0.055 + 3, 4) - 0.5) * 2.6;
    const ridge = Math.pow(fbm2(x * 0.016 + 40, z * 0.016 + 8, 3), 2.2) * 9.5;
    const rim = THREE.MathUtils.smoothstep(d, WORLD_RADIUS * 0.72, WORLD_RADIUS + 10);
    const bowl = THREE.MathUtils.smoothstep(d, 4.5, 15);
    const h = dune * bowl + ridge * rim - rim * 2.5;
    posAttr.setY(i, h);
  }
  terrainGeo.computeVertexNormals();
  const circuit = makeCircuitGridTexture();
  circuit.wrapS = circuit.wrapT = THREE.RepeatWrapping;
  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0x10305c,
    emissive: 0x0a2b52,
    emissiveMap: circuit,
    emissiveIntensity: 0.85,
    roughness: 0.94,
    metalness: 0.15,
  });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  group.add(terrain);

  /* ---------- the dais: outer ring + crackable core ---------- */
  const daisY = 0.16;
  const daisRing = new THREE.Mesh(
    new THREE.CylinderGeometry(9.4, 10.6, 1.15, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x0d2547, emissive: 0x123c66, emissiveIntensity: 0.7, roughness: 0.6, metalness: 0.55, side: THREE.DoubleSide })
  );
  daisRing.position.y = daisY - 0.42;
  group.add(daisRing);
  const daisTop = new THREE.Mesh(
    new THREE.RingGeometry(3.2, 9.4, 48),
    new THREE.MeshStandardMaterial({ color: 0x11294a, emissive: 0x0e2f55, emissiveIntensity: 0.9, roughness: 0.5, metalness: 0.6 })
  );
  daisTop.rotation.x = -Math.PI / 2;
  daisTop.position.y = daisY + 0.155;
  group.add(daisTop);
  const daisCore = new THREE.Mesh(
    new THREE.CircleGeometry(3.3, 40),
    new THREE.MeshStandardMaterial({ color: 0x16345c, emissive: 0x144a7a, emissiveIntensity: 1.15, roughness: 0.4, metalness: 0.7 })
  );
  daisCore.rotation.x = -Math.PI / 2;
  daisCore.position.y = daisY + 0.155;
  group.add(daisCore);
  // rune halo on the outer rim
  const runeTex = makeRuneRingTexture();
  const halo = new THREE.Mesh(
    new THREE.CylinderGeometry(9.4, 9.4, 0.62, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: runeTex, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, color: 0x86f0ff, toneMapped: false, fog: false })
  );
  halo.position.y = daisY + 0.1;
  group.add(halo);

  /* ---------- crack decal on the dais (hidden until collapse) ---------- */
  const crack = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 6.4),
    new THREE.MeshBasicMaterial({ map: makeCrackTexture('dais'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x9df2ff, toneMapped: false, fog: false })
  );
  crack.rotation.x = -Math.PI / 2;
  crack.rotation.z = 0.4;
  crack.position.y = daisY + 0.17;
  crack.renderOrder = 6;
  group.add(crack);

  /* ---------- THE structure: a Cray-1, colossal ---------- */
  const cray = await load('/models/cray1.glb');
  cray.scale.setScalar(11.5);
  cray.position.set(0, daisY + 0.16, 0);
  cray.rotation.y = Math.PI * 0.22;
  group.add(cray);
  const crayGlow = new THREE.PointLight(0x3fd8ff, 26, 26, 1.7);
  crayGlow.position.set(0, 13, 0);
  group.add(crayGlow);

  /* ---------- floating monoliths in a ring ---------- */
  const monolithGeo = new THREE.BoxGeometry(1.5, 6.2, 0.9);
  const monolithMat = new THREE.MeshStandardMaterial({ color: 0x0a1a30, emissive: 0x0d3d63, emissiveIntensity: 1.5, roughness: 0.35, metalness: 0.7 });
  const crackTexMono = makeCrackTexture('monolith');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const r = 15.5 + (i % 2) * 2.2;
    const mono = new THREE.Mesh(monolithGeo, monolithMat);
    mono.position.set(Math.cos(a) * r, 4.2 + (i % 3) * 1.3, Math.sin(a) * r);
    mono.rotation.y = -a + Math.PI / 2;
    mono.rotation.z = (rnd() - 0.5) * 0.14;
    group.add(mono);
    // glowing rune strip on each monolith
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 4.6),
      new THREE.MeshBasicMaterial({ map: crackTexMono, transparent: true, blending: THREE.AdditiveBlending, color: 0x5ce6ff, depthWrite: false, toneMapped: false })
    );
    strip.position.set(Math.cos(a) * (r - 0.5), mono.position.y, Math.sin(a) * (r - 0.5));
    strip.lookAt(0, mono.position.y, 0);
    group.add(strip);
  }

  /* ---------- server racks in two arcs ---------- */
  const rackLEDs: THREE.MeshStandardMaterial[] = [];
  const rackRows: [number, number][] = [
    [-26, -8], [26, -8],
  ];
  for (const [side, zOff] of rackRows) {
    for (let i = -2; i <= 2; i++) {
      const rack = await load('/models/server_rack.glb');
      rack.scale.setScalar(1.55);
      const x = side + i * 2.6;
      const z = zOff + Math.abs(i) * 1.6;
      rack.position.set(x, terrainHeightAt(x, z), z);
      rack.rotation.y = side < 0 ? Math.PI / 2.6 : -Math.PI / 2.6;
      group.add(rack);
      // add an LED strip mesh so engine can blink it
      const ledMat = new THREE.MeshStandardMaterial({ color: 0x061018, emissive: 0x18ff9a, emissiveIntensity: 2.6, roughness: 0.4 });
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.03), ledMat);
      led.position.set(0, 1.35, side < 0 ? 0.72 : 0.72);
      rack.add(led);
      rackLEDs.push(ledMat);
    }
  }

  /* ---------- floating motherboard strata ---------- */
  for (let i = 0; i < 4; i++) {
    const mb = await load('/models/motherboard.glb');
    mb.scale.setScalar(9 + i * 3.2);
    const a = rnd() * Math.PI * 2;
    const r = 18 + rnd() * 18;
    mb.position.set(Math.cos(a) * r, 6.5 + rnd() * 6, Math.sin(a) * r);
    mb.rotation.set(rnd() * 0.7 - 0.35, rnd() * Math.PI * 2, rnd() * 0.5 - 0.25);
    group.add(mb);
  }

  /* ---------- great arcs of cable suspended in the void ---------- */
  const cableBig = await load('/models/cables.glb');
  for (let i = 0; i < 5; i++) {
    const cable = cableBig.clone();
    cable.scale.setScalar(0.055 + rnd() * 0.02);
    const a = (i / 5) * Math.PI * 2 + 0.5;
    const r = 34 + rnd() * 16;
    cable.position.set(Math.cos(a) * r, 12 + rnd() * 9, Math.sin(a) * r);
    cable.rotation.set(rnd() * 1.2 - 0.6, rnd() * Math.PI * 2, rnd() * 1.4 - 0.7);
    group.add(cable);
  }

  /* ---------- the office chair, eternally orbiting ---------- */
  const chair = await load('/models/office_chair.glb');
  chair.scale.setScalar(2.4);
  chair.position.set(0, 26, 0);
  chair.name = 'void_chair';
  group.add(chair);

  /* ---------- floating error dialogs & glyph columns ---------- */
  const dialogSeeds: [string, string, string][] = [
    ['dlg-1', '致命的なエラー', 'オペレーティングシステムは動作を停止しました'],
    ['dlg-2', '回復', 'PCの再起動を待つか、電源を切ってください'],
    ['dlg-3', '警告', 'この操作は取り消すことができません'],
    ['dlg-4', 'SYSTEM', 'MEMORY_MANAGEMENT 障害が発生しました'],
    ['dlg-5', '停止', 'CRITICAL_PROCESS_DIED 収集中です'],
  ];
  const floatingGlyphs: THREE.Mesh[] = [];
  dialogSeeds.forEach(([seed, title, msg], i) => {
    const tex = makeDialogTexture(seed, title, msg);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.62),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, toneMapped: false, opacity: 0.92 })
    );
    const a = (i / dialogSeeds.length) * Math.PI * 2 + 0.9;
    m.position.set(Math.cos(a) * (13 + i * 4.2), 2.6 + (i * 1.7) % 5.5, Math.sin(a) * (13 + i * 4.2));
    m.rotation.y = -a + Math.PI / 2 + (rnd() - 0.5);
    group.add(m);
    floatingGlyphs.push(m);
  });
  for (let i = 0; i < 26; i++) {
    const hue = (['cyan', 'amber', 'red', 'white'] as const)[Math.floor(rnd() * 4)];
    const tex = makeGlyphColumnTexture('glyph-' + i, hue);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 3.4),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.85 })
    );
    const a = rnd() * Math.PI * 2;
    const r = 9 + rnd() * 42;
    m.position.set(Math.cos(a) * r, 1.6 + rnd() * 6.5, Math.sin(a) * r);
    m.rotation.y = rnd() * Math.PI * 2;
    group.add(m);
    floatingGlyphs.push(m);
  }

  /* ---------- instanced shard rain (ambient debris) ---------- */
  const shardGeo = new THREE.TetrahedronGeometry(0.16);
  const shardMat = new THREE.MeshStandardMaterial({ color: 0x1b4a7a, emissive: 0x1e6fa8, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.6, flatShading: true });
  const shardInst = new THREE.InstancedMesh(shardGeo, shardMat, 130);
  const dummy = new THREE.Object3D();
  const shardBase: { x: number; y: number; z: number; s: number; ph: number }[] = [];
  for (let i = 0; i < 130; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 4 + rnd() * 48;
    const y = 0.6 + rnd() * 11;
    shardBase.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, s: 0.5 + rnd() * 2.4, ph: rnd() * Math.PI * 2 });
    dummy.position.set(shardBase[i].x, y, shardBase[i].z);
    dummy.scale.setScalar(shardBase[i].s);
    dummy.updateMatrix();
    shardInst.setMatrixAt(i, dummy.matrix);
  }
  shardInst.instanceMatrix.needsUpdate = true;
  group.add(shardInst);

  /* ---------- the WAKE_UP revelation (hidden until close) ---------- */
  const wakeTex = makeWakeTextTexture();
  const wakeSign = new THREE.Mesh(
    new THREE.PlaneGeometry(9.2, 2.3),
    new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false, opacity: 0 })
  );
  wakeSign.position.set(0, 7.2, 0);
  group.add(wakeSign);
  const wakeLight = new THREE.PointLight(0x6df2ff, 0, 30, 1.6);
  wakeLight.position.set(0, 6, 0);
  group.add(wakeLight);

  /* ---------- collapse: floor dais shard meshes (hidden until needed) ---------- */
  const fallers: THREE.Mesh[] = [];
  const fallerMat = new THREE.MeshStandardMaterial({ color: 0x16305a, emissive: 0x0e4a75, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.65, flatShading: true });
  const fallerGeo = new THREE.TetrahedronGeometry(0.62, 0);
  for (let i = 0; i < 44; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.6) * 3.1;
    const m = new THREE.Mesh(fallerGeo, fallerMat);
    m.position.set(Math.cos(a) * r, daisY + 0.1, Math.sin(a) * r);
    m.scale.set(0.5 + rnd() * 1.5, 0.3 + rnd() * 0.75, 0.5 + rnd() * 1.5);
    m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    m.visible = false;
    m.userData.vel = new THREE.Vector3();
    m.userData.angVel = new THREE.Vector3();
    group.add(m);
    fallers.push(m);
  }

  /* ---------- falling streak particles (activated during descent) ---------- */
  const streakTex = makeDotTexture();
  const streakCount = 240;
  const streakPos = new Float32Array(streakCount * 3);
  for (let i = 0; i < streakCount; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 2 + rnd() * 30;
    streakPos[i * 3] = Math.cos(a) * r;
    streakPos[i * 3 + 1] = rnd() * 40 - 6;
    streakPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
  const streaks = new THREE.Points(
    streakGeo,
    new THREE.PointsMaterial({ map: streakTex, color: 0xaef4ff, size: 0.34, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  streaks.name = 'fall_streaks';
  group.add(streaks);

  /* ---------- red emergency beacon (collapse only) ---------- */
  const redBeacon = new THREE.SpotLight(0xff2a1e, 0, 46, 0.75, 0.5, 1.4);
  redBeacon.position.set(0, 9.5, 0);
  redBeacon.target.position.set(0, 0, 0);
  group.add(redBeacon, redBeacon.target);

  /* ---------- colliders ---------- */
  const colliders = [{ x: 0, z: 0, r: 7.35 }]; // the Cray dais
  const boxColliders: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  for (const [side, zOff] of rackRows) {
    for (let i = -2; i <= 2; i++) {
      const x = side + i * 2.6;
      const z = zOff + Math.abs(i) * 1.6;
      boxColliders.push({ minX: x - 0.72, maxX: x + 0.72, minZ: z - 0.8, maxZ: z + 0.8 });
    }
  }

  const spawn = { pos: new THREE.Vector3(0, 0.62, 27), yaw: 0 }; // forward = (0,0,-1): faces the Cray

  return {
    group,
    revealRadius: 13.2,
    center: new THREE.Vector3(0, 0, 0),
    cray,
    daisCore,
    daisRing,
    wakeSign,
    halo,
    wakeLight,
    redBeacon,
    crack,
    shards: fallers,
    fallers,
    colliders,
    boxColliders,
    boundsRadius: WORLD_RADIUS * 0.94,
    spawn,
    surgeTimer: 18,
    floatingGlyphs,
    rackLEDs,
  };
}

/** Cheap height sample matching the displacement function (for rack placement). */
export function terrainHeightAt(x: number, z: number): number {
  const d = Math.sqrt(x * x + z * z);
  const dune = (fbm2(x * 0.055 + 9, z * 0.055 + 3, 4) - 0.5) * 2.6;
  const ridge = Math.pow(fbm2(x * 0.016 + 40, z * 0.016 + 8, 3), 2.2) * 9.5;
  const rim = THREE.MathUtils.smoothstep(d, WORLD_RADIUS * 0.72, WORLD_RADIUS + 10);
  const bowl = THREE.MathUtils.smoothstep(d, 4.5, 15);
  return dune * bowl + ridge * rim - rim * 2.5;
}
