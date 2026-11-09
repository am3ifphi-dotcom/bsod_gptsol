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
room.scene.updateMatrixWorld(true);
const rows: { name: string; box: THREE.Box3 }[] = [];
room.scene.children.forEach((c, i) => {
  const b = new THREE.Box3().setFromObject(c);
  rows.push({ name: `${i}:${c.type}:${c.name || ""}`, box: b });
});
for (const r of rows) {
  const { min, max } = r.box;
  const f = (v: THREE.Vector3) => v.toArray().map((n) => +n.toFixed(2)).join(",");
  const outside = min.x < -2.2 || max.x > 2.9 || min.z < -3.0 || max.z > 1.8 || min.y < -0.06 || max.y > 3.4;
  if (outside || rows.length < 70) console.log(r.name.padEnd(28), `[${f(min)}] .. [${f(max)}]`, outside ? "  <-- outside" : "");
}
console.log("--- colliders ---");
for (const c of (room as any).colliders) console.log(JSON.stringify(c));
console.log("--- resolve tests ---");
for (const [x, z, fx, fz] of [[1.35, 1.05, 1.35, 1.05], [-1.0, 0.7, -0.7, 0.72], [-1.5, 0.7, -0.9, 0.7], [0.2, -2.0, 0.2, -1.9], [2.6, -0.5, 2.3, -0.5], [-2.0, 1.6, -1.9, 1.4], [-0.4, 0.2, -0.4, 0.2]]) {
  console.log(`resolve(${x},${z}) from (${fx},${fz})`, room.surface.resolve(x, z, 0.3, fx, fz), "ground", +room.surface.ground(x, z).toFixed(2));
}
process.exit(0);
