import * as THREE from 'three';
import { canvasTexture, glowTexture, surfaceTexture, textTexture } from './textures';

const CENTER_X = 1.53;
export const MONUMENT = new THREE.Vector3(CENTER_X, 0, -67);

export const groundHeight = (x: number, z: number) => Math.sin(x * 0.14) * 0.16 + Math.sin((z + 23) * 0.15) * 0.1;

interface Tile {
  position: THREE.Vector3;
  seed: number;
}

export interface WorldModel {
  group: THREE.Group;
  monument: THREE.Group;
  clue: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  floor: THREE.InstancedMesh;
  cracks: THREE.Group;
  update: (time: number, player: THREE.Vector3, gentle: boolean) => void;
  beginCollapse: (player: THREE.Vector3) => void;
  collapse: (elapsed: number, player: THREE.Vector3) => void;
  reset: () => void;
}

function solid(
  parent: THREE.Object3D,
  dimensions: [number, number, number],
  position: [number, number, number],
  color: string,
  outline = false,
) {
  const geometry = new THREE.BoxGeometry(...dimensions);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, metalness: 0.38, roughness: 0.53,
  }));
  mesh.position.set(...position);
  mesh.receiveShadow = true;
  parent.add(mesh);
  if (outline) {
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({
      color: '#558aff', transparent: true, opacity: 0.55,
    }));
    mesh.add(edge);
  }
  return mesh;
}

function panel(parent: THREE.Object3D, text: string[], position: [number, number, number], width: number, height: number, rotation = 0) {
  const texture = canvasTexture(1024, 640, (ctx) => {
    ctx.fillStyle = '#0b48c9';
    ctx.fillRect(0, 0, 1024, 640);
    ctx.strokeStyle = '#9fbfff';
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, 1018, 634);
    ctx.fillStyle = '#d5e4ff';
    ctx.font = '24px monospace';
    ctx.fillText('SYSTEM / EXCEPTION', 35, 50);
    ctx.fillText('_  [ ]  x', 816, 50);
    ctx.fillRect(0, 75, 1024, 1);
    ctx.font = '42px monospace';
    text.forEach((line, i) => ctx.fillText(line, 42, 155 + i * 73));
    ctx.font = '19px monospace';
    ctx.fillStyle = '#abc7ff';
    ctx.fillText('MEMORY DUMP: 0x00000000', 43, 588);
    ctx.fillStyle = '#021538';
    ctx.fillRect(742, 252, 282, 39);
    ctx.fillRect(0, 360, 306, 13);
  });
  const group = new THREE.Group();
  group.position.set(...position);
  group.rotation.y = rotation;
  group.rotation.z = rotation * 0.07;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  group.add(plane);
  solid(group, [width + 0.04, height + 0.04, 0.045], [0, 0, -0.03], '#0b285b', true);
  group.userData.originY = position[1];
  parent.add(group);
  return group;
}

