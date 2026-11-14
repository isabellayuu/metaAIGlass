import type {Scan, ScanHighlight} from '../../server/schema';
import {PALETTE} from '../palette';
import {GrayFrame, Tracker, type Box} from './tracker';

/**
 * Renders a color-coded 3D model of a recognized problem over the live video
 * and keeps it tethered above the problem as the tracker follows it.
 *
 * The models are only boxes, balls and labels, so they are drawn with the
 * built-in 2D canvas (orthographic projection, painter's algorithm) instead of
 * a WebGL engine: far less code to download and no shader compilation on the
 * glasses' low-power processor.
 */

type Role = 'length' | 'width' | 'height' | 'total' | 'perimeter' | 'area';

function activeRoles(h: ScanHighlight): Set<Role> {
  switch (h) {
    case 'length':
      return new Set(['length']);
    case 'width':
      return new Set(['length', 'width']);
    case 'height':
      return new Set(['length', 'width', 'height']);
    case 'perimeter':
      return new Set(['perimeter']);
    case 'area':
      return new Set(['length', 'width', 'area']);
    case 'groups':
      return new Set(['width']);
    case 'volume':
    case 'total':
      return new Set(['total']);
    default:
      return new Set();
  }
}

const DIM = '#8A8A8A';

type Vec3 = [number, number, number];

type Prim =
  | {kind: 'box'; c: Vec3; s: Vec3; color: string; bright: boolean}
  | {kind: 'ball'; c: Vec3; r: number; color: string; bright: boolean}
  | {kind: 'label'; c: Vec3; text: string; color: string; size: number};

interface Model {
  prims: Prim[];
  extent: number;
}

/** Collects primitives, with an optional offset applied to every position. */
class Builder {
  prims: Prim[] = [];
  offset: Vec3 = [0, 0, 0];
  private at(c: Vec3): Vec3 {
    return [c[0] + this.offset[0], c[1] + this.offset[1], c[2] + this.offset[2]];
  }
  box(w: number, h: number, d: number, color: string, bright: boolean, c: Vec3 = [0, 0, 0]) {
    this.prims.push({kind: 'box', c: this.at(c), s: [w, h, d], color, bright});
  }
  ball(r: number, color: string, bright: boolean, c: Vec3) {
    this.prims.push({kind: 'ball', c: this.at(c), r, color, bright});
  }
  label(text: string, color: string, size: number, c: Vec3) {
    this.prims.push({kind: 'label', c: this.at(c), text, color, size});
  }
}

const fmt = (n: number, unit: string) => (unit ? `${n} ${unit}` : String(n));

