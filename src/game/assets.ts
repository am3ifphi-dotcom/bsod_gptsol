import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export type ModelName = "room" | "desk" | "chair" | "crt" | "rack" | "cray" | "board" | "cables";

const MODEL_FILES: Record<ModelName, string> = {
  room: "/models/room.glb",
  desk: "/models/pc_desk.glb",
  chair: "/models/chair.glb",
  crt: "/models/crt.glb",
  rack: "/models/rack.glb",
  cray: "/models/cray.glb",
  board: "/models/board.glb",
  cables: "/models/cables.glb",
};

export const AUDIO_FILES = [
  "aftermath_piano",
  "anomaly_tremor",
  "bgm_dread_drone",
  "bgm_glitch_world",
  "breathing_panic",
  "clock_tick",
  "console_error",
  "core_scanner",
  "creak_room",
  "dissonance",
  "earthquake",
  "fall_wind",
  "flesh_pulse",
  "footstep_wood",
  "gasp",
  "ghost_cantata",
  "glitch_short",
  "glitch_slice",
  "glitch_stutter",
  "heartbeat",
  "horror_riser",
  "key1",
  "key2",
  "key3",
  "key4",
  "land_impact",
  "monitor_glitch",
  "mouse_click",
  "noise_wave",
  "pc_fan_hum",
  "reality_rift",
  "room_tone",
  "shatter",
  "static_elec",
  "sub_boom",
  "swoosh_thunder",
  "tape_stop",
  "transition_solemn",
  "void_swell",
  "whoosh_cyber",
  "wormhole_suck",
] as const;

export type AudioName = (typeof AUDIO_FILES)[number];

export interface Assets {
  models: Record<ModelName, LoadedModel>;
  textures: {
    wall: THREE.Texture;
    wallNormal: THREE.Texture;
    floor: THREE.Texture;
    floorNormal: THREE.Texture;
    rug: THREE.Texture;
    concrete: THREE.Texture;
    poster: HTMLImageElement;
    clock: THREE.Texture;
  };
  audio: Map<AudioName, AudioBuffer>;
}

const texLoader = new THREE.TextureLoader();

const loadTexture = (url: string, srgb = true, repeat?: [number, number]) =>
  new Promise<THREE.Texture>((resolve, reject) => {
    texLoader.load(
      url,
      (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        if (repeat) t.repeat.set(repeat[0], repeat[1]);
        t.anisotropy = 8;
        resolve(t);
      },
      undefined,
      reject,
    );
  });

export const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });

export async function loadAssets(
  audioCtx: AudioContext,
  onProgress: (info: { label: string; progress: number }) => void,
): Promise<Assets> {
  const gltf = new GLTFLoader();
  const modelEntries = Object.entries(MODEL_FILES) as [ModelName, string][];
  const models = {} as Record<ModelName, LoadedModel>;

  let done = 0;
  const total = modelEntries.length + 6 + AUDIO_FILES.length;
  const step = (label: string) => {
    done++;
    onProgress({ label, progress: done / total });
  };

  for (const [name, url] of modelEntries) {
    onProgress({ label: `MODEL ${name}`, progress: done / total });
    const g = await gltf.loadAsync(url);
    models[name] = { scene: g.scene, animations: g.animations };
    step(`MODEL ${name}`);
  }

  onProgress({ label: "TEXTURES", progress: done / total });
  const [wall, wallNormal, floor, floorNormal, rug, concrete, poster] = await Promise.all([
    loadTexture("/textures/room/wall.png", true, [2, 2]),
    loadTexture("/textures/room/wall_nrm.png", false, [2, 2]),
    loadTexture("/textures/room/floor.png", true, [3, 3]),
    loadTexture("/textures/room/floor_nrm.png", false, [3, 3]),
    loadTexture("/textures/room/rug.png", true),
    loadTexture("/textures/concrete.webp", true, [10, 10]),
    loadImage("/textures/art/poster1.jpg"),
  ]);
  done += 6;
  const clock = await loadTexture("/textures/clock.webp", true);
  const audio = new Map<AudioName, AudioBuffer>();

  await Promise.all(
    AUDIO_FILES.map(async (name) => {
      try {
        const res = await fetch(`/audio/${name}.mp3`);
        const buf = await res.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(buf);
        audio.set(name, decoded);
      } catch (err) {
        console.warn("audio failed", name, err);
      }
      step(`AUDIO ${name}`);
    }),
  );

  return {
    models,
    textures: { wall, wallNormal, floor, floorNormal, rug, concrete, poster, clock },
    audio,
  };
}
