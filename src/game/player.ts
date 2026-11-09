import * as THREE from "three";
import type { Input } from "./input";
import { clamp, damp, TAU } from "./util";

export interface WalkSurface {
  /** Floor height (y of the walkable surface) at a world position. */
  ground(x: number, z: number): number;
  /** Push the capsule out of geometry; returns corrected x/z. */
  resolve(x: number, z: number, radius: number, fromX?: number, fromZ?: number): { x: number; z: number };
}

export class FirstPerson {
  readonly eye = new THREE.Vector3(0, 1.62, 0);
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  roll = 0;
  eyeHeight = 1.62;
  radius = 0.3;
  sensitivity = 0.0022;
  enabled = true;
  running = false;
  bob = 0;
  private bobPhase = 0;
  private stepFlag = false;
  private landDip = 0;
  private landDipVel = 0;
  private baseY = 1.62;
  onStep?: (running: boolean) => void;

  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private wish = new THREE.Vector3();

  reset(x: number, z: number, yaw = 0, surface?: WalkSurface) {
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.vel.set(0, 0, 0);
    this.baseY = (surface ? surface.ground(x, z) : 0) + this.eyeHeight;
    this.eye.set(x, this.baseY, z);
    this.bob = 0;
    this.bobPhase = 0;
    this.landDip = 0;
    this.landDipVel = 0;
  }

  addLook(dx: number, dy: number) {
    this.yaw -= dx * this.sensitivity;
    this.pitch = clamp(this.pitch - dy * this.sensitivity, -1.45, 1.45);
    this.yaw = ((this.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
  }

  /** Camera-space impulse used when landing after a fall. */
  impulse(strength: number) {
    this.landDipVel -= strength;
  }

  update(dt: number, input: Input, surface: WalkSurface, opts: { speedScale?: number } = {}) {
    dt = Math.min(dt, 1 / 20);
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const axis = this.enabled ? input.moveAxis() : { x: 0, y: 0 };
    this.running = this.enabled && (input.keys.has("ShiftLeft") || input.keys.has("ShiftRight"));
    const scale = opts.speedScale ?? 1;
    const targetSpeed = (this.running ? 4.15 : 2.35) * scale * (this.enabled ? 1 : 0);

    this.wish.set(0, 0, 0).addScaledVector(this.forward, axis.y).addScaledVector(this.right, axis.x);
    if (this.wish.lengthSq() > 1e-6) this.wish.normalize().multiplyScalar(targetSpeed);

    const accel = targetSpeed > 0 ? 13 : 11;
    this.vel.x = damp(this.vel.x, this.wish.x, accel, dt);
    this.vel.z = damp(this.vel.z, this.wish.z, accel, dt);

    const nextX = this.eye.x + this.vel.x * dt;
    const nextZ = this.eye.z + this.vel.z * dt;
    const resolved = surface.resolve(nextX, nextZ, this.radius, this.eye.x, this.eye.z);
    // detect blocking to kill velocity so we don't stick to walls
    if (Math.abs(resolved.x - nextX) > 1e-4) this.vel.x *= 0.25;
    if (Math.abs(resolved.z - nextZ) > 1e-4) this.vel.z *= 0.25;
    this.eye.x = resolved.x;
    this.eye.z = resolved.z;

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const groundY = surface.ground(this.eye.x, this.eye.z);

    // head bob: vertical + tiny lateral sway, phase locked to stride
    if (speed > 0.15) {
      this.bobPhase += dt * (this.running ? 10.4 : 7.3) * clamp(speed / 2.4, 0.45, 1.6);
      const target = Math.min(speed / 4.2, 1) * (this.running ? 0.052 : 0.032);
      this.bob = damp(this.bob, target, 8, dt);
    } else {
      this.bob = damp(this.bob, 0, 6, dt);
      this.bobPhase += dt * 1.2;
    }
    const bobY = Math.sin(this.bobPhase * 2) * this.bob;
    const bobRoll = Math.cos(this.bobPhase) * this.bob * 0.16;

    // stepping
    const s = Math.sin(this.bobPhase * 2);
    if (s < -0.92 && !this.stepFlag && speed > 0.4) {
      this.stepFlag = true;
      this.onStep?.(this.running);
    } else if (s > 0) {
      this.stepFlag = false;
    }

    // land dip spring
    const k = 90;
    const c = 15;
    this.landDipVel += (-this.landDip * k - this.landDipVel * c) * dt;
    this.landDip += this.landDipVel * dt;

    const targetY = groundY + this.eyeHeight;
    this.baseY = Math.abs(targetY - this.baseY) > 1.6 ? targetY : this.baseY + (targetY - this.baseY) * (1 - Math.exp(-16 * dt));

    this.roll = damp(this.roll, bobRoll, 6, dt);
    this.eye.y = this.baseY + bobY + this.landDip * 0.35;
  }

  applyToCamera(camera: THREE.PerspectiveCamera) {
    camera.position.copy(this.eye);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(this.yaw);
    camera.rotateX(this.pitch);
    camera.rotateZ(this.roll + this.landDip * 0.12);
  }

  get heading() {
    return this.yaw;
  }

  lookDirection(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
  }
}