/** Builds the model centred on the origin; returns it with its widest extent. */
function buildModel(scan: Scan, h: ScanHighlight): Model {
  const m = scan.model;
  const roles = activeRoles(h);
  const g = new Builder();
  const unit = m.unit;

  if (m.kind === 'rectangle' || m.kind === 'box') {
    const L = Math.max(1, m.length);
    const W = Math.max(1, m.width);
    const H = m.kind === 'box' ? Math.max(1, m.height) : 0;
    const extent = Math.max(L, W, H);
    const t = extent * 0.035; // edge thickness
    const ls = extent * 0.2; // label size
    const total = roles.has('total') || roles.has('perimeter');
    const lColor = total ? PALETTE.total : PALETTE.length;
    const wColor = total ? PALETTE.total : PALETTE.width;
    const lOn = total || roles.has('length');
    const wOn = total || roles.has('width');
    const hOn = total || roles.has('height');

    if (m.kind === 'rectangle') {
      g.box(L, t * 0.5, W, DIM, false);
      const tiles = roles.has('area') && Number.isInteger(L) && Number.isInteger(W) && L * W <= 400;
      if (tiles) {
        for (let i = 0; i < L; i++) {
          for (let j = 0; j < W; j++) {
            g.box(0.86, t * 0.6, 0.86, PALETTE.total, true, [-L / 2 + i + 0.5, t * 0.6, -W / 2 + j + 0.5]);
          }
        }
      }
    } else {
      const cubes = Number.isInteger(L) && Number.isInteger(W) && Number.isInteger(H) && L * W * H <= 400;
      if (cubes) {
        for (let i = 0; i < L; i++) {
          for (let j = 0; j < W; j++) {
            for (let k = 0; k < H; k++) {
              const base = roles.has('area') && k === 0;
              const on = roles.has('total') || base;
              g.box(0.92, 0.92, 0.92, on ? PALETTE.total : DIM, on, [-L / 2 + i + 0.5, k + 0.5, -W / 2 + j + 0.5]);
            }
          }
        }
      } else {
        g.box(L, H, W, roles.has('total') ? PALETTE.total : DIM, roles.has('total'), [0, H / 2, 0]);
      }
    }

    // Colored edges: the two length edges, the two width edges, one height edge.
    const y = m.kind === 'box' ? 0 : t;
    for (const z of [-W / 2, W / 2]) {
      g.box(L + t, t, t, lOn ? lColor : DIM, lOn, [0, y, z]);
    }
    for (const x of [-L / 2, L / 2]) {
      g.box(t, t, W + t, wOn ? wColor : DIM, wOn, [x, y, 0]);
    }
    if (H > 0) {
      g.box(t, H, t, hOn ? (total ? PALETTE.total : PALETTE.height) : DIM, hOn, [L / 2, H / 2, W / 2]);
    }

    if (lOn && !total) {
      g.label(fmt(m.length, unit), PALETTE.length, ls, [0, y + ls * 0.6, W / 2 + ls * 0.7]);
    }
    if (wOn && !total) {
      g.label(fmt(m.width, unit), PALETTE.width, ls, [L / 2 + ls * 1.2, y + ls * 0.6, 0]);
    }
    if (hOn && H > 0 && !total) {
      g.label(fmt(m.height, unit), PALETTE.height, ls, [L / 2 + ls * 1.2, H / 2, W / 2]);
    }
    if (total && scan.answer) {
      g.label(scan.answer, PALETTE.total, ls * 1.4, [0, Math.max(H, t) + ls * 1.2, 0]);
    }
    return {prims: g.prims, extent: extent * 1.4};
  }

  if (m.kind === 'groups') {
    const G = Math.max(1, Math.min(12, Math.round(m.groups)));
    const N = Math.max(1, Math.min(25, Math.round(m.per_group)));
    const cols = Math.ceil(Math.sqrt(N));
    const plate = cols + 0.6;
    const perRow = Math.min(G, 4);
    const total = roles.has('total');
    const itemsOn = total || roles.has('length');
    const platesOn = roles.has('width');
    // Centre the rows of plates front to back.
    g.offset = [0, 0, -Math.floor((G - 1) / perRow) * (plate + 0.8) * 0.5];
    for (let gi = 0; gi < G; gi++) {
      const gx = (gi % perRow) * (plate + 0.8) - ((perRow - 1) * (plate + 0.8)) / 2;
      const gz = Math.floor(gi / perRow) * (plate + 0.8);
      g.box(plate, 0.15, plate, platesOn ? PALETTE.width : DIM, platesOn, [gx, 0, gz]);
      for (let n = 0; n < N; n++) {
        g.ball(0.36, total ? PALETTE.total : itemsOn ? PALETTE.length : DIM, itemsOn, [
          gx - (cols - 1) / 2 + (n % cols),
          0.45,
          gz - (cols - 1) / 2 + Math.floor(n / cols),
        ]);
      }
    }
    const width = perRow * (plate + 0.8);
    const ls = width * 0.14;
    if (total && scan.answer) {
      g.label(scan.answer, PALETTE.total, ls * 1.4, [0, ls * 2, 0]);
    } else if (platesOn) {
      g.label(`${G} groups`, PALETTE.width, ls, [0, ls * 1.6, 0]);
    }
    return {prims: g.prims, extent: width};
  }

  // number_line: one bar per quantity, laid end to end; subtraction steps back.
  const values = m.values.length ? m.values : [0];
  const sum = values.reduce((a, v) => a + v, 0);
  const span = Math.max(1, ...values.map(Math.abs), Math.abs(sum), values.reduce((a, v) => a + Math.abs(v), 0) * 0.6);
  const scale = 10 / span;
  const bar = 0.6;
  let cur = 0;
  let lo = 0;
  let hi = 0;
  values.forEach((v, i) => {
    const color = i === 0 ? PALETTE.length : PALETTE.width;
    const on = roles.has('total') ? false : i === 0 ? roles.has('length') : roles.has('width');
    const len = Math.abs(v) * scale;
    const start = cur * scale;
    const end = (cur + v) * scale;
    // Subtraction runs back along a raised row so its label clears the bar below.
    const rowY = v < 0 ? bar * 3 : 0;
    g.box(Math.max(0.05, len), bar, bar, color, on || h === 'none', [(start + end) / 2, rowY, 0]);
    g.label(v < 0 ? `− ${Math.abs(v)}` : i === 0 ? String(v) : `+ ${v}`, color, 1.6, [(start + end) / 2, rowY + 1.3, 0]);
    cur += v;
    lo = Math.min(lo, cur * scale);
    hi = Math.max(hi, cur * scale);
  });
  if (roles.has('total')) {
    g.box(Math.max(0.05, Math.abs(sum) * scale), bar, bar, PALETTE.total, true, [(sum * scale) / 2, -bar * 1.6, 0]);
    g.label(scan.answer || String(sum), PALETTE.total, 1.8, [(sum * scale) / 2, -bar * 1.6 - 1.5, 0]);
  }
  // Centre the line horizontally.
  for (const p of g.prims) p.c[0] -= (lo + hi) / 2;
  return {prims: g.prims, extent: Math.max(4, hi - lo) * 1.1};
}

