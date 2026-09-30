import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { canvasTexture, MonitorTexture, surfaceTexture } from './textures';

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoomModel {
  group: THREE.Group;
  screen: THREE.Mesh;
  monitor: MonitorTexture;
  monitorLight: THREE.PointLight;
  warmLight: THREE.PointLight;
  lampLight: THREE.SpotLight;
  backWall: THREE.Group;
  ceiling: THREE.Mesh;
  fragments: THREE.Group;
  chair: THREE.Group;
  mug: THREE.Group;
  dust: THREE.Points;
  colliders: Collider[];
  setDesktop: (value: boolean) => void;
  update: (time: number, corruption: number, returned: boolean) => void;
  reset: () => void;
}

const material = (color: THREE.ColorRepresentation, roughness = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, ...extra });

function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  mat: THREE.Material,
  rounded = false,
) {
  const geometry = rounded
    ? new RoundedBoxGeometry(...size, 2, Math.min(...size) * 0.18)
    : new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cylinder(
  parent: THREE.Object3D,
  top: number,
  bottom: number,
  height: number,
  position: [number, number, number],
  mat: THREE.Material,
  segments = 20,
) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments), mat);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cable(parent: THREE.Object3D, points: [number, number, number][], radius = 0.008) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, radius, 5, false), material('#090c10'));
  parent.add(mesh);
  return mesh;
}

function plant(parent: THREE.Object3D, x: number, y: number, z: number, scale: number) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.scale.setScalar(scale);
  parent.add(group);
  cylinder(group, 0.14, 0.1, 0.22, [0, 0.11, 0], material('#8a7765'));
  cylinder(group, 0.129, 0.129, 0.009, [0, 0.226, 0], material('#171b12'));
  const leafMat = material('#314c3d', 0.85, { side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const angle = i * 2.4;
    const length = 0.26 + (i % 3) * 0.07;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), leafMat);
    leaf.scale.set(0.045, length, 0.019);
    leaf.position.set(Math.cos(angle) * 0.08, 0.28 + length * 0.45, Math.sin(angle) * 0.08);
    leaf.rotation.set(Math.sin(angle) * 0.65, angle, Math.cos(angle) * 0.6);
    leaf.castShadow = true;
    group.add(leaf);
  }
}