export function createWorld(): WorldModel {
  const group = new THREE.Group();
  group.name = 'MEMORY_DUMP';
  group.visible = false;
  const tileTexture = surfaceTexture('tile');
  const floorMaterial = new THREE.MeshStandardMaterial({ color: '#4278ce', map: tileTexture, roughness: 0.6, metalness: 0.48 });
  const tiles: Tile[] = [];
  for (let row = 0; row < 32; row++) {
    for (let col = 0; col < 25; col++) {
      const x = CENTER_X + (col - 12) * 2.72;
      const z = -22 - row * 2.72;
      tiles.push({ position: new THREE.Vector3(x, groundHeight(x, z) - 0.15, z), seed: ((row * 13 + col * 31) % 71) / 71 });
    }
  }
  const floor = new THREE.InstancedMesh(new THREE.BoxGeometry(2.665, 0.3, 2.665), floorMaterial, tiles.length);
  floor.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  floor.receiveShadow = true;
  // Falling tiles leave their original bounding volume; disabling culling keeps the fall visible.
  floor.frustumCulled = false;
  const dummy = new THREE.Object3D();
  tiles.forEach((tile, i) => {
    dummy.position.copy(tile.position);
    dummy.updateMatrix();
    floor.setMatrixAt(i, dummy.matrix);
    floor.setColorAt(i, new THREE.Color().setHSL(0.61 + tile.seed * 0.02, 0.67, 0.36 + tile.seed * 0.12));
  });
  group.add(floor);

  const ribbonMaterial = new THREE.LineBasicMaterial({ color: '#a4c9ff', transparent: true, opacity: 0.46 });
  for (const side of [-1, 1]) {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 56; i++) {
      const z = -23 - i * 0.77;
      const x = CENTER_X + side * (2.2 + Math.sin(i * 0.1) * 0.7);
      points.push(new THREE.Vector3(x, groundHeight(x, z) + 0.035, z));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), ribbonMaterial));
  }

  const monument = new THREE.Group();
  monument.position.copy(MONUMENT);
  group.add(monument);
  solid(monument, [9, 0.45, 5.8], [0, 0.23, 0], '#12315c', true);
  const left = solid(monument, [1.1, 13.4, 2.5], [-3.18, 7.25, 0], '#092456', true);
  const right = solid(monument, [1.1, 13.4, 2.5], [3.18, 7.25, 0], '#092456', true);
  left.rotation.z = 0.02;
  right.rotation.z = -0.02;
  solid(monument, [7.48, 1.07, 2.5], [0, 14.15, 0], '#173d81', true);
  solid(monument, [4.84, 10.1, 0.6], [0, 8.41, -0.61], '#040e25', true);
  const innerLight = new THREE.PointLight('#4f83ff', 24, 24, 2);
  innerLight.position.set(0, 6.5, 3.3);
  monument.add(innerLight);
  const white = new THREE.MeshBasicMaterial({ color: '#dbe9ff' });
  for (const y of [10.62, 9.48]) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 16), white);
    dot.position.set(-1.28, y, -0.06);
    dot.scale.z = 0.25;
    monument.add(dot);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.075, 8, 64, Math.PI), white);
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(1.07, 10.05, -0.05);
  monument.add(mouth);
  const errorLabel = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 1.3), new THREE.MeshBasicMaterial({
    map: textTexture(['A CONNECTION STILL EXISTS.', 'DO NOT SHUT DOWN.'], { width: 1024, height: 256, size: 35 }),
    transparent: true, opacity: 0.67,
  }));
  errorLabel.position.set(0, 6.46, -0.08);
  monument.add(errorLabel);
  const smallLabel = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.6), new THREE.MeshBasicMaterial({
    map: textTexture(['RECOVERY ROUTINE / STORED MEMORY'], { width: 1024, height: 160, size: 28 }),
    transparent: true, opacity: 0.55,
  }));
  smallLabel.position.set(0, 3.13, 1.29);
  monument.add(smallLabel);
  solid(monument, [4.6, 2.2, 0.3], [0, 1.66, 1.02], '#071b39', true);
  const clue = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 0.92), new THREE.MeshBasicMaterial({
    map: textTexture(['WAKE_UP'], { width: 720, height: 170, size: 85, color: '#e7f2ff' }),
    transparent: true, opacity: 0,
  }));
  clue.position.set(0.22, 1.83, 1.185);
  monument.add(clue);

  const halo = new THREE.Group();
  halo.position.y = 17.2;
  monument.add(halo);
  const haloMat = new THREE.MeshBasicMaterial({ color: '#6da1ff', transparent: true, opacity: 0.68 });
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.9 + i * 0.38, 0.025, 6, 100, Math.PI * (1.3 + i * 0.18)), haloMat);
    ring.rotation.set(Math.PI / 2 + i * 0.16, i * 0.08, i * 2.4);
    halo.add(ring);
  }
  const crownPieces: THREE.Mesh[] = [];
  for (let i = 0; i < 11; i++) {
    const angle = i * 2.4;
    const piece = solid(monument, [0.4 + (i % 3) * 0.4, 0.75 + (i % 4) * 0.55, 0.65], [Math.sin(angle) * 2.6, 16.3 + (i % 3) * 0.65, Math.cos(angle) * 2.3], '#224e94', true);
    piece.rotation.set(i * 0.2, i * 0.6, i * 0.18);
    piece.userData.origin = piece.position.clone();
    crownPieces.push(piece);
  }

  const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({
    color: '#082356', metalness: 0.36, roughness: 0.7,
  }), 104);
  for (let i = 0; i < 104; i++) {
    const side = i % 2 ? -1 : 1;
    const x = CENTER_X + side * (15 + ((i * 7.19) % 39));
    const z = -34 - ((i * 11.31) % 99);
    const h = 6 + ((i * 9.17) % 38);
    dummy.position.set(x, h / 2 - 1, z);
    dummy.scale.set(1.8 + (i % 3) * 0.7, h, 1.7 + (i % 4) * 0.6);
    dummy.rotation.set(0, (i % 5) * 0.02, (i % 3 - 1) * 0.014);
    dummy.updateMatrix();
    buildings.setMatrixAt(i, dummy.matrix);
    buildings.setColorAt(i, new THREE.Color(i % 4 === 0 ? '#19529e' : '#0b2c67'));
    if (i % 5 === 0) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x + 1, 0, z + 1), new THREE.Vector3(x + 1, h - 1, z + 1),
      ]), new THREE.LineBasicMaterial({ color: '#478fff', transparent: true, opacity: 0.3 }));
      group.add(line);
    }
  }
  group.add(buildings);
  dummy.scale.setScalar(1);
  dummy.rotation.set(0, 0, 0);

  const floatingPanels = [
    panel(group, [':(', 'Your reality ran into', 'a problem.', '0% complete'], [-10.5, 5.6, -35], 5.7, 3.6, 0.38),
    panel(group, ['FATAL EXCEPTION', '0x000000F4', 'No signal.', 'Are you still there?'], [11.6, 4.8, -45], 5.2, 3.3, -0.46),
    panel(group, ['MEMORY CORRUPTED', 'You have been here', 'before.'], [-15.2, 9.2, -62], 7.2, 4.4, 0.38),
    panel(group, ['SESSION 0317', 'Connection refused.', 'There is no outside.'], [15.1, 10.8, -83], 6.1, 3.9, -0.34),
    panel(group, ['RESTORE POINT', '[ missing ]'], [-8.1, 2.7, -83], 3.7, 2.4, 0.9),
  ];
  const codeLabels: THREE.Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const code = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 0.78), new THREE.MeshBasicMaterial({
      map: textTexture([['0x00000000', 'PAGE_FAULT', 'NO_SIGNAL', 'MEMORY_LEAK'][i % 4]], { size: 51, width: 700, height: 150 }),
      transparent: true, opacity: 0.38, side: THREE.DoubleSide,
    }));
    code.position.set(CENTER_X + Math.sin(i * 2.3) * (7 + i * 0.7), 2 + (i % 5) * 1.7, -29 - i * 5.2);
    code.rotation.set(0, Math.sin(i) * 0.45, Math.sin(i * 1.6) * 0.07);
    code.userData.originY = code.position.y;
    group.add(code);
    codeLabels.push(code);
  }

  const shards: THREE.Mesh[] = [];
  for (let i = 0; i < 45; i++) {
    const angle = i * 2.399;
    const x = CENTER_X + Math.sin(angle) * (4.5 + (i % 7) * 2.8);
    const z = -26 - ((i * 7.91) % 69);
    const shard = solid(group, [0.2 + (i % 4) * 0.2, 0.35 + (i % 3) * 0.7, 0.09 + (i % 2) * 0.15], [x, 2.6 + (i % 7) * 1.3, z], i % 3 ? '#386bcb' : '#91b7ff', true);
    shard.rotation.set(i * 0.7, i * 0.4, i * 0.15);
    shard.userData.origin = shard.position.clone();
    shards.push(shard);
  }

  const pointsGeometry = new THREE.BufferGeometry();
  const pointsArray = new Float32Array(650 * 3);
  for (let i = 0; i < 650; i++) {
    pointsArray[i * 3] = CENTER_X + Math.sin(i * 137.71) * 52;
    pointsArray[i * 3 + 1] = 0.6 + ((i * 7.137) % 45);
    pointsArray[i * 3 + 2] = -24 - ((i * 17.413) % 120);
  }
  pointsGeometry.setAttribute('position', new THREE.BufferAttribute(pointsArray, 3));
  const particles = new THREE.Points(pointsGeometry, new THREE.PointsMaterial({
    color: '#bad5ff', size: 0.054, transparent: true, opacity: 0.6, depthWrite: false,
  }));
  group.add(particles);
  const glowMap = glowTexture();
  for (const position of [[-8, 9, -42], [8, 5, -59], [0, 18, -67], [13, 12, -91]]) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: '#578bff', transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.position.set(position[0] + CENTER_X, position[1], position[2]);
    sprite.scale.set(13, 23, 1);
    group.add(sprite);
  }
  const ambient = new THREE.HemisphereLight('#8babff', '#091731', 1.9);
  const directional = new THREE.DirectionalLight('#96beff', 3.1);
  directional.position.set(-18, 35, -42);
  directional.target.position.set(0, 0, -61);
  group.add(ambient, directional, directional.target);
  const arrivalLight = new THREE.PointLight('#accfff', 12, 22, 2);
  arrivalLight.position.set(CENTER_X, 4.2, -26);
  group.add(arrivalLight);
  const cracks = new THREE.Group();
  group.add(cracks);

  const restoreTiles = () => {
    dummy.scale.setScalar(1);
    dummy.rotation.set(0, 0, 0);
    tiles.forEach((tile, i) => {
      dummy.position.copy(tile.position);
      dummy.updateMatrix();
      floor.setMatrixAt(i, dummy.matrix);
    });
    floor.instanceMatrix.needsUpdate = true;
  };

  return {
    group, monument, clue, floor, cracks,
    update(time, player, gentle) {
      const motion = gentle ? 0.3 : 1;
      halo.rotation.y = time * 0.055 * motion;
      halo.rotation.z = Math.sin(time * 0.09) * 0.05 * motion;
      crownPieces.forEach((piece, i) => {
        piece.position.copy(piece.userData.origin as THREE.Vector3);
        piece.position.y += Math.sin(time * 0.42 + i) * 0.23 * motion;
        piece.rotation.y = i * 0.6 + time * 0.026 * motion;
      });
      shards.forEach((piece, i) => {
        piece.position.copy(piece.userData.origin as THREE.Vector3);
        piece.position.y += Math.sin(time * 0.37 + i * 1.9) * 0.37 * motion;
        piece.rotation.y = i * 0.4 + time * 0.033 * motion;
      });
      floatingPanels.forEach((p, i) => {
        p.position.y = (p.userData.originY as number) + Math.sin(time * 0.28 + i * 1.5) * 0.17 * motion;
      });
      codeLabels.forEach((p, i) => {
        p.position.y = (p.userData.originY as number) + Math.sin(time * 0.4 + i) * 0.16 * motion;
      });
      particles.rotation.z = Math.sin(time * 0.008) * 0.001;
      const distance = Math.hypot(player.x - CENTER_X, player.z + 67);
      clue.material.opacity = THREE.MathUtils.clamp((13 - distance) / 4, 0, 1);
    },
    beginCollapse(player) {
      cracks.children.forEach((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
      cracks.clear();
      cracks.position.set(player.x, groundHeight(player.x, player.z) + 0.028, player.z);
      const crackMat = new THREE.MeshBasicMaterial({ color: '#b3d5ff', transparent: true, opacity: 0.96 });
      for (let i = 0; i < 14; i++) {
        const angle = i * Math.PI * 2 / 14;
        const points: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)];
        for (let j = 1; j < 9; j++) {
          const radius = j * (0.9 + (i % 3) * 0.2);
          const a = angle + Math.sin(j * 2.7 + i) * 0.11;
          const x = Math.cos(a) * radius;
          const z = Math.sin(a) * radius;
          points.push(new THREE.Vector3(x, groundHeight(player.x + x, player.z + z) - groundHeight(player.x, player.z), z));
        }
        const crack = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.017 + (i % 2) * 0.011, 4, false), crackMat);
        cracks.add(crack);
      }
      cracks.scale.set(0.005, 1, 0.005);
      cracks.visible = true;
    },
    collapse(elapsed, player) {
      const spread = THREE.MathUtils.smoothstep(elapsed, 1.6, 4.6);
      cracks.scale.set(Math.max(0.005, spread), 1, Math.max(0.005, spread));
      if (elapsed < 4.3) return;
      tiles.forEach((tile, i) => {
        const distance = Math.hypot(tile.position.x - player.x, tile.position.z - player.z);
        const fall = Math.max(0, elapsed - 4.35 - distance * 0.035 - tile.seed * 0.25);
        dummy.position.copy(tile.position);
        dummy.position.y -= fall * fall * (3.2 + tile.seed * 1.9);
        dummy.position.x += Math.sin(tile.seed * 41) * fall * 0.43;
        dummy.position.z += Math.cos(tile.seed * 31) * fall * 0.43;
        dummy.rotation.set(fall * Math.sin(tile.seed * 33) * 0.25, fall * tile.seed * 0.12, fall * Math.cos(tile.seed * 23) * 0.28);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        floor.setMatrixAt(i, dummy.matrix);
      });
      floor.instanceMatrix.needsUpdate = true;
      cracks.position.y = groundHeight(player.x, player.z) + 0.028 - Math.pow(Math.max(0, elapsed - 4.65), 2) * 5;
      crownPieces.forEach((piece, i) => {
        piece.position.y -= Math.pow(Math.max(0, elapsed - 5 - i * 0.08), 2) * 0.19;
        piece.rotation.z = Math.max(0, elapsed - 5) * (i % 2 ? 0.08 : -0.08);
      });
    },
    reset() {
      restoreTiles();
      cracks.visible = false;
      clue.material.opacity = 0;
      monument.position.copy(MONUMENT);
      monument.rotation.set(0, 0, 0);
      crownPieces.forEach((piece, i) => {
        piece.position.copy(piece.userData.origin as THREE.Vector3);
        piece.rotation.set(i * 0.2, i * 0.6, i * 0.18);
      });
    },
  };
}