// ---- Drawing ---------------------------------------------------------------

/** Light direction (towards the viewer, up and right), normalised. */
const LIGHT: Vec3 = (() => {
  const v: Vec3 = [0.3, 0.6, 0.75];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
})();

const LABEL_FONT = "700 {px}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function rgb(hex: string): Vec3 {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex: string, k: number, alpha: number) {
  const [r, g, b] = rgb(hex);
  const f = (c: number) => Math.min(255, Math.round(c * k));
  return `rgba(${f(r)},${f(g)},${f(b)},${alpha})`;
}

/** Rotation about Y, then X: tilts the model so its top face shows. */
function rotator(rx: number, ry: number) {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  return (v: Vec3): Vec3 => {
    const x1 = v[0] * cy + v[2] * sy;
    const z1 = -v[0] * sy + v[2] * cy;
    return [x1, v[1] * cx - z1 * sx, v[1] * sx + z1 * cx];
  };
}

// Box faces: corner indices (corner bit 0 = +x, bit 1 = +y, bit 2 = +z) and outward normal.
const FACES: Array<[number[], Vec3]> = [
  [[1, 3, 7, 5], [1, 0, 0]],
  [[0, 4, 6, 2], [-1, 0, 0]],
  [[2, 6, 7, 3], [0, 1, 0]],
  [[0, 1, 5, 4], [0, -1, 0]],
  [[4, 5, 7, 6], [0, 0, 1]],
  [[0, 2, 3, 1], [0, 0, -1]],
];

type Drawable = {z: number; draw(ctx: CanvasRenderingContext2D): void};

/**
 * Draw a model: `origin` is the screen point of the model's centre, `scale`
 * is pixels per model unit, `rx`/`ry` the tilt. Orthographic, far faces first.
 */
