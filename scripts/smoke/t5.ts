import "./shim.mjs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Assets, ModelName } from "../../src/game/assets";
import { RoomScene } from "../../src/game/room";

const loader = new GLTFLoader();
const files: Record<ModelName, string> = {
  room: "room.glb", desk: "pc_desk.glb", chair: "chair.glb", crt: "crt.glb",
  rack: "rack.glb", cray: "cray.glb", board: "board.glb", cables: "cables.glb",
};
const models = {} as any;
for (const n of Object.keys(files) as ModelName[]) models[n] = { scene: (await loader.loadAsync(`/models/${files[n]}`)).scene, animations: [] };
const tx = () => { const t = new THREE.Texture(); t.image = { width: 2, height: 2 }; t.needsUpdate = true; return t; };
const assets = { models, textures: { wall: tx(), wallNormal: tx(), floor: tx(), floorNormal: tx(), rug: tx(), concrete: tx(), poster: {} as any, clock: tx() }, audio: new Map() } as unknown as Assets;

const room = new RoomScene(assets);
room.build();
const info = room.getScreenWorldInfo()!;
const cam = new THREE.PerspectiveCamera(56, 16 / 9, 0.03, 100);
cam.position.copy(info.focusPos);
cam.lookAt(info.center);
cam.updateMatrixWorld(true);
console.log("cam", cam.position.toArray().map((v) => +v.toFixed(3)), "target", info.center.toArray().map((v) => +v.toFixed(3)));
for (const [x, y] of [[0, 0], [0, 0.5], [0, -0.5], [-0.5, 0], [0.5, 0], [0.3, 0.3]]) {
  const pick = room.pickScreen(new THREE.Vector2(x, y), cam);
  console.log(`ndc(${x},${y}) -> hit ${pick.hit} uv ${pick.uv ? pick.uv.toArray().map((v: number) => +v.toFixed(3)) : "-"} face ${pick.overFace}`);
}
// where is the mesh in view space / how big on screen
const mesh = (room as any).screenMesh as THREE.Mesh;
const box = new THREE.Box3().setFromObject(mesh);
console.log("mesh world box", box.min.toArray().map((v) => +v.toFixed(3)), box.max.toArray().map((v) => +v.toFixed(3)));
const p = new THREE.Vector3();
const uvAttr = mesh.geometry.attributes.uv;
console.log("uv attr", Array.from(uvAttr.array as Float32Array).map((v) => +v.toFixed(2)), "index", Array.from(mesh.geometry.index?.array ?? []));
const posAttr = mesh.geometry.attributes.position;
for (let i = 0; i < posAttr.count; i++) {
  p.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
  console.log(` vert${i} world`, p.toArray().map((v) => +v.toFixed(3)), "uv", uvAttr.getX(i), uvAttr.getY(i));
}
process.exit(0);