export interface PassageModel {
  group: THREE.Group;
  face: THREE.Group;
  rings: THREE.Mesh[];
  update: (time: number, growth: number, gentle: boolean) => void;
}

export function createPassage(): PassageModel {
  const group = new THREE.Group();
  group.position.set(CENTER_X, 1.684, -2.898);
  group.visible = false;
  const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 4.5, 19.5, 48, 20, true), new THREE.MeshBasicMaterial({
    color: '#032572', side: THREE.BackSide,
  }));
  tunnel.rotation.x = Math.PI / 2;
  tunnel.position.z = -9.75;
  group.add(tunnel);
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 22; i++) {
    const fraction = i / 21;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.66 + fraction * 3.84, 0.012 + fraction * 0.013, 5, 64), new THREE.MeshBasicMaterial({
      color: i % 3 ? '#438aff' : '#b7d4ff', transparent: true, opacity: 0.32 + fraction * 0.2,
    }));
    ring.position.z = -fraction * 19.5;
    ring.rotation.z = i * 0.12;
    rings.push(ring);
    group.add(ring);
  }
  const face = new THREE.Group();
  face.position.z = 0.035;
  group.add(face);
  const faceMat = new THREE.MeshBasicMaterial({ color: '#ecf4ff' });
  for (const y of [0.235, -0.105]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.062, 20, 12), faceMat);
    eye.position.set(-0.425, y, 0);
    eye.scale.z = 0.5;
    face.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.032, 8, 64, Math.PI), faceMat);
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(0.31, 0.065, 0);
  face.add(mouth);
  for (let i = 0; i < 32; i++) {
    const angle = i * 2.4;
    const distance = 1.6 + (i % 8) * 2.15;
    const radius = 0.64 + distance * 0.19;
    const text = new THREE.Mesh(new THREE.PlaneGeometry(0.7 + distance * 0.03, 0.2), new THREE.MeshBasicMaterial({
      map: textTexture([i % 2 ? '0x000000F4' : 'NOT FOUND'], { width: 640, height: 130, size: 49 }),
      transparent: true, opacity: 0.53, side: THREE.DoubleSide,
    }));
    text.position.set(Math.cos(angle) * radius * 0.77, Math.sin(angle) * radius * 0.77, -distance);
    text.rotation.z = angle * 0.1;
    group.add(text);
  }
  return {
    group, face, rings,
    update(time, growth, gentle) {
      const size = 0.9 + growth * 2.7;
      group.scale.set(size, size, 1);
      face.scale.setScalar(1 + growth * 0.12);
      rings.forEach((ring, i) => {
        ring.rotation.z = i * 0.12 + (gentle ? 0 : Math.sin(time * 0.6 + i * 0.4) * growth * 0.04);
      });
    },
  };
}