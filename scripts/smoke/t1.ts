import "./shim.mjs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
console.log("loading...");
const g = await loader.loadAsync("/models/room.glb");
let meshes = 0, verts = 0;
g.scene.traverse((o: any) => { if (o.isMesh) { meshes++; verts += o.geometry.attributes.position.count; } });
console.log("room meshes", meshes, "verts", verts);
const d = await loader.loadAsync("/models/pc_desk.glb");
console.log("desk children", d.scene.children.length);
process.exit(0);
