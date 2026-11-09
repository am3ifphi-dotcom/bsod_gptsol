import type * as THREE from "three";

export type Phase =
  | "boot"
  | "title"
  | "room"
  | "focus"
  | "eaten"
  | "world"
  | "collapse"
  | "landing"
  | "aftermath";

export interface Interactable {
  id: string;
  anchor: THREE.Vector3;
  radius: number;
  label: string;
  hint?: string;
  onInteract: () => void;
  isActive?: () => boolean;
}

export interface FocusPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export interface Subtitle {
  text: string;
  sub?: string;
  duration: number;
  id: number;
}
