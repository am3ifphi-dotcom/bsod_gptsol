/* Minimal browser shim so three + the game modules can run under node. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const ROOT = path.resolve(process.cwd(), "public");
const BASE = "http://127.0.0.1:8123";

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("no");
      return;
    }
    const ext = path.extname(p);
    const type =
      ext === ".glb" ? "model/gltf-binary" :
      ext === ".png" ? "image/png" :
      ext === ".jpg" ? "image/jpeg" :
      ext === ".webp" ? "image/webp" :
      ext === ".mp3" ? "audio/mpeg" : "application/octet-stream";
    res.writeHead(200, { "content-type": type, "access-control-allow-origin": "*" });
    res.end(data);
  });
});
await new Promise((r) => server.listen(8123, "127.0.0.1", r));

const OrigRequest = globalThis.Request;
globalThis.Request = class extends OrigRequest {
  constructor(input, init) {
    if (typeof input === "string" && input.startsWith("/")) input = BASE + input;
    super(input, init);
  }
};
const origFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (typeof input === "string" && input.startsWith("/")) input = BASE + input;
  return origFetch(input, init);
};

globalThis.ProgressEvent = class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};
globalThis.Event = globalThis.Event ?? class Event { constructor(t) { this.type = t; } };

/* --- image decoding: no real decoder, hand back a stub bitmap --- */
const IMG = { width: 2, height: 2, close() {} };
globalThis.createImageBitmap = async () => ({ ...IMG });
globalThis.ImageBitmap = class {};

/* --- canvas --- */
const listeners = new Map();
class FakeStyle {
  constructor() { this.transform = ""; this.cursor = ""; }
}
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.style = new FakeStyle();
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    this.clientWidth = 1280;
    this.clientHeight = 720;
  }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  addEventListener(t, f) { if (!listeners.has(this)) listeners.set(this, new Map()); const m = listeners.get(this); if (!m.has(t)) m.set(t, new Set()); m.get(t).add(f); }
  removeEventListener(t, f) { listeners.get(this)?.get(t)?.delete(f); }
  dispatchEvent(e) { listeners.get(this)?.get(e.type)?.forEach((f) => f(e)); return true; }
  setAttribute() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }; }
  setPointerCapture() {}
  get firstElementChild() { return this.children[0] ?? null; }
  focus() {}
}
class FakeCanvasEl extends FakeElement {
  constructor(w = 300, h = 150) {
    super("canvas");
    this._canvas = createCanvas(w, h);
    this.width = w;
    this.height = h;
    this._ctx2d = null;
  }
  getContext(kind) {
    if (kind === "webgl2" || kind === "webgl") {
      if (!this._gl) {
        this._gl = globalThis.makeFakeGL();
        this._gl.canvas = this;
      }
      return this._gl;
    }
    if (kind === "2d") {
      if (!this._ctx2d) this._ctx2d = this._canvas.getContext("2d");
      return this._ctx2d;
    }
    return null;
  }
  toDataURL() { return "data:,"; }
  get clientWidth() { return this.width; }
  get clientHeight() { return this.height; }
  set clientWidth(v) {}
  set clientHeight(v) {}
}
const byId = new Map();
const doc = new FakeElement("document");
doc.createElement = (tag) => (tag === "canvas" ? new FakeCanvasEl(1280, 720) : new FakeElement(tag));
doc.createElementNS = (_ns, tag) => doc.createElement(tag);
doc.getElementById = (id) => byId.get(id) ?? null;
doc.body = new FakeElement("body");
doc.documentElement = new FakeElement("html");
doc.hidden = false;
doc.pointerLockElement = null;
doc.fonts = { ready: Promise.resolve() };
doc.baseURI = BASE + "/";
doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.dispatchEvent({ type: "pointerlockchange" }); };

globalThis.document = doc;
globalThis.window = globalThis;
try { Object.defineProperty(globalThis, "navigator", { value: { userAgent: "node", maxTouchPoints: 0 }, configurable: true }); } catch { /* node navigator */ }
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.HTMLCanvasElement = FakeCanvasEl;
globalThis.self = globalThis;