function drawModel(
  ctx: CanvasRenderingContext2D,
  model: Model,
  origin: [number, number],
  scale: number,
  rx: number,
  ry: number,
) {
  const rot = rotator(rx, ry);
  const project = (v: Vec3): [number, number] => [origin[0] + v[0] * scale, origin[1] - v[1] * scale];
  const items: Drawable[] = [];
  const labels: Array<{at: [number, number]; text: string; color: string; px: number}> = [];

  for (const p of model.prims) {
    if (p.kind === 'box') {
      const corners: Vec3[] = [];
      for (let i = 0; i < 8; i++) {
        corners.push(
          rot([
            p.c[0] + (i & 1 ? 0.5 : -0.5) * p.s[0],
            p.c[1] + (i & 2 ? 0.5 : -0.5) * p.s[1],
            p.c[2] + (i & 4 ? 0.5 : -0.5) * p.s[2],
          ]),
        );
      }
      const alpha = p.bright ? 1 : 0.35;
      for (const [idx, normal] of FACES) {
        const n = rot(normal);
        if (n[2] <= 0) continue; // facing away from the viewer
        const pts = idx.map(i => corners[i]);
        const light = 0.55 + 0.45 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
        const fill = shade(p.color, light * (p.bright ? 1.05 : 0.9), alpha);
        const stroke = p.bright ? 'rgba(255,255,255,0.55)' : shade(p.color, 1, 0.4);
        items.push({
          z: pts.reduce((a, q) => a + q[2], 0) / 4,
          draw: c => {
            c.beginPath();
            pts.forEach((q, i) => {
              const [x, y] = project(q);
              if (i === 0) c.moveTo(x, y);
              else c.lineTo(x, y);
            });
            c.closePath();
            c.fillStyle = fill;
            c.fill();
            c.strokeStyle = stroke;
            c.stroke();
          },
        });
      }
    } else if (p.kind === 'ball') {
      const center = rot(p.c);
      const [x, y] = project(center);
      const r = p.r * scale;
      const alpha = p.bright ? 1 : 0.35;
      items.push({
        z: center[2],
        draw: c => {
          const g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
          g.addColorStop(0, shade(p.color, 1.35, alpha));
          g.addColorStop(1, shade(p.color, 0.75, alpha));
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.fillStyle = g;
          c.fill();
        },
      });
    } else {
      labels.push({at: project(rot(p.c)), text: p.text, color: p.color, px: p.size * scale});
    }
  }

  items.sort((a, b) => a.z - b.z);
  ctx.lineWidth = Math.max(1, scale * 0.02);
  ctx.lineJoin = 'round';
  for (const it of items) it.draw(ctx);

  // Labels always face the viewer and sit on top, with a dark outline so they
  // stay readable over any background.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of labels) {
    const px = Math.max(10, Math.round(l.px * 0.75));
    ctx.font = LABEL_FONT.replace('{px}', String(px));
    ctx.lineWidth = px * 0.18;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(l.text, l.at[0], l.at[1]);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, l.at[0], l.at[1]);
  }
}

// ---- Stage -----------------------------------------------------------------

export class ARStage {
  private readonly ctx: CanvasRenderingContext2D;
  private model: Model | null = null;
  private extent = 1;
  private tilt = {x: 0.55, y: -0.6};
  private tracker: Tracker | null = null;
  private trackedScan: Scan | null = null;
  private readonly grayCtx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private running = false;
  private smooth: Box | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly video: HTMLVideoElement;
  private shown = false;
  /** A problem given as text: no camera position, so the model sits mid-screen. */
  private pinned = false;
  private idleCleared = false;
  /** Called when the tracked problem comes into or leaves the camera view. */
  onTracking: ((visible: boolean) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = canvas.getContext('2d')!;
    const gray = document.createElement('canvas');
    this.grayCtx = gray.getContext('2d', {willReadFrequently: true})!;
  }

  /** Grey snapshot of the current frame, taken when a scan is sent. */
  snapshot(): GrayFrame | null {
    return GrayFrame.grab(this.video, this.grayCtx);
  }

