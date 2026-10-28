/** Plain 2D helpers for the roaming Echo (DESIGN.md §8.1). Viewport pixels. */
export interface Vec {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SteerOptions {
  /** Pixels per 60fps frame. */
  maxSpeed: number;
  /** Largest velocity change per frame: how quickly Echo accelerates and turns. */
  maxForce: number;
  /** Within this distance Echo eases in instead of overshooting. */
  arriveRadius: number;
}

export const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * One steering step: accelerate toward the target, ease in near it.
 * `dt` is in 60fps frames (1 = 16.7ms).
 */
export function steer(pos: Vec, vel: Vec, target: Vec, options: SteerOptions, dt = 1) {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dist = Math.hypot(dx, dy);
  const speed =
    dist < options.arriveRadius ? options.maxSpeed * (dist / options.arriveRadius) : options.maxSpeed;
  const desired = dist > 0.001 ? { x: (dx / dist) * speed, y: (dy / dist) * speed } : { x: 0, y: 0 };
  let ax = desired.x - vel.x;
  let ay = desired.y - vel.y;
  const force = Math.hypot(ax, ay);
  const maxForce = options.maxForce * dt;
  if (force > maxForce) {
    ax = (ax / force) * maxForce;
    ay = (ay / force) * maxForce;
  }
  const nextVel = { x: vel.x + ax, y: vel.y + ay };
  return { pos: { x: pos.x + nextVel.x * dt, y: pos.y + nextVel.y * dt }, vel: nextVel };
}

export function insideBox(point: Vec, box: Box, pad = 0): boolean {
  return (
    point.x >= box.left - pad &&
    point.x <= box.right + pad &&
    point.y >= box.top - pad &&
    point.y <= box.bottom + pad
  );
}

export const insideAny = (point: Vec, boxes: Box[], pad = 0) =>
  boxes.some((box) => insideBox(point, box, pad));

/** A random point in `bounds` outside every padded `avoid` box (best effort). */
export function randomPoint(
  bounds: Box,
  avoid: Box[],
  pad: number,
  random: () => number = Math.random,
): Vec {
  let point = { x: bounds.left, y: bounds.top };
  for (let tries = 0; tries < 16; tries += 1) {
    point = {
      x: bounds.left + random() * Math.max(0, bounds.right - bounds.left),
      y: bounds.top + random() * Math.max(0, bounds.bottom - bounds.top),
    };
    if (!insideAny(point, avoid, pad)) return point;
  }
  return point;
}

export function clampToBox(point: Vec, box: Box): Vec {
  return {
    x: Math.min(box.right, Math.max(box.left, point.x)),
    y: Math.min(box.bottom, Math.max(box.top, point.y)),
  };
}

/** Index of the point nearest to `from`, or -1 when there are none. */
export function nearestIndex(from: Vec, points: Vec[]): number {
  let best = -1;
  let bestDistance = Infinity;
  points.forEach((point, index) => {
    const d = distance(from, point);
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  });
  return best;
}