const winListeners = new Map();
globalThis.addEventListener = (t, f) => {
  if (!winListeners.has(t)) winListeners.set(t, new Set());
  winListeners.get(t).add(f);
};
globalThis.removeEventListener = (t, f) => winListeners.get(t)?.delete(f);
globalThis.dispatchWindow = (type, ev = {}) => winListeners.get(type)?.forEach((f) => f({ type, ...ev }));

globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
let rafId = 0;
const rafs = new Map();
globalThis.requestAnimationFrame = (cb) => {
  const id = ++rafId;
  rafs.set(id, cb);
  return id;
};
globalThis.cancelAnimationFrame = (id) => rafs.delete(id);
globalThis.__runRaf = (now) => {
  const cbs = [...rafs.entries()];
  rafs.clear();
  for (const [, cb] of cbs) cb(now);
};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

/* --- audio --- */
const node = (extra = {}) => ({
  connect() {}, disconnect() {}, start() {}, stop() {},
  gain: { value: 0, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} },
  playbackRate: { value: 1 },
  pan: { value: 0 },
  buffer: null,
  onended: null,
  ...extra,
});
globalThis.AudioContext = class {
  constructor() {
    this.currentTime = 0;
    this.state = "running";
    this.destination = node();
    this.sampleRate = 44100;
  }
  createGain() { return node(); }
  createBufferSource() { return node(); }
  createStereoPanner() { return node(); }
  createAnalyser() { return node({ fftSize: 2048, frequencyBinCount: 1024, getByteFrequencyData() {} }); }
  createBiquadFilter() { return node({ frequency: { value: 1 }, Q: { value: 1 } }); }
  resume() { this.state = "running"; return Promise.resolve(); }
  close() { return Promise.resolve(); }
  decodeAudioData() {
    return Promise.resolve({ duration: 2, length: 88200, numberOfChannels: 2, sampleRate: 44100, getChannelData: () => new Float32Array(88200) });
  }
};

/* pointer lock */
FakeElement.prototype.requestPointerLock = function () {
  doc.pointerLockElement = this;
  doc.dispatchEvent({ type: "pointerlockchange" });
  return Promise.resolve();
};

export const TICKS = { rafs };
export { FakeCanvasEl, doc, server };

/* ---------------- fake WebGL2 ---------------- */
class FakeGLConst {}
globalThis.WebGL2RenderingContext = FakeGLConst;
globalThis.WebGLRenderingContext = FakeGLConst;
globalThis.OffscreenCanvas = class {};

const glProto = {
  getExtension: (name) => ({ name, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF }),
  getSupportedExtensions: () => [],
  getParameter: (p) => {
    if (p === 0x1f02) return "WebGL 2.0 (smoke)";
    if (p === 0x8b8c) return "WebGL GLSL ES 3.00 (smoke)";
    if (p === 0x1f00 || p === 0x1f01) return "smoke";
    if (p === 0x0ba2) return new Int32Array([0, 0, 1280, 720]); // viewport
    if (p === 0x0d3a) return new Int32Array([16384, 16384]);
    if (p === 0x846e) return new Float32Array([1, 1]);
    if (p === 0x846d) return new Float32Array([1, 1]);
    // sizes / counts
    if (typeof p === "number") {
      if (p === 0x8b4d /* MAX_COMBINED_TEXTURE_IMAGE_UNITS */) return 32;
      if (p === 0x8b4c /* MAX_VERTEX_TEXTURE_IMAGE_UNITS */) return 16;
      if (p === 0x8872 /* MAX_TEXTURE_IMAGE_UNITS */) return 16;
      if (p === 0x8dfb || p === 0x8dfc || p === 0x8dfd) return 16;
      if (p === 0x8869) return 16; // MAX_VERTEX_ATTRIBS
      if (p === 0x8b49) return 1024; // MAX_VERTEX_UNIFORM_VECTORS
      if (p === 0x8b4a) return 1024;
      if (p === 0x8b4b) return 1024;
      if (p === 0x8b4f) return 4096;
      if (p === 0x84ff) return 0;
      if (p === 0x0d33) return 16384; // MAX_TEXTURE_SIZE
      if (p === 0x851c) return 16384; // MAX_CUBE_MAP_TEXTURE_SIZE
      if (p === 0x8073) return 2048;
      if (p === 0x886a) return 4096;
      return 16384;
    }
    return 16384;
  },
  getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
  getProgramParameter: (prog, pname) => (pname === 0x8b82 || pname === 0x8b83 ? true : 0),
  getShaderParameter: () => true,
  getProgramInfoLog: () => "",
  getShaderInfoLog: () => "",
  getActiveUniform: () => ({ name: "u", type: 0x1406, size: 1 }),
  getActiveAttrib: () => ({ name: "a", type: 0x1406, size: 1 }),
  getUniformLocation: () => ({}),
  getAttribLocation: () => 0,
  getError: () => 0,
  checkFramebufferStatus: () => 0x8cd5,
  getContextAttributes: () => ({ alpha: true, antialias: false, depth: true, stencil: false }),
  isContextLost: () => false,
  getInternalformatParameter: () => new Int32Array([4]),
  getSyncParameter: () => 0x9119,
  createShader: () => ({ id: "shader" }),
  createProgram: () => ({ id: "program" }),
  createBuffer: () => ({ id: "buffer" }),
  createTexture: () => ({ id: "texture" }),
  createFramebuffer: () => ({ id: "fb" }),
  createRenderbuffer: () => ({ id: "rb" }),
  createVertexArray: () => ({ id: "vao" }),
  createQuery: () => ({ id: "q" }),
  createSampler: () => ({ id: "s" }),
  getProgram: () => 0,
  getShader: () => 0,
};

