import "./shim.mjs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Assets, ModelName } from "../../src/game/assets";
import { Engine } from "../../src/game/engine";

const loader = new GLTFLoader();
const files: Record<ModelName, string> = {
  room: "room.glb", desk: "pc_desk.glb", chair: "chair.glb", crt: "crt.glb",
  rack: "rack.glb", cray: "cray.glb", board: "board.glb", cables: "cables.glb",
};
const models = {} as any;
for (const n of Object.keys(files) as ModelName[]) models[n] = { scene: (await loader.loadAsync(`/models/${files[n]}`)).scene, animations: [] };
const tx = () => { const t = new THREE.Texture(); t.image = { width: 2, height: 2 }; t.needsUpdate = true; return t; };
const assets = {
  models,
  textures: { wall: tx(), wallNormal: tx(), floor: tx(), floorNormal: tx(), rug: tx(), concrete: tx(), poster: {} as any, clock: tx() },
  audio: new Map(),
} as unknown as Assets;

const canvas = (document as any).createElement("canvas") as HTMLCanvasElement;
const logs: string[] = [];
const ui: any[] = [];
const engine = new Engine(canvas, assets, new AudioContext(), {
  onUI: (p) => ui.push(p),
  onLine: (l) => logs.push(`[${l.kind}] ${l.text}`),
  onClearConsole: () => logs.push("-- cleared --"),
});
await engine.init();
console.log("engine init ok, phase", engine.currentPhase);

const dt = 1 / 60;
let clock = 0;
const step = (n = 1) => {
  for (let i = 0; i < n; i++) {
    clock += dt;
    (engine as any).update(dt);
  }
};
const at = () => (engine as any);

engine.start();
step(30);
console.log("after start:", engine.currentPhase, "prompt", at().hudPrompt, "active", at().activeInteract);

// walk toward the desk by teleporting the player
const p = at().player as any;
p.eye.set(-0.55, 0.02 + 1.62, 0.72);
p.yaw = Math.atan2(-(-1.736 - p.eye.x), -(0.864 - p.eye.z));
p.pitch = -0.25;
step(4);
console.log("near desk: active", at().activeInteract, "prompt", JSON.stringify(at().hudPrompt));
engine.interact();
step(20);
console.log("phase", engine.currentPhase, "cursor", at().hot, "cam", at().camPos.toArray().map((v: number) => +v.toFixed(3)));
step(60);
console.log("focused cam", at().camPos.toArray().map((v: number) => +v.toFixed(2)), "pitch", +at().pitch.toFixed(3), "yaw", +at().yaw.toFixed(3));

// click the face
for (let i = 0; i < 9; i++) {
  at().clickLock = 0;
  at().hitFace(0.13);
  step(2);
}
console.log("after clicks corruption", +at().corruption.toFixed(2), "phase", engine.currentPhase);

let guard = 0;
while (engine.currentPhase === "eaten" && guard++ < 400) step(1);
console.log("eaten finished in", guard, "frames -> phase", engine.currentPhase, "seqT", +at().seqT.toFixed(2));

// world arrival
step(120);
console.log("world: player", at().player.eye.toArray().map((v: number) => +v.toFixed(2)), "enabled", at().player.enabled, "phase", engine.currentPhase);

// teleport near the plaque
at().player.eye.set(6.2, at().player.eye.y, 20);
at().triggerWake;
step(4);
console.log("found?", at().found, "objective", at().currentObjective);

engine.openConsole();
engine.submitCommand("help");
engine.submitCommand("ls");
engine.submitCommand("cat .wake");
engine.submitCommand("whoami");
engine.submitCommand("nonsense");
engine.submitCommand("wake_up");
step(2);
console.log("console open?", at().isConsoleOpen, "phase", engine.currentPhase);
console.log(logs.join("\n"));
let g2 = 0;
while (engine.currentPhase !== "aftermath" && g2++ < 2000) step(1);
console.log("reached", engine.currentPhase, "after", g2, "frames =", (g2 / 60).toFixed(1), "s");
step(120);
console.log("aftermath: player", at().player.eye.toArray().map((v: number) => +v.toFixed(2)), "enabled", at().player.enabled, "ended", at().ended);
console.log("UI phase seq:", [...new Set(ui.map((u) => u.phase).filter(Boolean))].join(" -> "));
engine.restart();
step(10);
console.log("restart -> phase", engine.currentPhase, "ceiling?", at().room.ceilingMesh.visible);
process.exit(0);
