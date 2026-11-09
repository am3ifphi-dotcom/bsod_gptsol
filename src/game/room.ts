/* Night bedroom — the real room, built from GitHub-hosted GLBs + procedural props. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeWoodTexture, makeCrackTexture, makeDialogTexture, makeDotTexture } from './textures';

export interface RoomColliders {
  boxes: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  circles: { x: number; z: number; r: number }[];
}

export interface RoomBuild {
  group: THREE.Group;
  /** world-space pose for the examine camera */
  screenNode: THREE.Object3D;
  screenPlane: THREE.Mesh;
  screenCenter: THREE.Vector3;
  screenNormal: THREE.Vector3;
  examinePos: THREE.Vector3;
  examineLook: THREE.Vector3;
  pcGlow: THREE.PointLight;
  lampLight: THREE.PointLight;
  moonLight: THREE.DirectionalLight;
  roomFill: THREE.HemisphereLight;
  ceilingLight: THREE.PointLight;
  stool: THREE.Object3D | null;
  bedsideCrt: THREE.Group;
  bedsideScreen: THREE.Mesh;
  crystals: THREE.Mesh[];
  crackDecals: THREE.Mesh[];
  dust: THREE.Points;
  colliders: RoomColliders;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  spawn: { pos: THREE.Vector3; yaw: number };
  /** set true after the player returns from the glitch world */
  aftermath: boolean;
}

const ROOM_BOUNDS = { minX: -1.72, maxX: 2.4, minZ: -2.72, maxZ: 1.34 };

function computeBBox(obj: THREE.Object3D) {
  const box = new THREE.Box3();
  obj.updateWorldMatrix(true, true);
  box.setFromObject(obj);
  return box;
}

