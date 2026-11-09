/* All custom GLSL lives here so it can be statically validated (npm run check:shaders). */

export const fullscreenVert = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const brightFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uThreshold;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float k = smoothstep(uThreshold, uThreshold + 0.55, l);
  gl_FragColor = vec4(c * k, 1.0);
}
`;

export const blurFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uDir;
void main() {
  vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
  sum += texture2D(tDiffuse, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(tDiffuse, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(tDiffuse, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  sum += texture2D(tDiffuse, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}
`;

export const compositeFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uExposure;
uniform float uBloom;
uniform float uGlitch;     // 0..1 heavy digital tearing
uniform float uChroma;     // rgb split
uniform float uWarp;       // barrel distortion
uniform float uScan;       // scanline strength
uniform float uGrain;
uniform float uVignette;
uniform float uRadial;     // radial zoom blur (falling)
uniform float uFlash;      // white flash
uniform float uPixel;      // pixelation
uniform float uDesat;
uniform float uInvert;
uniform vec3 uTint;
uniform float uInside;     // being pulled into the screen

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);

  // barrel / lens warp
  uv = 0.5 + cc * (1.0 + uWarp * (0.35 + r2 * 1.65));

  // digital tearing: horizontal blocks displaced by hashed rows
  float tq = floor(uTime * 14.0);
  float rows = 26.0 + floor(uGlitch * 46.0);
  float band = floor(uv.y * rows);
  float hb = hash12(vec2(band, tq));
  float tearMask = step(1.0 - uGlitch * 0.85, hb);
  uv.x += (hb - 0.5) * 0.32 * uGlitch * tearMask;
  float band2 = floor(uv.y * 7.0);
  float hb2 = hash12(vec2(band2 + 3.7, floor(uTime * 6.0)));
  uv.x += (hb2 - 0.5) * 0.05 * uGlitch;

  // vertical slice corruption
  float vs = floor(uv.x * 18.0);
  float hv = hash12(vec2(vs, floor(uTime * 9.0)));
  uv.y += step(1.0 - uGlitch * 0.25, hv) * (hv - 0.5) * 0.09 * uGlitch;

  if (uPixel > 0.001) {
    float px = mix(1.0, 0.045, uPixel);
    uv = floor(uv / px) * px + px * 0.5;
  }

  vec2 suv = clamp(uv, vec2(0.0005), vec2(0.9995));

  // radial blur toward centre (fall / plunge)
  vec3 col = vec3(0.0);
  if (uRadial > 0.001) {
    vec2 dir = (0.5 - suv) * uRadial * 0.14;
    float w = 0.0;
    for (int i = 0; i < 8; i++) {
      float f = float(i) / 7.0;
      float ww = 1.0 - f * 0.55;
      col += texture2D(tScene, suv + dir * f).rgb * ww;
      w += ww;
    }
    col /= w;
  } else {
    col = texture2D(tScene, suv).rgb;
  }

  // chromatic aberration
  float ch = uChroma * (0.35 + r2 * 2.2);
  if (ch > 0.0002) {
    vec2 off = (suv - 0.5) * ch * 0.075;
    col.r = texture2D(tScene, suv + off).r;
    col.b = texture2D(tScene, suv - off).b;
    if (uGlitch > 0.35) {
      col.g = texture2D(tScene, suv + off * 0.35).g;
    } else {
      col.g = texture2D(tScene, suv).g;
    }
  }

  vec3 bloom = texture2D(tBloom, suv).rgb;
  col += bloom * uBloom;

  // scanlines & shadow mask
  float scan = 1.0 - uScan * (0.5 + 0.5 * sin(suv.y * uRes.y * 1.7));
  col *= mix(1.0, scan, 0.85);

  // grain
  float g = hash12(suv * uRes * 0.5 + fract(uTime) * 91.7) - 0.5;
  col += g * uGrain;

  // subtle blue-black crush
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uDesat);
  col = mix(col, 1.0 - col, uInvert);
  col *= uTint;

  // vignette (stronger when inside)
  float vig = smoothstep(1.05, 0.15, r2 * (2.1 + uVignette * 1.6));
  col *= mix(1.0, vig, clamp(uVignette, 0.0, 1.0) * 0.95 + 0.05);

  // inner rectangle edge for the "swallowed" state
  col = mix(col, col * 0.15, uInside * smoothstep(0.35, 1.15, r2 * 2.2));

  col *= uExposure;
  col = aces(col);
  col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));

  // dithering to avoid banding in dark rooms
  col += (hash12(suv * uRes) - 0.5) * (1.0 / 255.0);

  gl_FragColor = vec4(col, 1.0);
}
`;

export const screenVert = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vViewPos;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

/* The BSOD monitor surface: CRT curvature, per-row tearing, glow, vignette. */
export const screenFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vViewPos;

uniform sampler2D uMap;
uniform float uTime;
uniform float uCorruption;
uniform float uFlash;
uniform float uBright;
uniform vec2 uMouse;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;

  // CRT barrel + rounded corners
  vec2 cc = uv - 0.5;
  uv = 0.5 + cc * (1.0 + 0.055 * dot(cc, cc));
  float corner = 1.0 - smoothstep(0.497, 0.505, max(abs(uv.x), abs(uv.y)));
  if (corner <= 0.0) discard;

  // horizontal tearing that grows with corruption
  float rows = 34.0 + floor(uCorruption * 70.0);
  float band = floor(uv.y * rows);
  float h = hash12(vec2(band, floor(uTime * (8.0 + uCorruption * 26.0))));
  float tear = step(0.94 - uCorruption * 0.42, h);
  uv.x += (h - 0.5) * 0.22 * tear * (0.25 + uCorruption);

  // whole-screen wobble
  uv.x += sin(uv.y * 7.0 + uTime * 1.6) * 0.0022 * (1.0 + uCorruption * 3.0);
  uv.y += sin(uv.x * 5.0 - uTime * 2.1) * 0.0016 * (1.0 + uCorruption * 3.0);

  // the face leans toward the cursor as it wakes up
  vec2 pull = (uMouse - 0.5) * uCorruption * 0.05;
  uv -= pull;

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.02, 0.09, 1.0);
    return;
  }

  vec3 col;
  float split = 0.0015 + uCorruption * 0.006;
  col.r = texture2D(uMap, uv + vec2(split, 0.0)).r;
  col.g = texture2D(uMap, uv).g;
  col.b = texture2D(uMap, uv - vec2(split, 0.0)).b;

  // scanlines: the BSOD is being displayed on glass
  float lines = sin(uv.y * 190.0) * 0.5 + 0.5;
  col *= 1.0 - 0.11 * lines;
  col *= 1.0 + 0.05 * sin(uTime * 47.0);

  // phosphor bloom near white text
  float lum = max(max(col.r, col.g), col.b);
  col += vec3(0.06, 0.14, 0.3) * smoothstep(0.55, 1.0, lum) * (0.6 + uCorruption);

  // edge darkening + reflection sheen
  float vig = smoothstep(0.86, 0.28, length(cc) * 1.35);
  col *= mix(0.62, 1.0, vig);
  float sheen = smoothstep(0.55, 0.0, distance(uv, vec2(0.28, 0.86))) * 0.07;
  col += sheen;

  col *= uBright;
  col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ---------------- world ---------------- */

export const groundVert = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying float vHeight;
varying vec3 vNormal;

float hAt(vec2 p) {
  float h = 0.0;
  h += sin(p.x * 0.062) * cos(p.y * 0.049) * 0.72;
  h += sin((p.x * 0.7 + p.y * 0.8) * 0.135) * 0.34;
  h += sin(p.x * 0.021 + 1.7) * cos(p.y * 0.017 - 0.6) * 1.35;
  return h;
}

void main() {
  vec3 pos = position;
  float h = hAt(pos.xz);
  pos.y += h;
  vHeight = h;
  float e = 0.75;
  float hx = hAt(pos.xz + vec2(e, 0.0)) - hAt(pos.xz - vec2(e, 0.0));
  float hz = hAt(pos.xz + vec2(0.0, e)) - hAt(pos.xz - vec2(0.0, e));
  vNormal = normalize(vec3(-hx, 2.0 * e, -hz));
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const groundFrag = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying float vHeight;
varying vec3 vNormal;

uniform float uTime;
uniform vec3 uHole;        // xz centre, y unused
uniform float uHoleRadius;
uniform float uCrack;      // 0..1 crack network intensity
uniform vec3 uBase;
uniform vec3 uLine;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform vec2 uPlayer;
uniform float uPulse;
uniform vec3 uLightDir;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 p = vWorld.xz;

  // jagged hole around the player (used by the collapse sequence)
  vec2 dh = p - uHole.xz;
  float dist = length(dh);
  float ang = atan(dh.y, dh.x);
  float jag = (noise2(vec2(ang * 4.5, uTime * 0.25)) - 0.5) * 0.55
            + (noise2(vec2(ang * 13.0, 3.1)) - 0.5) * 0.18;
  float holeR = uHoleRadius * (1.0 + jag);
  if (dist < holeR && uHoleRadius > 0.01) discard;

  // ground fog / distance
  float camDist = length(vWorld - vec3(uPlayer.x, vWorld.y, uPlayer.y));
  float fog = smoothstep(uFogNear, uFogFar, camDist);

  // circuit grid
  vec2 grid = abs(fract(p * 0.5) - 0.5);
  float gline = smoothstep(0.482, 0.5, max(grid.x, grid.y));
  float glineFar = smoothstep(0.4, 0.5, max(grid.x, grid.y));

  // large tile seams
  vec2 tile = abs(fract(p * 0.0833) - 0.5);
  float seam = smoothstep(0.47, 0.5, max(tile.x, tile.y));

  // crack network
  float n = noise2(p * 0.35 + vec2(0.0, uTime * 0.02));
  float crack = smoothstep(0.48, 0.52, abs(n - 0.5) * 2.0 * (0.15 + uCrack * 0.85));
  crack = max(crack, smoothstep(0.46, 0.5, abs(noise2(p * 1.35) - 0.5) * (0.2 + uCrack)));

  float glowPulse = 0.65 + 0.35 * sin(uTime * 1.6 + n * 9.0) + uPulse * 0.5;
  float nearHole = 1.0 - smoothstep(0.0, 14.0, max(dist - holeR, 0.0));

  vec3 col = uBase;
  col += uLine * gline * 0.55 * (1.0 - fog * 0.6) * glowPulse;
  col += uLine * glineFar * 0.16 * glowPulse;
  col += uLine * seam * 0.35;

  vec3 crackCol = mix(uLine, vec3(1.0, 0.86, 0.9), 0.35);
  float crackGlow = crack * (0.35 + uCrack * 2.2) * (0.7 + 0.3 * sin(uTime * 3.0 + p.x * 0.4));
  col += crackCol * crackGlow;
  col += crackCol * nearHole * (0.25 + uCrack * 1.4) * 0.5;

  // lambert-ish key light so the dunes read in 3D
  float ndl = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
  col *= 0.55 + 0.75 * ndl;
  col += uLine * 0.06 * ndl;
  col *= 0.9 + vHeight * 0.1;
  col = mix(col, uFog, fog * 0.95);

  gl_FragColor = vec4(col, 1.0);
}
`;

export const skyFrag = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec2 vUv;
uniform float uWorldY;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 d = normalize(vWorld);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 low = vec3(0.012, 0.035, 0.075);
  vec3 mid = vec3(0.02, 0.075, 0.17);
  vec3 high = vec3(0.004, 0.012, 0.03);
  vec3 col = mix(low, mid, smoothstep(0.35, 0.52, h));
  col = mix(col, high, smoothstep(0.55, 0.95, h));

  // faint data-rain streaks in the upper hemisphere
  float a = atan(d.z, d.x);
  float bands = sin(a * 22.0 + d.y * 9.0) * 0.5 + 0.5;
  col += vec3(0.05, 0.12, 0.24) * pow(bands, 14.0) * smoothstep(0.45, 1.0, h) * 0.55;

  // horizon glow
  col += vec3(0.05, 0.14, 0.32) * smoothstep(0.18, 0.0, abs(d.y - 0.02)) * 0.5;

  gl_FragColor = vec4(col, 1.0);
}
`;

export const skyVert = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vWorld = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
