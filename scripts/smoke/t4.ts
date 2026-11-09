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

/* virtual timers so scripted delays resolve deterministically */
let vnow = 0;
let tid = 0;
let timers: { id: number; t: number; fn: () => void }[] = [];
const realSetTimeout = globalThis.setTimeout;
(globalThis as any).setTimeout = ((fn: () => void, ms = 0) => {
  const id = ++tid;
  timers.push({ id, t: vnow + ms, fn });
  return id as any;
}) as any;
(globalThis as any).clearTimeout = ((id: number) => { timers = timers.filter((x) => x.id !== id); }) as any;
const flush = () => {
  let guard = 0;
  for (;;) {
    const due = timers.filter((t) => t.t <= vnow).sort((a, b) => a.t - b.t);
    if (!due.length || guard++ > 500) break;
    for (const d of due) {
      timers = timers.filter((x) => x.id !== d.id);
      d.fn();
    }
  }
};

const canvas = (document as any).createElement("canvas") as HTMLCanvasElement;
const ui: any[] = [];
const lines: string[] = [];
const engine = new Engine(canvas, assets, new AudioContext(), {
  onUI: (p) => ui.push({ ...p, _t: +vnow.toFixed(0) }),
  onLine: (l) => lines.push(`[${l.kind}] ${l.text}`),
  onClearConsole: () => lines.push("-- cleared --"),
});
await engine.init();
engine.start();
const dt = 1 / 60;
const e: any = engine;
const step = (n = 1) => {
  for (let i = 0; i < n; i++) {
    vnow += 1000 / 60;
    flush();
    if (!e.paused) e.update(dt);
    if (!Number.isFinite(e.camPos.x + e.camPos.y + e.camPos.z)) throw new Error("NaN camera at frame " + i + " phase " + e.phase);
  }
};
step(30);
console.log("room ok. phase", engine.currentPhase);

e.player.eye.set(-0.55, 1.64, 0.72);
e.player.yaw = Math.atan2(-(-1.736 + 0.55), -(0.864 - 0.72));
e.player.pitch = -0.28;
step(4);
engine.interact();
step(70);
console.log("paused after focus:", e.paused, "phase", engine.currentPhase);
console.log("focus done cam", e.camPos.toArray().map((v: number) => +v.toFixed(3)), "cursorHot", e.hot);

// mouse-over the face via a synthetic move at screen centre
e.onMouseMove({ clientX: 640, clientY: 300 });
console.log("hover over face:", e.hot, "uv", e.cursorNdc.toArray().map((v: number) => +v.toFixed(2)));
for (let i = 0; i < 10; i++) { e.clickLock = 0; e.hitFace(0.12); step(2); }
console.log("corruption", +e.corruption.toFixed(2), "phase", engine.currentPhase);

let frames = 0;
while (engine.currentPhase === "eaten" && frames++ < 400) step(1);
console.log("eaten ->", engine.currentPhase, "after", frames, "frames; cam", e.camPos.toArray().map((v: number) => +v.toFixed(2)), "fov", +e.fov.toFixed(1));

step(90);
console.log("world rising done: busy", e.uiCache.busy, "enabled", e.player.enabled, "eye", e.player.eye.toArray().map((v: number) => +v.toFixed(2)));

// walk to the plaque (teleport), discover
e.player.eye.set(6.2, e.player.eye.y, 22);
step(6);
console.log("objective after discovery:", e.currentObjective, "| hint:", e.uiCache.hint, "| found", e.found);
console.log("subtitle:", JSON.stringify(e.uiCache.subtitle));

// console
engine.openConsole();
for (const c of ["status", "cat core.log", "sudo rm -rf /", "wake_up"]) engine.submitCommand(c);
console.log("console closed?", !e.isConsoleOpen);
let cf = 0;
while (engine.currentPhase !== "collapse" && cf++ < 400) step(1);
console.log("collapse started after", cf, "frames; phase", engine.currentPhase);
let af = 0;
while (engine.currentPhase !== "aftermath" && af++ < 3000) step(1);
console.log("aftermath reached after", af, "frames =", (af / 60).toFixed(1), "s; phase", engine.currentPhase);
step(150);
console.log("aftermath: eye", e.player.eye.toArray().map((v: number) => +v.toFixed(2)), "enabled", e.player.enabled, "ended", e.ended, "objective", e.currentObjective, "ceiling", e.room.ceilingMesh.visible);

// restart via monitor interaction
e.player.eye.set(-0.55, 1.64, 0.72);
e.player.yaw = Math.atan2(-(-1.736 + 0.55), -(0.864 - 0.72));
e.activeInteract = "monitor";
engine.interact();
step(130);
console.log("restart ->", engine.currentPhase, "eye", e.player.eye.toArray().map((v: number) => +v.toFixed(2)), "world.hole", e.world.holeRadius, "wake", e.world.wakeFound);

console.log("UI states:", ui.filter((u) => u.phase).map((u) => `${u.phase}@${u._t}`).join(" -> "));
console.log("objectives:", ui.filter((u) => "objective" in u).map((u) => `${u._t}:${u.objective}`).join(" | "));
console.log("FINAL OK");
process.exit(0);