  setScan(scan: Scan | null, snapshot: GrayFrame | null, highlight: ScanHighlight) {
    this.model = null;
    this.pinned = false;
    if (!scan || !scan.found) {
      this.tracker = null;
      this.trackedScan = null;
      this.smooth = null;
      return;
    }
    this.model = buildModel(scan, highlight);
    this.extent = this.model.extent;
    // A number line reads left to right, so keep it nearly face-on.
    this.tilt = scan.model.kind === 'number_line' ? {x: 0.2, y: -0.15} : {x: 0.55, y: -0.6};

    if (!snapshot) {
      this.tracker = null;
      this.trackedScan = null;
      this.smooth = null;
      this.pinned = true;
      this.idleCleared = false;
    } else if (!this.tracker || this.trackedScan !== scan) {
      this.tracker = new Tracker(snapshot, scan.box);
      const now = GrayFrame.grab(this.video, this.grayCtx);
      if (now) this.tracker.reacquire(now);
      this.trackedScan = scan;
      this.smooth = null;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      // The panel refreshes at 30 Hz; don't do more work than it can show.
      if (t - this.last < 33) return;
      this.last = t;
      this.frame(t);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Stop and leave the canvas empty, ready to start again. */
  pause() {
    this.stop();
    this.setScan(null, null, 'none');
    this.idleCleared = false;
    this.setShown(false);
    this.clear();
  }

  dispose() {
    this.stop();
    this.clear();
  }

  private clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Match the canvas backing store to its CSS size; returns the CSS size. */
  private fit(): [number, number] | null {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    if (!W || !H) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(W * dpr);
    const bh = Math.round(H * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, W, H);
    return [W, H];
  }

  private frame(t: number) {
    const sway = Math.sin(t / 1400) * 0.18;

    if (!this.tracker && this.pinned && this.model) {
      const size = this.fit();
      if (!size) return;
      const [W, H] = size;
      this.idleCleared = false;
      this.setShown(true);
      // Between the step text (top) and the buttons (bottom).
      const target = Math.min(W, H) * 0.5;
      drawModel(this.ctx, this.model, [W / 2, H * 0.56], target / this.extent, this.tilt.x, this.tilt.y + sway);
      return;
    }

    if (!this.tracker) {
      // Nothing recognised: keep the display empty (black is clear on glasses).
      if (!this.idleCleared) {
        this.clear();
        this.idleCleared = true;
      }
      this.setShown(false);
      return;
    }
    this.idleCleared = false;
    const size = this.fit();
    if (!size) return;
    const [W, H] = size;

    const g = GrayFrame.grab(this.video, this.grayCtx);
    if (g) this.tracker.update(g);

    const box = this.toStage(this.tracker.box, W, H);
    if (box) {
      const k = this.smooth ? 0.35 : 1;
      this.smooth = this.smooth
        ? {
            x: this.smooth.x + (box.x - this.smooth.x) * k,
            y: this.smooth.y + (box.y - this.smooth.y) * k,
            w: this.smooth.w + (box.w - this.smooth.w) * k,
            h: this.smooth.h + (box.h - this.smooth.h) * k,
          }
        : box;
    }

    const visible = !this.tracker.lost && this.smooth !== null && this.model !== null;
    this.setShown(visible);
    if (!visible || !this.smooth || !this.model) return;

    const b = this.smooth;
    // Outline the recognised problem.
    this.ctx.strokeStyle = PALETTE.total;
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeRect(b.x, b.y, b.w, b.h);

    // Hover the model just above the problem, sized to its width, but keep it
    // in the band between the step text (top) and the buttons (bottom).
    const target = Math.min(W * 0.5, Math.max(W * 0.3, b.w * 1.1));
    const half = target * 0.35;
    const minC = H * 0.32 + half;
    const maxC = H * 0.82 - half;
    const above = b.y - half - H * 0.02;
    const cy = minC > maxC ? (minC + maxC) / 2 : Math.min(maxC, Math.max(minC, above));
    drawModel(this.ctx, this.model, [b.x + b.w / 2, cy], target / this.extent, this.tilt.x, this.tilt.y + sway);
  }

  private setShown(visible: boolean) {
    if (visible === this.shown) return;
    this.shown = visible;
    this.onTracking?.(visible);
  }

  /** Map a box in video-normalised coordinates to stage pixels (video uses object-fit: cover). */
  private toStage(b: Box, W: number, H: number): Box | null {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return null;
    const s = Math.max(W / vw, H / vh);
    const dw = vw * s;
    const dh = vh * s;
    const ox = (W - dw) / 2;
    const oy = (H - dh) / 2;
    return {x: ox + b.x * dw, y: oy + b.y * dh, w: b.w * dw, h: b.h * dh};
  }
}
