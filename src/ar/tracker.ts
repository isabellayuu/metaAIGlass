/**
 * Keeps a recognized problem's bounding box locked to the live video by
 * template matching on a small grayscale copy of each frame. It tracks
 * translation only, which is enough to keep the 3D model tethered while the
 * camera or paper moves a little.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SMALL_W = 160;
const GRID_X = 24;
const GRID_Y = 12;
const LOCAL_RADIUS = 12;
/** Mean absolute grey-level difference above which the match is treated as lost. */
const LOST_SAD = 38;

export class GrayFrame {
  readonly data: Uint8Array;
  readonly w: number;
  readonly h: number;

  constructor(data: Uint8Array, w: number, h: number) {
    this.data = data;
    this.w = w;
    this.h = h;
  }

  static grab(video: HTMLVideoElement, ctx: CanvasRenderingContext2D): GrayFrame | null {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const w = SMALL_W;
    const h = Math.round((SMALL_W * vh) / vw);
    if (ctx.canvas.width !== w || ctx.canvas.height !== h) {
      ctx.canvas.width = w;
      ctx.canvas.height = h;
    }
    ctx.drawImage(video, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
      gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    }
    return new GrayFrame(gray, w, h);
  }

  at(x: number, y: number): number {
    const xi = Math.min(this.w - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(this.h - 1, Math.max(0, Math.round(y)));
    return this.data[yi * this.w + xi];
  }
}

export class Tracker {
  private template: Float32Array;
  /** Box in small-frame pixels. */
  private px: number;
  private py: number;
  private readonly bw: number;
  private readonly bh: number;
  private lostFrames = 0;
  lost = false;

  /** Build the template from the frame the problem was recognized in. */
  constructor(source: GrayFrame, box: Box) {
    this.frameH = source.h;
    this.bw = Math.max(4, box.w * source.w);
    this.bh = Math.max(4, box.h * source.h);
    this.px = box.x * source.w;
    this.py = box.y * source.h;
    this.template = this.sample(source, this.px, this.py);
  }

  get box(): Box {
    // Normalised against the frame size used when tracking began.
    return {x: this.px / SMALL_W, y: this.py / this.frameH, w: this.bw / SMALL_W, h: this.bh / this.frameH};
  }

  private frameH = 120;

  private sample(frame: GrayFrame, x0: number, y0: number): Float32Array {
    const out = new Float32Array(GRID_X * GRID_Y);
    const sx = this.bw / (GRID_X - 1);
    const sy = this.bh / (GRID_Y - 1);
    for (let gy = 0, k = 0; gy < GRID_Y; gy++) {
      for (let gx = 0; gx < GRID_X; gx++, k++) out[k] = frame.at(x0 + gx * sx, y0 + gy * sy);
    }
    return out;
  }

  /** Mean absolute difference between the template and the frame at (x0, y0). */
  private cost(frame: GrayFrame, x0: number, y0: number, limit: number): number {
    const sx = this.bw / (GRID_X - 1);
    const sy = this.bh / (GRID_Y - 1);
    const t = this.template;
    // Remove the brightness offset so auto-exposure changes don't break the match.
    let meanT = 0;
    let meanF = 0;
    const vals = new Float32Array(t.length);
    for (let gy = 0, k = 0; gy < GRID_Y; gy++) {
      for (let gx = 0; gx < GRID_X; gx++, k++) {
        vals[k] = frame.at(x0 + gx * sx, y0 + gy * sy);
        meanF += vals[k];
        meanT += t[k];
      }
    }
    const offset = (meanF - meanT) / t.length;
    let sum = 0;
    const cap = limit * t.length;
    for (let k = 0; k < t.length; k++) {
      sum += Math.abs(vals[k] - offset - t[k]);
      if (sum > cap) return Infinity;
    }
    return sum / t.length;
  }

  private search(frame: GrayFrame, cx: number, cy: number, radius: number, step: number) {
    let best = Infinity;
    let bx = cx;
    let by = cy;
    const minX = -this.bw * 0.25;
    const minY = -this.bh * 0.25;
    const maxX = frame.w - this.bw * 0.75;
    const maxY = frame.h - this.bh * 0.75;
    for (let dy = -radius; dy <= radius; dy += step) {
      const y = cy + dy;
      if (y < minY || y > maxY) continue;
      for (let dx = -radius; dx <= radius; dx += step) {
        const x = cx + dx;
        if (x < minX || x > maxX) continue;
        const c = this.cost(frame, x, y, best);
        if (c < best) {
          best = c;
          bx = x;
          by = y;
        }
      }
    }
    return {best, bx, by};
  }

  /** Search the whole frame. Used right after recognition and when the match is lost. */
  reacquire(frame: GrayFrame) {
    this.frameH = frame.h;
    const coarse = this.search(frame, frame.w / 2, frame.h / 2, Math.max(frame.w, frame.h) / 2, 3);
    const fine = this.search(frame, coarse.bx, coarse.by, 3, 1);
    this.accept(frame, fine);
  }

  update(frame: GrayFrame) {
    this.frameH = frame.h;
    if (this.lost && this.lostFrames % 10 === 0) {
      this.reacquire(frame);
      this.lostFrames++;
      return;
    }
    this.accept(frame, this.search(frame, this.px, this.py, LOCAL_RADIUS, 1));
  }

  private accept(frame: GrayFrame, r: {best: number; bx: number; by: number}) {
    if (r.best < LOST_SAD) {
      this.px = r.bx;
      this.py = r.by;
      this.lost = false;
      this.lostFrames = 0;
      // Let the template adapt slowly to lighting and perspective changes.
      const fresh = this.sample(frame, this.px, this.py);
      for (let k = 0; k < fresh.length; k++) this.template[k] = this.template[k] * 0.9 + fresh[k] * 0.1;
    } else {
      this.lostFrames++;
      if (this.lostFrames > 5) this.lost = true;
    }
  }
}
