import * as THREE from 'three';
import type {Scan, ScanHighlight} from '../../server/schema';
import {PALETTE} from '../palette';
import {GrayFrame, Tracker, type Box} from './tracker';

/**
 * Renders a color-coded 3D model of a recognized problem over the live video
 * and keeps it tethered above the problem as the tracker follows it.
 * Loaded on demand so Three.js stays out of the startup bundle.
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

function material(color: string, bright: boolean) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: bright ? 0.45 : 0.1,
    transparent: !bright,
    opacity: bright ? 1 : 0.35,
    roughness: 0.6,
  });
}

function boxMesh(w: number, h: number, d: number, color: string, bright: boolean) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, material(color, bright));
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({color: bright ? '#FFFFFF' : color, transparent: true, opacity: bright ? 0.6 : 0.4}),
  );
  mesh.add(edges);
  return mesh;
}

/** Glyph size of label textures, in texture pixels (not CSS layout). */
const LABEL_TEXTURE_PX = 96;

/** A camera-facing text label. Size is in model units. */
function label(text: string, color: string, size: number) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `700 ${LABEL_TEXTURE_PX}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 48;
  canvas.width = w;
  canvas.height = 128;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#000000';
  ctx.strokeText(text, w / 2, 64);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: tex, depthTest: false}));
  sprite.scale.set((size * w) / 128, size, 1);
  sprite.renderOrder = 10;
  return sprite;
}

const fmt = (n: number, unit: string) => (unit ? `${n} ${unit}` : String(n));

/** Builds the model centred on the origin; returns it with its widest extent. */
function buildModel(scan: Scan, h: ScanHighlight): {group: THREE.Group; extent: number} {
  const m = scan.model;
  const roles = activeRoles(h);
  const g = new THREE.Group();
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
      g.add(boxMesh(L, t * 0.5, W, DIM, false));
      const tiles = roles.has('area') && Number.isInteger(L) && Number.isInteger(W) && L * W <= 400;
      if (tiles) {
        for (let i = 0; i < L; i++) {
          for (let j = 0; j < W; j++) {
            const tile = boxMesh(0.86, t * 0.6, 0.86, PALETTE.total, true);
            tile.position.set(-L / 2 + i + 0.5, t * 0.6, -W / 2 + j + 0.5);
            g.add(tile);
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
              const c = boxMesh(0.92, 0.92, 0.92, on ? PALETTE.total : DIM, on);
              c.position.set(-L / 2 + i + 0.5, k + 0.5, -W / 2 + j + 0.5);
              g.add(c);
            }
          }
        }
      } else {
        const solid = boxMesh(L, H, W, roles.has('total') ? PALETTE.total : DIM, roles.has('total'));
        solid.position.y = H / 2;
        g.add(solid);
      }
    }

    // Colored edges: the two length edges, the two width edges, one height edge.
    const y = m.kind === 'box' ? 0 : t;
    for (const z of [-W / 2, W / 2]) {
      const e = boxMesh(L + t, t, t, lOn ? lColor : DIM, lOn);
      e.position.set(0, y, z);
      g.add(e);
    }
    for (const x of [-L / 2, L / 2]) {
      const e = boxMesh(t, t, W + t, wOn ? wColor : DIM, wOn);
      e.position.set(x, y, 0);
      g.add(e);
    }
    if (H > 0) {
      const e = boxMesh(t, H, t, hOn ? (total ? PALETTE.total : PALETTE.height) : DIM, hOn);
      e.position.set(L / 2, H / 2, W / 2);
      g.add(e);
    }

    if (lOn && !total) {
      const s = label(fmt(m.length, unit), PALETTE.length, ls);
      s.position.set(0, y + ls * 0.6, W / 2 + ls * 0.7);
      g.add(s);
    }
    if (wOn && !total) {
      const s = label(fmt(m.width, unit), PALETTE.width, ls);
      s.position.set(L / 2 + ls * 1.2, y + ls * 0.6, 0);
      g.add(s);
    }
    if (hOn && H > 0 && !total) {
      const s = label(fmt(m.height, unit), PALETTE.height, ls);
      s.position.set(L / 2 + ls * 1.2, H / 2, W / 2);
      g.add(s);
    }
    if (total && scan.answer) {
      const s = label(scan.answer, PALETTE.total, ls * 1.4);
      s.position.set(0, Math.max(H, t) + ls * 1.2, 0);
      g.add(s);
    }
    return {group: g, extent: extent * 1.4};
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
    const itemGeo = new THREE.SphereGeometry(0.36, 16, 12);
    for (let gi = 0; gi < G; gi++) {
      const gx = (gi % perRow) * (plate + 0.8) - ((perRow - 1) * (plate + 0.8)) / 2;
      const gz = Math.floor(gi / perRow) * (plate + 0.8);
      const p = boxMesh(plate, 0.15, plate, platesOn ? PALETTE.width : DIM, platesOn);
      p.position.set(gx, 0, gz);
      g.add(p);
      for (let n = 0; n < N; n++) {
        const item = new THREE.Mesh(
          itemGeo,
          material(total ? PALETTE.total : itemsOn ? PALETTE.length : DIM, itemsOn),
        );
        item.position.set(gx - (cols - 1) / 2 + (n % cols), 0.45, gz - (cols - 1) / 2 + Math.floor(n / cols));
        g.add(item);
      }
    }
    const width = perRow * (plate + 0.8);
    const ls = width * 0.14;
    if (total && scan.answer) {
      const s = label(scan.answer, PALETTE.total, ls * 1.4);
      s.position.set(0, ls * 2, 0);
      g.add(s);
    } else if (platesOn) {
      const s = label(`${G} groups`, PALETTE.width, ls);
      s.position.set(0, ls * 1.6, 0);
      g.add(s);
    }
    g.position.z = -Math.floor((G - 1) / perRow) * (plate + 0.8) * 0.5;
    const wrap = new THREE.Group();
    wrap.add(g);
    return {group: wrap, extent: width};
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
    const mesh = boxMesh(Math.max(0.05, len), bar, bar, color, on || h === 'none');
    const start = cur * scale;
    const end = (cur + v) * scale;
    // Subtraction runs back along a raised row so its label clears the bar below.
    const rowY = v < 0 ? bar * 3 : 0;
    mesh.position.set((start + end) / 2, rowY, 0);
    g.add(mesh);
    const s = label(v < 0 ? `− ${Math.abs(v)}` : i === 0 ? String(v) : `+ ${v}`, color, 1.6);
    s.position.set((start + end) / 2, rowY + 1.3, 0);
    g.add(s);
    cur += v;
    lo = Math.min(lo, cur * scale);
    hi = Math.max(hi, cur * scale);
  });
  if (roles.has('total')) {
    const res = boxMesh(Math.max(0.05, Math.abs(sum) * scale), bar, bar, PALETTE.total, true);
    res.position.set((sum * scale) / 2, -bar * 1.6, 0);
    g.add(res);
    const s = label(scan.answer || String(sum), PALETTE.total, 1.8);
    s.position.set((sum * scale) / 2, -bar * 1.6 - 1.5, 0);
    g.add(s);
  }
  const wrap = new THREE.Group();
  g.position.x = -(lo + hi) / 2;
  wrap.add(g);
  return {group: wrap, extent: Math.max(4, hi - lo) * 1.1};
}

function dispose(obj: THREE.Object3D) {
  obj.traverse(o => {
    const any = o as THREE.Mesh;
    any.geometry?.dispose();
    const mat = any.material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      (m as THREE.SpriteMaterial).map?.dispose();
      m.dispose();
    }
  });
}

export class ARStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
  private readonly pivot = new THREE.Group();
  private readonly frameLine: THREE.LineLoop;
  private model: THREE.Group | null = null;
  private extent = 1;
  private tilt = {x: 0.55, y: -0.6};
  private tracker: Tracker | null = null;
  private readonly grayCtx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private running = false;
  private smooth: Box | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly video: HTMLVideoElement;
  private shown = false;
  private idleCleared = false;
  /** Called when the tracked problem comes into or leaves the camera view. */
  onTracking: ((visible: boolean) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    this.canvas = canvas;
    this.video = video;
    this.renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: true});
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(300, 600, 800);
    this.scene.add(sun);
    this.camera.position.z = 1000;
    this.scene.add(this.pivot);

    const frameGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(1, -1, 0),
      new THREE.Vector3(0, -1, 0),
    ]);
    this.frameLine = new THREE.LineLoop(frameGeo, new THREE.LineBasicMaterial({color: PALETTE.total}));
    this.frameLine.visible = false;
    this.scene.add(this.frameLine);

    const gray = document.createElement('canvas');
    this.grayCtx = gray.getContext('2d', {willReadFrequently: true})!;
  }

  /** Grey snapshot of the current frame, taken when a scan is sent. */
  snapshot(): GrayFrame | null {
    return GrayFrame.grab(this.video, this.grayCtx);
  }

  setScan(scan: Scan | null, snapshot: GrayFrame | null, highlight: ScanHighlight) {
    if (this.model) {
      this.pivot.remove(this.model);
      dispose(this.model);
      this.model = null;
    }
    if (!scan || !scan.found) {
      this.tracker = null;
      this.frameLine.visible = false;
      this.smooth = null;
      return;
    }
    const built = buildModel(scan, highlight);
    this.model = built.group;
    this.extent = built.extent;
    // A number line reads left to right, so keep it nearly face-on.
    this.tilt = scan.model.kind === 'number_line' ? {x: 0.2, y: -0.15} : {x: 0.55, y: -0.6};
    this.pivot.add(this.model);

    if (snapshot && (!this.tracker || this.trackedScan !== scan)) {
      this.tracker = new Tracker(snapshot, scan.box);
      const now = GrayFrame.grab(this.video, this.grayCtx);
      if (now) this.tracker.reacquire(now);
      this.trackedScan = scan;
      this.smooth = null;
    }
  }

  private trackedScan: Scan | null = null;

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
    this.renderer.clear();
  }

  dispose() {
    this.stop();
    // Leave the canvas empty, not frozen on the last model.
    this.renderer.clear();
    if (this.model) dispose(this.model);
    this.renderer.dispose();
  }

  private frame(t: number) {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    if (!W || !H) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== W || size.y !== H) {
      this.renderer.setSize(W, H, false);
      this.camera.right = W;
      this.camera.bottom = -H;
      this.camera.updateProjectionMatrix();
    }

    if (!this.tracker) {
      // Nothing recognised: keep the display empty (black is clear on glasses).
      if (!this.idleCleared) {
        this.pivot.visible = false;
        this.frameLine.visible = false;
        this.renderer.render(this.scene, this.camera);
        this.idleCleared = true;
      }
      this.setShown(false);
      return;
    }
    this.idleCleared = false;

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

    const visible = !this.tracker.lost && this.smooth !== null;
    this.setShown(visible);
    this.pivot.visible = visible;
    this.frameLine.visible = visible;
    if (visible && this.smooth) {
      const b = this.smooth;
      this.frameLine.position.set(b.x, -b.y, 0);
      this.frameLine.scale.set(b.w, b.h, 1);

      // Hover the model just above the problem, sized to its width, but keep
      // it in the band between the step text (top) and the buttons (bottom).
      const target = Math.min(W * 0.5, Math.max(W * 0.3, b.w * 1.1));
      const half = target * 0.35;
      const minC = H * 0.32 + half;
      const maxC = H * 0.82 - half;
      const above = b.y - half - H * 0.02;
      const cy = minC > maxC ? (minC + maxC) / 2 : Math.min(maxC, Math.max(minC, above));
      this.pivot.position.set(b.x + b.w / 2, -cy, 0);
      this.pivot.scale.setScalar(target / this.extent);
    }

    // A gentle sway shows depth; the tilt shows the top face.
    this.pivot.rotation.set(this.tilt.x, this.tilt.y + Math.sin(t / 1400) * 0.18, 0);
    this.renderer.render(this.scene, this.camera);
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
