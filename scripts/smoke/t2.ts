import "./shim.mjs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomScene } from "../../src/game/room";
import { WorldScene } from "../../src/game/world";
import type { Assets, ModelName } from "../../src/game/assets";

const loader = new GLTFLoader();
const names: ModelName[] = ["room", "desk", "chair", "crt", "rack", "cray", "board", "cables"];
const files: Record<ModelName, string> = {
  room: "room.glb", desk: "pc_desk.glb", chair: "chair.glb", crt: "crt.glb",
  rack: "rack.glb", cray: "cray.glb", board: "board.glb", cables: "cables.glb",
};
const models = {} as any;
for (const n of names) models[n] = { scene: (await loader.loadAsync(`/models/${files[n]}`)).scene, animations: [] };

const tx = (c: number) => { const t = new THREE.Texture(); t.image = { width: 2, height: 2 }; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; };
const assets = {
  models,
  textures: { wall: tx(1), wallNormal: tx(0), floor: tx(1), floorNormal: tx(0), rug: tx(1), concrete: tx(1), poster: { width: 8, height: 8, src: "" } as any, clock: tx(1) },
  audio: new Map(),
} as unknown as Assets;

const t0 = Date.now();
const room = new RoomScene(assets);
room.build();
console.log("room built in", Date.now() - t0, "ms; scene children", room.scene.children.length);
let n = 0;
room.scene.traverse(() => n++);
console.log("room objects", n);
const info = room.getScreenWorldInfo();
console.log("screen info", info && { c: info.center.toArray().map((v) => +v.toFixed(3)), n: info.normal.toArray(), w: +info.width.toFixed(3), h: +info.height.toFixed(3) });
console.log("focus pose", room.focusPose && room.focusPose.position.toArray().map((v) => +v.toFixed(3)));
console.log("interactables", room.interactables.map((i) => `${i.id}@${i.anchor.toArray().map((v) => v.toFixed(2)).join(",")}`).join(" | "));
console.log("boot", room.boot, "surface.ground(1.35,1.05)", room.surface.ground(1.35, 1.05).toFixed(3));

const clock = { t: 0 };
for (let i = 0; i < 120; i++) {
  clock.t += 1 / 60;
  room.setCorruption(i / 120);
  room.update(1 / 60, clock.t, null);
}
console.log("room update ok @ corruption 1");
room.setCorruption(0);
room.applyAftermath();
room.burst(0, 2.9, 0, 20);
room.setCeilingVisible(false);
for (let i = 0; i < 30; i++) room.update(1 / 60, (clock.t += 1 / 60), null);
room.resetAftermath();
room.setCeilingVisible(true);
console.log("aftermath cycle ok");

const w0 = Date.now();
const world = new WorldScene(assets);
world.build();
console.log("world built in", Date.now() - w0, "ms; children", world.scene.children.length);
console.log("spawn", world.spawn.toArray(), "yaw", +world.spawnYaw.toFixed(3), "plaque", world.plaque.toArray().map((v) => +v.toFixed(2)), "plaqueYaw", +world.plaqueYaw.toFixed(3));
for (let i = 0; i < 90; i++) {
  const t = (clock.t += 1 / 60);
  world.update(1 / 60, t, new THREE.Vector3(21, 1.6, 58));
}
world.setCrack(1);
world.setHole(new THREE.Vector3(0, 0, 0), 8);
world.spawnDebris(60, new THREE.Vector3(0, 0, 0), 6);
world.setCollapse(0.7);
world.setAnomaly(1);
for (let i = 0; i < 60; i++) world.update(1 / 60, (clock.t += 1 / 60), new THREE.Vector3(0, 0, 0));
console.log("world update ok; anomaly", world.anomalyLevel, "wakeFound", world.wakeFound);
console.log("checkWake far", world.checkWake(new THREE.Vector3(0, 0, 0)), "near", world.checkWake(new THREE.Vector3(6.2, 1.6, 12.4)));
console.log("resolve", world.surface.resolve(0, 0, 0.3), "ground", world.surface.ground(5, 5).toFixed(2));
world.reset();
console.log("world reset ok, holeRadius", (world as any).holeRadius);
process.exit(0);