export async function buildRoom(): Promise<RoomBuild> {
  const loader = new GLTFLoader();
  const load = (path: string) =>
    new Promise<THREE.Group>((resolve, reject) => {
      loader.load(path, (g) => resolve(g.scene as THREE.Group), undefined, reject);
    });

  const group = new THREE.Group();
  group.name = 'room';

  /* ---------- the bedroom shell from GLB ---------- */
  const bedroom = await load('/models/bedroom.glb');
  bedroom.position.set(0, 0.05, 0);
  group.add(bedroom);

  /* ---------- chabudai (low gaming table, procedural wood) ---------- */
  const wood = makeWoodTexture();
  wood.colorSpace = THREE.SRGBColorSpace;
  const woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.62, metalness: 0.06 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x2b1a12, roughness: 0.7, metalness: 0.05 });
  const table = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.05, 0.74), woodMat);
  top.position.y = 0.36;
  top.castShadow = true;
  top.receiveShadow = true;
  table.add(top);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.07, 0.58), darkWood);
  apron.position.y = 0.315;
  table.add(apron);
  const legGeo = new THREE.BoxGeometry(0.075, 0.34, 0.075);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, darkWood);
    leg.position.set(sx * 0.56, 0.17, sz * 0.28);
    leg.castShadow = true;
    table.add(leg);
  }
  table.position.set(-0.72, 0, -0.18);
  group.add(table);

  /* ---------- gaming battlestation GLB on the chabudai ---------- */
  const rig = await load('/models/gaming_pc.glb');
  // normalize: keyboard reference length 4.07 units ≈ 0.42 m
  const unit = 0.42 / 4.07;
  rig.scale.setScalar(unit);
  rig.rotation.y = Math.PI * 0.25; // model is authored diagonal; straighten to face +X later
  rig.position.set(-0.74, 0.385, -0.2);
  // after loading we re-rotate below once we know the screen normal
  group.add(rig);
  rig.updateWorldMatrix(true, true);

  let screenNode: THREE.Object3D | null = null;
  rig.traverse((o) => {
    if (o.name === 'BSOD_SCREEN_NODE') screenNode = o;
  });
  if (!screenNode) throw new Error('BSOD_SCREEN_NODE not found in gaming_pc.glb');

  // rotate rig so the screen faces +X (east, toward the rug)
  rig.updateWorldMatrix(true, true);
  const screenBox = computeBBox(screenNode);
  const screenCenter0 = screenBox.getCenter(new THREE.Vector3());
  // current screen normal ≈ local +X of the node in world space
  const nx = new THREE.Vector3(1, 0, 0).applyQuaternion((screenNode as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion())).normalize();
  const desired = new THREE.Vector3(1, 0, 0);
  const angle = Math.atan2(nx.z, nx.x) - Math.atan2(desired.z, desired.x);
  rig.rotation.y += angle;
  rig.updateWorldMatrix(true, true);

  const screenBox2 = computeBBox(screenNode);
  const screenCenter = screenBox2.getCenter(new THREE.Vector3());
  const screenSize = screenBox2.getSize(new THREE.Vector3());
  const screenNormal = new THREE.Vector3(1, 0, 0); // after the fix-up, normal ≈ +X
  // refine normal from node rotation
  screenNormal.set(1, 0, 0).applyQuaternion((screenNode as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion())).normalize();
  screenNormal.y = 0;
  screenNormal.normalize();

  // plate the BSOD emissive plane over the model's screen node
  const planeW = Math.max(screenSize.z, screenSize.x) * 0.86;
  const planeH = screenSize.y * 0.82;
  const screenPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(planeW, planeH),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false })
  );
  const planeOffset = screenSize.x / 2 + 0.006;
  screenPlane.position.copy(screenCenter).addScaledVector(screenNormal, planeOffset);
  screenPlane.lookAt(screenPlane.position.clone().add(screenNormal));
  screenPlane.name = 'bsod_screen';
  group.add(screenPlane);

  const examineLook = screenCenter.clone();
  const examinePos = screenCenter.clone().addScaledVector(screenNormal, 0.66);
  examinePos.y = screenCenter.y + 0.035;

  /* ---------- BSOD PC glow & room lighting ---------- */
  const pcGlow = new THREE.PointLight(0x2f7fe0, 7.5, 3.6, 1.7);
  pcGlow.position.copy(screenCenter).addScaledVector(screenNormal, 0.34);
  pcGlow.position.y += 0.05;
  group.add(pcGlow);

  const roomFill = new THREE.HemisphereLight(0x36435e, 0x0e0a07, 0.95);
  group.add(roomFill);

  const moonLight = new THREE.DirectionalLight(0x8fb6ff, 1.15);
  moonLight.position.set(6.5, 4.2, -3.4); // through the east window
  moonLight.target.position.set(-1.2, 0.2, 0.6);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(1024, 1024);
  moonLight.shadow.camera.left = -4;
  moonLight.shadow.camera.right = 4;
  moonLight.shadow.camera.top = 4;
  moonLight.shadow.camera.bottom = -4;
  moonLight.shadow.camera.far = 16;
  moonLight.shadow.bias = -0.0004;
  group.add(moonLight, moonLight.target);

  const ceilingLight = new THREE.PointLight(0xffd9a6, 14, 8, 1.6);
  ceilingLight.position.set(-0.4, 2.6, -0.4);
  group.add(ceilingLight);

  /* ---------- deskside lamp (warm, flickers) ---------- */
  const lampGroup = new THREE.Group();
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.35, metalness: 0.85 });
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.03, 20), lampMat);
  lampBase.position.y = 0.015;
  lampGroup.add(lampBase);
  const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 10), lampMat);
  lampStem.position.y = 0.2;
  lampGroup.add(lampStem);
  const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.11, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x242b35, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide }));
  lampShade.position.y = 0.39;
  lampGroup.add(lampShade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }));
  bulb.position.y = 0.355;
  lampGroup.add(bulb);
  lampGroup.position.set(-1.58, 0.545, -2.24); // west end of the bedside dresser
  group.add(lampGroup);

  const lampLight = new THREE.PointLight(0xffc98a, 8.5, 4.5, 1.7);
  lampLight.position.set(-1.58, 0.92, -2.24);
  group.add(lampLight);

  /* ---------- dead CRT on the bedside dresser ---------- */
  const crt = await load('/models/crt_monitor.glb');
  crt.position.set(0.72, 0.545, -2.25);
  crt.rotation.y = 0.18;
  group.add(crt);
  const crtBox = computeBBox(crt);
  const crtCenter = crtBox.getCenter(new THREE.Vector3());
  const crtSize = crtBox.getSize(new THREE.Vector3());
  // dark glass plane (flicker switch handled by engine)
  const bedsideScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(crtSize.x * 0.72, crtSize.y * 0.52),
    new THREE.MeshBasicMaterial({ color: 0x05070c, toneMapped: false, fog: false })
  );
  bedsideScreen.position.set(crtCenter.x, crtCenter.y + crtSize.y * 0.06, crtCenter.z + crtSize.z / 2 + 0.004);
  bedsideScreen.rotation.y = 0.18;
  group.add(bedsideScreen);

  /* ---------- aftermath props (hidden until return) ---------- */
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x59d8ff,
    emissive: 0x1fa8d8,
    emissiveIntensity: 2.4,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.92,
  });
  const crystals: THREE.Mesh[] = [];
  const crystalGeo = new THREE.OctahedronGeometry(0.055);
  const crystalSpots: [number, number, number, number][] = [
    [-0.55, 0.415, -0.28, 0.7],   // on the chabudai
    [0.35, 0.055, 0.42, 1.4],     // on the rug
    [0.72, 0.62, -2.25, 1.1],     // leaning on the dead CRT
  ];
  for (const [x, y, z, s] of crystalSpots) {
    const m = new THREE.Mesh(crystalGeo, crystalMat);
    m.position.set(x, y, z);
    m.scale.set(s, s * 1.9, s);
    m.rotation.set(0.3, x * 7, 0.24);
    m.visible = false;
    crystals.push(m);
    group.add(m);
  }

  /* ---------- crack decals (devoured build-up on the table / walls) ---------- */
  const crackTex = makeCrackTexture('room-crack');
  const crackMat = new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x69e4ff, opacity: 0 });
  const tableCrack = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), crackMat);
  tableCrack.rotation.x = -Math.PI / 2;
  tableCrack.position.set(-0.72, 0.386, -0.18);
  tableCrack.renderOrder = 5;
  group.add(tableCrack);
  const crackDecals = [tableCrack];

  /* ---------- floating error dialog, duct-taped to the wall ---------- */
  const dialogTex = makeDialogTexture('wall-dialog', '致命的なエラー', 'このPCは正常に動作していません。 ただちに 使用を中止してください');
  const dialog = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.2625),
    new THREE.MeshStandardMaterial({ map: dialogTex, roughness: 0.85, metalness: 0 })
  );
  dialog.position.set(2.36, 1.62, -1.3); // east wall
  dialog.rotation.y = -Math.PI / 2 + 0.06;
  group.add(dialog);

  /* ---------- dust motes ---------- */
  const dustCount = 170;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = -1.6 + Math.random() * 3.8;
    dustPos[i * 3 + 1] = 0.15 + Math.random() * 2.3;
    dustPos[i * 3 + 2] = -2.5 + Math.random() * 3.7;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ map: makeDotTexture(), color: 0xbfd8ff, size: 0.02, transparent: true, opacity: 0.5, depthWrite: false })
  );
  group.add(dust);

  /* ---------- colliders ---------- */
  const colliders: RoomColliders = {
    boxes: [
      { minX: -1.7, maxX: 1.5, minZ: -3.1, maxZ: -0.62 }, // bed + bedside dresser
      { minX: -1.42, maxX: -0.08, minZ: -0.6, maxZ: 0.24 }, // chabudai
      { minX: 1.98, maxX: 2.62, minZ: 0.42, maxZ: 0.98 }, // mobile storage box
    ],
    circles: [
      { x: 1.94, z: -0.96, r: 0.34 },   // stool
      { x: 2.37, z: 0.82, r: 0.42 },    // plants
    ],
  };

  const spawn = {
    pos: new THREE.Vector3(0.92, 0, 0.96),
    yaw: Math.atan2(-0.74 - 0.92, -0.2 - 0.96) + Math.PI, // faced toward the rig at start
  };
  // yaw: camera forward = (-sin yaw, -cos yaw); solve toward the rig
  const toRig = new THREE.Vector3(-0.74 - 0.92, 0, -0.2 - 0.96).normalize();
  spawn.yaw = Math.atan2(-toRig.x, -toRig.z);

  return {
    group,
    screenNode: screenNode as THREE.Object3D,
    screenPlane,
    screenCenter,
    screenNormal,
    examinePos,
    examineLook,
    pcGlow,
    lampLight,
    moonLight,
    roomFill,
    ceilingLight,
    stool: bedroom.getObjectByName('stool_Stool_0') ?? null,
    bedsideCrt: crt,
    bedsideScreen,
    crystals,
    crackDecals,
    dust,
    colliders,
    bounds: ROOM_BOUNDS,
    spawn,
    aftermath: false,
  };
}

/** Rotate stool out, bloom crystals, leave residual static. Called on return. */
export function applyAftermath(room: RoomBuild) {
  room.aftermath = true;
  if (room.stool) {
    room.stool.rotation.y += 1.85;
    room.stool.position.x += 0.34;
    room.stool.position.z += 0.22;
  }
  for (const c of room.crystals) c.visible = true;
  for (const d of room.crackDecals) (d.material as THREE.MeshBasicMaterial).opacity = 0.16;
}
