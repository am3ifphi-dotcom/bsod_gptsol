import { clamp } from "./util";

type KeyHandler = (code: string, event: KeyboardEvent) => void;

/**
 * Keyboard / mouse / touch plumbing.
 * Pointer lock is requested on demand; when the browser refuses it (iframes, iOS)
 * we silently fall back to click-drag look so the experience is never blocked.
 */
export class Input {
  readonly keys = new Set<string>();
  pointerLocked = false;
  lockDenied = false;
  lookX = 0;
  lookY = 0;
  clickCount = 0;
  dragLook = false;
  private dragging = false;
  private dragDist = 0;
  private lastPointer = { x: 0, y: 0 };
  private keyDownHandlers = new Set<KeyHandler>();
  private keyUpHandlers = new Set<KeyHandler>();
  private clickHandlers = new Set<(x: number, y: number) => void>();
  private wheelHandlers = new Set<(dy: number) => void>();
  enabled = true;
  /** When true we are in a DOM-input mode (console/pause) and ignore gameplay keys. */
  textMode = false;

  constructor(private dom: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    dom.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    dom.addEventListener("wheel", this.onWheel, { passive: false });
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("pointerlockerror", this.onLockError);
    dom.addEventListener("touchstart", this.onTouchStart, { passive: false });
    dom.addEventListener("touchmove", this.onTouchMove, { passive: false });
    dom.addEventListener("touchend", this.onTouchEnd);
    window.addEventListener("contextmenu", this.preventMenu);
  }

  private preventMenu = (e: Event) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const inField = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    // Escape must always reach the game so pause/console can be dismissed from a text field.
    if ((inField || this.textMode) && e.code !== "Escape") return;
    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].includes(e.code) &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      e.preventDefault();
    }
    if (!this.keys.has(e.code)) {
      for (const h of this.keyDownHandlers) h(e.code, e);
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (this.textMode) return;
    for (const h of this.keyUpHandlers) h(e.code, e);
  };

  private onBlur = () => {
    this.keys.clear();
    this.dragging = false;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      this.dragging = true;
      this.dragDist = 0;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      if (!this.pointerLocked) this.dragLook = true;
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.dragging = false;
      this.dragLook = false;
      if (this.dragDist < 6) for (const h of this.clickHandlers) h(e.clientX, e.clientY);
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.pointerLocked) {
      this.lookX += e.movementX || 0;
      this.lookY += e.movementY || 0;
      return;
    }
    if (this.dragging) {
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.dragDist += Math.abs(dx) + Math.abs(dy);
      if (this.enabled) {
        this.lookX += dx * 1.15;
        this.lookY += dy * 1.15;
      }
    }
  };

  private onWheel = (e: WheelEvent) => {
    for (const h of this.wheelHandlers) h(e.deltaY);
  };

  private lockHandlers = new Set<(locked: boolean) => void>();

  private onLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.dom;
    if (this.pointerLocked) this.lockDenied = false;
    for (const h of this.lockHandlers) h(this.pointerLocked);
  };

  private onLockError = () => {
    this.pointerLocked = false;
    this.lockDenied = true;
  };

  /* ---- touch ---- */
  private touchLookId = -1;
  private touchLast = { x: 0, y: 0 };
  private onTouchStart = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (this.touchLookId === -1 && t.clientX > window.innerWidth * 0.28) {
        this.touchLookId = t.identifier;
        this.touchLast = { x: t.clientX, y: t.clientY };
      }
    }
  };
  private onTouchMove = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.touchLookId) continue;
      const dx = t.clientX - this.touchLast.x;
      const dy = t.clientY - this.touchLast.y;
      this.touchLast = { x: t.clientX, y: t.clientY };
      if (this.enabled) {
        this.lookX += dx * 1.6;
        this.lookY += dy * 1.6;
      }
      e.preventDefault();
    }
  };
  private onTouchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.touchLookId) this.touchLookId = -1;
    }
  };

  /* ---- api ---- */
  requestLock() {
    if (this.pointerLocked || this.lockDenied) return;
    const el = this.dom as HTMLElement & { requestPointerLock?: (o?: object) => Promise<void> | void };
    try {
      const p = el.requestPointerLock?.({ unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).catch === "function") {
        (p as Promise<void>).catch(() => {
          try {
            el.requestPointerLock?.();
          } catch {
            this.lockDenied = true;
          }
        });
      }
    } catch {
      this.lockDenied = true;
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  consumeLook() {
    const out = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  /** Normalised WASD direction in local space: x = strafe right, y = forward. */
  moveAxis() {
    let x = 0;
    let y = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.touchAxis) {
      x += this.touchAxis.x;
      y += this.touchAxis.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
  }

  touchAxis: { x: number; y: number } | null = null;

  onKeyDown_(h: KeyHandler) {
    this.keyDownHandlers.add(h);
    return () => this.keyDownHandlers.delete(h);
  }
  onKeyUp_(h: KeyHandler) {
    this.keyUpHandlers.add(h);
    return () => this.keyUpHandlers.delete(h);
  }
  onClick_(h: (x: number, y: number) => void) {
    this.clickHandlers.add(h);
    return () => this.clickHandlers.delete(h);
  }
  onLockChange_(h: (locked: boolean) => void) {
    this.lockHandlers.add(h);
    return () => this.lockHandlers.delete(h);
  }
  onWheel_(h: (dy: number) => void) {
    this.wheelHandlers.add(h);
    return () => this.wheelHandlers.delete(h);
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.dom.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    this.dom.removeEventListener("wheel", this.onWheel);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("pointerlockerror", this.onLockError);
    this.dom.removeEventListener("touchstart", this.onTouchStart);
    this.dom.removeEventListener("touchmove", this.onTouchMove);
    this.dom.removeEventListener("touchend", this.onTouchEnd);
    window.removeEventListener("contextmenu", this.preventMenu);
  }
}
