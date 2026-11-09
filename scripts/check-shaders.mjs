import { readFileSync } from "node:fs";
import { formatDiagnostic, validate } from "@moreplease/glslang";

const src = readFileSync(new URL("../src/game/shaders.ts", import.meta.url), "utf8");
const blocks = new Map();
const re = /export const (\w+) = \/\* glsl \*\/\s*`([\s\S]*?)`;/g;
let m;
while ((m = re.exec(src))) blocks.set(m[1], m[2]);
if (!blocks.size) {
  console.error("no shader blocks found");
  process.exit(1);
}

const VS_PRELUDE = `precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;
uniform mat3 normalMatrix;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
`;
const FS_PRELUDE = `precision highp float;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
`;

const pairs = [
  ["fullscreenVert", "brightFrag"],
  ["fullscreenVert", "blurFrag"],
  ["fullscreenVert", "compositeFrag"],
  ["screenVert", "screenFrag"],
  ["groundVert", "groundFrag"],
  ["skyVert", "skyFrag"],
];

let failed = 0;
for (const [vs, fs] of pairs) {
  if (!blocks.has(vs) || !blocks.has(fs)) {
    console.error(`missing shader: ${vs} / ${fs}`);
    failed++;
    continue;
  }
  const res = await validate(
    [
      { name: `${vs}.vert`, source: VS_PRELUDE + blocks.get(vs) },
      { name: `${fs}.frag`, source: FS_PRELUDE + blocks.get(fs) },
    ],
    { target: "webgl2" },
  );
  if (!res.ok) {
    failed++;
    console.error(`\n✗ ${vs} + ${fs}`);
    for (const d of res.diagnostics) console.error("  " + formatDiagnostic(d));
  } else {
    console.log(`✓ ${vs} + ${fs}`);
  }
}

if (failed) process.exit(1);