globalThis.makeFakeGL = () => {
  const gl = Object.create(FakeGLConst.prototype);
  const store = Object.assign({}, glProto, {
    VERSION: 0x1f02, VENDOR: 0x1f00, RENDERER: 0x1f01, SHADING_LANGUAGE_VERSION: 0x8b8c,
    MAX_TEXTURE_SIZE: 0x0d33, MAX_CUBE_MAP_TEXTURE_SIZE: 0x851c, MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8b4d,
    MAX_VERTEX_ATTRIBS: 0x8869, MAX_VERTEX_UNIFORM_VECTORS: 0x8b4a, MAX_VARYING_VECTORS: 0x8b4b,
    MAX_FRAGMENT_UNIFORM_VECTORS: 0x8b49, MAX_SAMPLES: 0x8d57, MAX_ARRAY_TEXTURE_LAYERS: 0x88ff,
    MAX_3D_TEXTURE_SIZE: 0x8073, MAX_RENDERBUFFER_SIZE: 0x84e8, MAX_UNIFORM_BUFFER_BINDINGS: 0x8a2f,
    MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff, SCISSOR_BOX: 0x0c10, VIEWPORT: 0x0ba2,
    ALIASED_LINE_WIDTH_RANGE: 0x846e, ALIASED_POINT_SIZE_RANGE: 0x846d, MAX_VIEWPORT_DIMS: 0x0d3a,
    UNPACK_ROW_LENGTH: 0x0cf2, UNPACK_SKIP_ROWS: 0x0cf3, UNPACK_SKIP_PIXELS: 0x0cf4,
    UNPACK_ALIGNMENT: 0x0cf5, UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
    FRAMEBUFFER_COMPARE: 0x8cd5, FRAMEBUFFER_COMPLETE: 0x8cd5, BROWSER_DEFAULT_WEBGL: 0x9244,
    LINK_STATUS: 0x8b82, VALIDATE_STATUS: 0x8b83, COMPILE_STATUS: 0x8b81,
    ACTIVE_UNIFORMS: 0x8b86, ACTIVE_ATTRIBUTES: 0x8b89, SAMPLES: 0x8d57,
  });
  store.canvas = null;
  store.drawingBufferWidth = 1280;
  store.drawingBufferHeight = 720;
  return new Proxy(gl, {
    get(t, k) {
      if (k in t) return t[k];
      if (k in store) return store[k];
      if (typeof k !== "string") return undefined;
      if (/^[A-Z0-9_]+$/.test(k)) return 1; // constant
      const fn = () => undefined;
      store[k] = fn;
      return fn;
    },
  });
};