function poster(parent: THREE.Object3D, x: number, y: number, width: number, height: number, type: number) {
  const texture = canvasTexture(512, 640, (ctx) => {
    ctx.fillStyle = type === 0 ? '#bcb6a6' : '#283a47';
    ctx.fillRect(0, 0, 512, 640);
    ctx.fillStyle = type === 0 ? '#243648' : '#b8c0bc';
    if (type === 0) {
      ctx.beginPath();
      ctx.arc(256, 280, 151, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#87999d';
      for (let i = 0; i < 34; i++) ctx.fillRect(104, 150 + i * 8, 303, 2);
      ctx.fillStyle = '#243648';
    } else {
      for (let i = 0; i < 12; i++) {
        ctx.strokeStyle = '#b8c0bc';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(256, 285, 35 + i * 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.textAlign = 'center';
    ctx.font = '32px Georgia';
    ctx.fillText(type === 0 ? 'BLUE HOUR' : 'S O L I T U D E', 256, 508);
    ctx.font = '12px monospace';
    ctx.fillText(type === 0 ? 'THINGS WE CANNOT SEE' : 'TRANSMISSION 004', 256, 548);
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 640, 1, 1);
    }
  });
  box(parent, [width + 0.045, height + 0.045, 0.035], [x, y, -3.978], material('#171f28'));
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material('#ffffff', 0.94, { map: texture }));
  plane.position.set(x, y, -3.951);
  parent.add(plane);
  for (const dx of [-width / 2 + 0.04, width / 2 - 0.04]) {
    const tape = box(parent, [0.075, 0.16, 0.004], [x + dx, y + height / 2, -3.943], material('#b1aca0'));
    tape.rotation.z = dx < 0 ? -0.23 : 0.2;
  }
}

export function createRoom(): RoomModel {
  const group = new THREE.Group();
  group.name = 'YOUR_ROOM';
  const wallMap = surfaceTexture('wall');
  wallMap.repeat.set(3, 2);
  const wallMat = material('#728087', 0.96, { map: wallMap });
  const woodMap = surfaceTexture('wood');
  woodMap.repeat.set(2, 2);
  const floorMat = material('#77685e', 0.84, { map: woodMap });
  const fabricMap = surfaceTexture('fabric');
  fabricMap.repeat.set(4, 4);
  const darkMetal = material('#151d28', 0.52, { metalness: 0.45 });
  const cream = material('#b8b6ad', 0.9);

  box(group, [9.1, 0.16, 8.3], [0, -0.08, 0], floorMat);
  box(group, [0.15, 3.5, 8.3], [-4.5, 1.75, 0], wallMat);
  box(group, [0.15, 3.5, 8.3], [4.5, 1.75, 0], wallMat);
  box(group, [9.1, 3.5, 0.15], [0, 1.75, 4.12], material('#566067', 1, { map: wallMap }));
  const ceiling = box(group, [9.1, 0.12, 8.3], [0, 3.5, 0], material('#4d575f', 1));
  const backWall = new THREE.Group();
  group.add(backWall);
  box(backWall, [2.55, 3.5, 0.15], [-3.225, 1.75, -4.05], wallMat);
  box(backWall, [4.55, 3.5, 0.15], [2.225, 1.75, -4.05], wallMat);
  box(backWall, [2, 1.22, 0.15], [-1, 0.61, -4.05], wallMat);
  box(backWall, [2, 0.6, 0.15], [-1, 3.2, -4.05], wallMat);
  box(group, [9, 0.1, 0.06], [0, 0.08, -3.958], material('#252e35'));
  box(group, [0.06, 0.1, 8.1], [-4.39, 0.08, 0], material('#252e35'));
  box(group, [0.06, 0.1, 8.1], [4.39, 0.08, 0], material('#252e35'));

  const cityTexture = canvasTexture(512, 512, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, '#15293e');
    gradient.addColorStop(0.58, '#486785');
    gradient.addColorStop(1, '#111d30');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#bccfe0';
    ctx.beginPath();
    ctx.arc(105, 90, 15, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 14; i++) {
      const x = i * 43 - 30;
      const top = 230 + Math.sin(i * 5) * 100;
      ctx.fillStyle = i % 2 ? '#111c2c' : '#19283b';
      ctx.fillRect(x, top, 48, 512 - top);
      for (let y = top + 14; y < 500; y += 22) {
        for (let xx = x + 8; xx < x + 44; xx += 12) {
          if ((xx + y + i * 3) % 7 < 2) {
            ctx.fillStyle = '#c6b78a80';
            ctx.fillRect(xx, y, 4, 7);
          }
        }
      }
    }
    ctx.strokeStyle = '#accee83a';
    ctx.lineWidth = 1;
    for (let i = 0; i < 220; i++) {
      const x = (i * 131.13) % 512;
      const y = (i * 79.73) % 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + 8 + (i % 5) * 3);
      ctx.stroke();
    }
  });
  const windowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 1.65), new THREE.MeshBasicMaterial({ map: cityTexture }));
  windowPlane.position.set(-1, 2.04, -4.12);
  group.add(windowPlane);
  const frameMat = material('#17232d', 0.4, { metalness: 0.6 });
  for (const x of [-2.025, -1, 0.025]) box(group, [0.055, 1.78, 0.12], [x, 2.04, -3.99], frameMat);
  for (const y of [1.16, 2.93, 2.05]) box(group, [2.12, 0.055, 0.12], [-1, y, -3.99], frameMat);
  box(group, [2.3, 0.055, 0.32], [-1, 1.13, -3.86], material('#455059'));
  const reflection = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 1.65), new THREE.MeshBasicMaterial({
    color: '#a5cbe7', transparent: true, opacity: 0.055, depthWrite: false,
  }));
  reflection.position.set(-1, 2.04, -3.916);
  group.add(reflection);

  const curtainMat = material('#59626a', 1, { map: fabricMap, side: THREE.DoubleSide });
  for (const x of [-2.14, 0.17]) {
    const geometry = new THREE.PlaneGeometry(0.72, 2.7, 30, 24);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const px = position.getX(i);
      const py = position.getY(i);
      position.setZ(i, Math.sin(px * 40) * 0.075 + Math.cos(py * 1.5) * 0.03);
      if (py < -1.1) position.setY(i, py + Math.sin(px * 40) * 0.02);
    }
    geometry.computeVertexNormals();
    const curtain = new THREE.Mesh(geometry, curtainMat);
    curtain.position.set(x, 1.7, -3.65);
    curtain.castShadow = true;
    curtain.receiveShadow = true;
    group.add(curtain);
  }
  box(group, [3.12, 0.045, 0.045], [-1, 3.1, -3.65], darkMetal);

  // A single, fully modeled desk is both the title-screen focal point and the playable PC.
  const deskMap = surfaceTexture('wood');
  deskMap.repeat.set(1, 0.5);
  const deskMat = material('#9e7e5d', 0.67, { map: deskMap });
  box(group, [3.65, 0.095, 1.24], [1.69, 0.83, -2.79], deskMat, true);
  for (const x of [0.02, 3.35]) {
    for (const z of [-3.27, -2.29]) box(group, [0.065, 0.78, 0.065], [x, 0.39, z], darkMetal);
  }
  box(group, [3.37, 0.04, 0.04], [1.69, 0.19, -3.27], darkMetal);
  box(group, [0.9, 0.29, 1.03], [0.45, 0.62, -2.83], material('#463f38'));
  box(group, [0.86, 0.01, 0.92], [0.45, 0.472, -2.79], darkMetal);
  box(group, [0.22, 0.012, 0.025], [0.45, 0.61, -2.301], material('#a3a4a2', 0.35, { metalness: 0.7 }));

  const monitor = new MonitorTexture();
  box(group, [1.71, 1.055, 0.12], [1.53, 1.67, -2.965], material('#10151c', 0.35), true);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.57, 0.945), new THREE.MeshBasicMaterial({ map: monitor.texture }));
  screen.position.set(1.53, 1.684, -2.898);
  group.add(screen);
  box(group, [0.12, 0.24, 0.11], [1.53, 1.02, -2.98], darkMetal);
  box(group, [0.54, 0.035, 0.3], [1.53, 0.9, -2.89], darkMetal, true);
  box(group, [0.035, 0.004, 0.004], [2.236, 1.168, -2.895], new THREE.MeshBasicMaterial({ color: '#95beff' }));
  const monitorLight = new THREE.PointLight('#4388ff', 7.6, 6, 2);
  monitorLight.position.set(1.53, 1.72, -2.42);
  group.add(monitorLight);

  const fragments = new THREE.Group();
  fragments.visible = false;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 6; col++) {
      const geometry = new THREE.PlaneGeometry(1.57 / 6 - 0.004, 0.945 / 4 - 0.004);
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (col + uv.getX(i)) / 6, (row + uv.getY(i)) / 4);
      }
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        map: monitor.texture, side: THREE.DoubleSide, transparent: true, opacity: 0,
      }));
      mesh.position.set(1.53 - 1.57 / 2 + (col + 0.5) * 1.57 / 6, 1.684 - 0.945 / 2 + (row + 0.5) * 0.945 / 4, -2.885);
      mesh.userData.origin = mesh.position.clone();
      mesh.userData.seed = col * 1.81 + row * 2.13;
      fragments.add(mesh);
    }
  }
  group.add(fragments);

  box(group, [1.13, 0.025, 0.37], [1.41, 0.898, -2.309], material('#222934'), true);
  const keyGeo = new THREE.BoxGeometry(0.057, 0.014, 0.055);
  const keys = new THREE.InstancedMesh(keyGeo, material('#5b6570', 0.72), 66);
  const keyMatrix = new THREE.Matrix4();
  let keyIndex = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 13; col++) {
      keyMatrix.makeTranslation(1.0 + col * 0.066, 0.919, -2.45 + row * 0.064);
      keys.setMatrixAt(keyIndex++, keyMatrix);
    }
  }
  keyMatrix.compose(new THREE.Vector3(1.43, 0.921, -2.175), new THREE.Quaternion(), new THREE.Vector3(5, 1, 1));
  keys.setMatrixAt(65, keyMatrix);
  keys.castShadow = true;
  group.add(keys);
  const keyLetters = canvasTexture(1024, 256, (ctx) => {
    ctx.fillStyle = '#b4bdc6';
    ctx.font = '18px monospace';
    const rows = ['1234567890-=', 'QWERTYUIOP[]', 'ASDFGHJKL;', 'ZXCVBNM,./'];
    rows.forEach((row, r) => [...row].forEach((letter, c) => ctx.fillText(letter, 30 + c * 73, 41 + r * 49)));
  });
  const lettersPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.91, 0.258), new THREE.MeshBasicMaterial({ map: keyLetters, transparent: true, opacity: 0.75 }));
  lettersPlane.rotation.x = -Math.PI / 2;
  lettersPlane.position.set(1.43, 0.928, -2.33);
  group.add(lettersPlane);
  box(group, [0.45, 0.009, 0.4], [2.38, 0.886, -2.36], material('#202c37'));
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), material('#777c7f', 0.44));
  mouse.scale.set(0.085, 0.03, 0.133);
  mouse.position.set(2.37, 0.924, -2.39);
  mouse.castShadow = true;
  group.add(mouse);
  box(group, [0.009, 0.006, 0.038], [2.37, 0.954, -2.443], darkMetal, true);

  const mug = new THREE.Group();
  mug.position.set(2.93, 0.884, -2.28);
  group.add(mug);
  cylinder(mug, 0.121, 0.121, 0.012, [0, 0.006, 0], material('#6a655b'));
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.097, 0.081, 0.2, 24, 1, true), cream);
  cup.position.y = 0.113;
  cup.castShadow = true;
  mug.add(cup);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.093, 0.009, 8, 32), cream);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.213;
  mug.add(rim);
  cylinder(mug, 0.085, 0.085, 0.003, [0, 0.19, 0], material('#27170f', 0.2));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.064, 0.014, 8, 24), cream);
  handle.rotation.y = Math.PI / 2;
  handle.position.set(0.106, 0.117, 0);
  mug.add(handle);

  const paperTexture = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#c4bfae';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#575c6555';
    for (let y = 90; y < 470; y += 32) {
      ctx.beginPath();
      ctx.moveTo(30, y);
      ctx.lineTo(480, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#34465b';
    ctx.font = 'italic 25px Georgia';
    ctx.fillText('13 / 06', 35, 56);
    ctx.font = 'italic 20px Georgia';
    ctx.fillText('Remember to sleep.', 36, 144);
    ctx.fillText('The rain never stops.', 36, 207);
    ctx.fillText('03:17', 330, 405);
  });
  box(group, [0.48, 0.02, 0.41], [0.42, 0.892, -2.35], material('#283644'));
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.453, 0.38), material('#ffffff', 0.95, { map: paperTexture }));
  paper.rotation.x = -Math.PI / 2;
  paper.rotation.z = -0.09;
  paper.position.set(0.42, 0.905, -2.35);
  group.add(paper);
  const pen = cylinder(group, 0.006, 0.006, 0.26, [0.55, 0.918, -2.34], darkMetal, 8);
  pen.rotation.z = Math.PI / 2;
  pen.rotation.y = -0.25;
  const bookColors = ['#6f5341', '#334851', '#9b9482'];
  for (let i = 0; i < 3; i++) {
    const book = box(group, [0.43 - i * 0.03, 0.045, 0.28], [0.28, 0.91 + i * 0.045, -2.92], material(bookColors[i]));
    book.rotation.y = i * 0.07 - 0.08;
    box(group, [0.37, 0.024, 0.267], [0.29, 0.91 + i * 0.045, -2.915], material('#a4a291'));
  }
  plant(group, 3.26, 0.88, -2.99, 0.85);
  plant(group, -1.13, 0, -3.4, 1.7);

  const lampX = 2.94;
  const lampZ = -2.94;
  cylinder(group, 0.16, 0.175, 0.035, [lampX, 0.906, lampZ], darkMetal);
  cylinder(group, 0.02, 0.02, 0.71, [lampX, 1.25, lampZ], material('#878476', 0.36, { metalness: 0.6 }));
  const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.235, 0.23, 32, 1, true), material('#afb09e', 0.75, { side: THREE.DoubleSide }));
  lampShade.position.set(lampX, 1.67, lampZ);
  lampShade.castShadow = true;
  group.add(lampShade);
  const lampGlow = new THREE.Mesh(new THREE.CircleGeometry(0.199, 24), new THREE.MeshBasicMaterial({ color: '#ffe0a3', side: THREE.DoubleSide }));
  lampGlow.rotation.x = Math.PI / 2;
  lampGlow.position.set(lampX, 1.572, lampZ);
  group.add(lampGlow);
  const warmLight = new THREE.PointLight('#ffd29a', 4.9, 5.5, 2);
  warmLight.position.set(lampX, 1.56, lampZ);
  group.add(warmLight);
  const lampLight = new THREE.SpotLight('#ffcf91', 19, 7, 0.94, 0.87, 2);
  lampLight.position.set(lampX, 1.57, lampZ);
  lampLight.target.position.set(2.4, 0.7, -2.4);
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(1024, 1024);
  lampLight.shadow.bias = -0.0007;
  lampLight.shadow.normalBias = 0.025;
  group.add(lampLight, lampLight.target);

  box(group, [0.43, 0.73, 0.66], [3.08, 0.4, -3.05], darkMetal, true);
  box(group, [0.37, 0.65, 0.009], [3.08, 0.41, -2.713], material('#19212c', 0.7));
  for (let y = 0.23; y < 0.57; y += 0.035) box(group, [0.23, 0.006, 0.01], [3.08, y, -2.703], material('#070c12'));
  const power = new THREE.Mesh(new THREE.CircleGeometry(0.013, 12), new THREE.MeshBasicMaterial({ color: '#81b6ff' }));
  power.position.set(3.19, 0.68, -2.7);
  group.add(power);
  cable(group, [[1.5, 1.15, -3.03], [1.8, 0.93, -3.19], [2.6, 0.85, -3.2], [3.1, 0.3, -3.42]]);
  cable(group, [[1.4, 0.92, -2.48], [1.45, 0.9, -2.75], [1.15, 0.9, -3.2]]);
  cable(group, [[2.37, 0.92, -2.49], [2.38, 0.9, -2.75], [2.0, 0.9, -3.15]]);

  const chair = new THREE.Group();
  chair.position.set(1.52, 0, -1.25);
  group.add(chair);
  cylinder(chair, 0.055, 0.06, 0.43, [0, 0.29, 0], darkMetal);
  box(chair, [0.65, 0.095, 0.58], [0, 0.55, 0], material('#363f4c', 0.92, { map: fabricMap }), true);
  box(chair, [0.64, 0.65, 0.09], [0, 0.92, 0.265], material('#3c4654', 0.9, { map: fabricMap }), true);
  for (const x of [-0.28, 0.28]) {
    box(chair, [0.025, 0.43, 0.025], [x, 0.7, 0.21], darkMetal);
    box(chair, [0.07, 0.03, 0.35], [x, 0.77, 0.015], darkMetal, true);
  }
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 0.4;
    const leg = box(chair, [0.03, 0.026, 0.35], [Math.sin(angle) * 0.15, 0.105, Math.cos(angle) * 0.15], darkMetal);
    leg.rotation.y = angle;
    const wheel = cylinder(chair, 0.044, 0.044, 0.04, [Math.sin(angle) * 0.32, 0.055, Math.cos(angle) * 0.32], darkMetal, 12);
    wheel.rotation.z = Math.PI / 2;
  }
  chair.rotation.y = -0.13;

  box(group, [1.84, 0.35, 3.35], [-3.22, 0.2, -0.3], material('#2d3035'), true);
  box(group, [1.76, 0.23, 3.21], [-3.22, 0.49, -0.3], material('#8b8b86', 1, { map: fabricMap }), true);
  box(group, [1.85, 0.9, 0.1], [-3.22, 0.75, -1.98], material('#3e4346'), true);
  const blanket = box(group, [1.79, 0.19, 2.5], [-3.22, 0.68, 0.04], material('#4e5965', 1, { map: fabricMap }), true);
  blanket.rotation.y = 0.018;
  for (let i = 0; i < 8; i++) {
    const fold = box(group, [1.81, 0.022, 0.038], [-3.22, 0.781 + Math.sin(i * 1.9) * 0.008, -0.97 + i * 0.27], material('#66727d', 1, { map: fabricMap }), true);
    fold.rotation.y = 0.022;
  }
  const pillow = box(group, [1.02, 0.19, 0.53], [-3.2, 0.725, -1.51], material('#aaaba4', 1, { map: fabricMap }), true);
  pillow.rotation.y = -0.05;
  box(group, [0.65, 0.56, 0.6], [-1.92, 0.28, -1.7], material('#4b433d'));
  box(group, [0.66, 0.045, 0.62], [-1.92, 0.58, -1.7], deskMat);
  box(group, [0.35, 0.035, 0.28], [-1.92, 0.622, -1.7], material('#6e7a80'));
  cylinder(group, 0.063, 0.057, 0.19, [-1.95, 0.735, -1.52], material('#9cabb3', 0.2, { transparent: true, opacity: 0.45 }));

  const rugMap = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#3d454a';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 512; i += 3) {
      ctx.fillStyle = i % 2 ? '#96928a20' : '#121c2620';
      ctx.fillRect(i, 0, 1, 512);
      ctx.fillRect(0, i, 512, 1);
    }
    ctx.strokeStyle = '#827d6b80';
    ctx.lineWidth = 6;
    ctx.strokeRect(27, 27, 458, 458);
    ctx.lineWidth = 2;
    ctx.strokeRect(39, 39, 434, 434);
  });
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.65, 3.2), material('#a2a8ad', 1, { map: rugMap }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.15, 0.012, 0.8);
  rug.receiveShadow = true;
  group.add(rug);

  poster(group, 0.62, 2.75, 0.76, 0.94, 0);
  poster(group, 3.63, 2.47, 0.6, 0.81, 1);
  box(group, [1.72, 0.05, 0.31], [2.24, 2.87, -3.77], deskMat);
  for (let i = 0; i < 7; i++) {
    const height = 0.24 + (i % 3) * 0.045;
    const book = box(group, [0.08, height, 0.2], [1.53 + i * 0.11, 2.9 + height / 2, -3.79], material(['#656a65', '#47434b', '#9d927e', '#344758'][i % 4]));
    if (i === 6) book.rotation.z = 0.19;
  }
  plant(group, 2.81, 2.905, -3.79, 0.67);
  for (const x of [1.56, 2.92]) box(group, [0.035, 0.2, 0.26], [x, 2.75, -3.8], darkMetal);

  const door = new THREE.Group();
  door.position.set(4.395, 0, 1.88);
  door.rotation.y = -Math.PI / 2;
  group.add(door);
  box(door, [1.11, 2.38, 0.03], [0, 1.2, 0], material('#444d53', 0.89, { map: wallMap }));
  for (const x of [-0.6, 0.6]) box(door, [0.055, 2.5, 0.08], [x, 1.25, 0.03], material('#28333d'));
  box(door, [1.25, 0.06, 0.08], [0, 2.48, 0.03], material('#28333d'));
  box(door, [0.14, 0.026, 0.04], [-0.34, 1.15, 0.07], material('#a3aaa8', 0.28, { metalness: 0.8 }));
  box(group, [0.8, 2.67, 1.17], [-4.0, 1.34, 3.1], material('#35404a', 0.92));
  box(group, [0.015, 2.4, 0.009], [-3.59, 1.34, 3.1], darkMetal);
  for (const z of [2.99, 3.22]) box(group, [0.035, 0.18, 0.019], [-3.574, 1.4, z], material('#838b8e', 0.4, { metalness: 0.5 }));
  box(group, [0.2, 0.12, 0.025], [0.2, 0.37, -3.963], cream);
  for (const x of [0.15, 0.25]) box(group, [0.025, 0.043, 0.008], [x, 0.37, -3.941], darkMetal);
  cable(group, [[0.2, 0.32, -3.94], [0.2, 0.03, -3.85], [1.3, 0.03, -3.77], [3.2, 0.08, -3.55]], 0.012);

  const hemi = new THREE.HemisphereLight('#99b8d6', '#242224', 0.64);
  group.add(hemi);
  const moon = new THREE.DirectionalLight('#7aabdf', 1.0);
  moon.position.set(-3, 5, -6);
  moon.target.position.set(0, 0, 1.1);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = -6;
  moon.shadow.camera.right = 6;
  moon.shadow.camera.top = 6;
  moon.shadow.camera.bottom = -6;
  moon.shadow.normalBias = 0.025;
  group.add(moon, moon.target);
  const windowLight = new THREE.PointLight('#84b8ef', 4.5, 7, 2);
  windowLight.position.set(-1, 2.3, -3.45);
  group.add(windowLight);

  const dustGeo = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(120 * 3);
  for (let i = 0; i < 120; i++) {
    dustPositions[i * 3] = Math.random() * 8 - 4;
    dustPositions[i * 3 + 1] = Math.random() * 3.1 + 0.2;
    dustPositions[i * 3 + 2] = Math.random() * 7.5 - 3.75;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: '#afc8df', size: 0.012, transparent: true, opacity: 0.3, depthWrite: false }));
  group.add(dust);

  let lastMonitorDraw = -10;
  let desktop = false;
  return {
    group, screen, monitor, monitorLight, warmLight, lampLight, backWall, ceiling, fragments, chair, mug, dust,
    colliders: [
      { minX: -0.14, maxX: 3.57, minZ: -3.41, maxZ: -2.12 },
      { minX: -4.17, maxX: -2.24, minZ: -2.05, maxZ: 1.44 },
      { minX: -2.27, maxX: -1.55, minZ: -2.04, maxZ: -1.37 },
      { minX: -4.45, maxX: -3.54, minZ: 2.48, maxZ: 3.74 },
    ],
    setDesktop(value) {
      desktop = value;
      lastMonitorDraw = -10;
    },
    update(time, corruption, returned) {
      dust.rotation.y = Math.sin(time * 0.03) * 0.04;
      const fluctuation = Math.sin(time * 1.3) * 0.035;
      monitorLight.intensity = returned ? 2.1 + fluctuation : 7.6 + fluctuation + corruption * 7;
      warmLight.intensity = returned ? 1.4 : 4.9 * (1 - corruption * 0.55);
      lampLight.intensity = returned ? 8 : 19 * (1 - corruption * 0.55);
      warmLight.color.set(returned ? '#7eacff' : '#ffd29a');
      lampLight.color.set(returned ? '#7eacff' : '#ffcf91');
      if (returned) {
        chair.rotation.y = -0.67;
        chair.position.z = -0.87;
        mug.rotation.z = -Math.PI * 0.43;
        mug.position.y = 0.925;
      }
      if (time - lastMonitorDraw > (corruption > 0 ? 0.06 : 0.65)) {
        monitor.draw(returned ? 'returned' : desktop ? 'desktop' : 'bsod', corruption, time);
        lastMonitorDraw = time;
      }
      fragments.visible = corruption > 0.36;
      fragments.children.forEach((child) => {
        const mesh = child as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
        const peel = Math.max(0, corruption - 0.36) / 0.64;
        const seed = mesh.userData.seed as number;
        mesh.position.copy(mesh.userData.origin as THREE.Vector3);
        mesh.position.x += Math.sin(seed) * peel * 1.4;
        mesh.position.y += Math.cos(seed * 1.3) * peel * 0.9;
        mesh.position.z += peel * (0.15 + (seed % 1) * 1.1);
        mesh.rotation.set(peel * Math.sin(seed), peel * Math.cos(seed) * 0.5, peel * Math.sin(seed * 3) * 0.3);
        mesh.material.opacity = Math.min(1, peel * 3) * (1 - peel * 0.25);
      });
    },
    reset() {
      group.position.set(0, 0, 0);
      group.rotation.set(0, 0, 0);
      group.scale.setScalar(1);
      backWall.visible = true;
      ceiling.visible = true;
      screen.visible = true;
      fragments.visible = false;
      chair.position.set(1.52, 0, -1.25);
      chair.rotation.y = -0.13;
      mug.position.set(2.93, 0.884, -2.28);
      mug.rotation.set(0, 0, 0);
      desktop = false;
      lastMonitorDraw = -10;
      monitor.draw('bsod', 0, 0);
    },
  };
}