import type {ColorKey, Diagram} from './problems';

/**
 * Bright, well-separated hues that stay legible on an additive (black =
 * transparent) display. Width lines are also dashed so the two side types
 * differ by pattern as well as color.
 */
export const PALETTE: Record<ColorKey | 'line' | 'faint', string> = {
  length: '#FFA94D',
  width: '#4DABF7',
  total: '#69DB7C',
  line: '#FFFFFF',
  faint: '#5C5C5C',
};

interface Ctx {
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  font: string;
}

function setFont(c: Ctx, scale: number, weight = 600) {
  c.g.font = `${weight} ${Math.round(c.w * scale)}px ${c.font}`;
}

function label(c: Ctx, text: string, x: number, y: number, color: string, scale = 0.06) {
  setFont(c, scale);
  c.g.fillStyle = color;
  c.g.textAlign = 'center';
  c.g.textBaseline = 'middle';
  c.g.fillText(text, x, y);
}

function line(
  c: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
  dashed = false,
  cap: CanvasLineCap = 'round',
) {
  const {g} = c;
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = cap;
  g.setLineDash(dashed ? [width * 1.6, width * 1.4] : []);
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
  g.restore();
}

/** Fit a cols × rows box into the canvas, leaving room for side labels. */
function fitBox(c: Ctx, cols: number, rows: number, marginX: number, marginY: number) {
  const availW = c.w - marginX * 2;
  const availH = c.h - marginY * 2;
  const unit = Math.min(availW / cols, availH / rows);
  const bw = unit * cols;
  const bh = unit * rows;
  return {x: (c.w - bw) / 2, y: (c.h - bh) / 2, bw, bh, unit};
}

function drawRect(c: Ctx, d: Extract<Diagram, {kind: 'rect'}>) {
  const {x, y, bw, bh} = fitBox(c, d.cols, d.rows, c.w * 0.16, c.h * 0.16);
  const thin = c.w * 0.008;
  const thick = c.w * 0.018;
  const lengthOn = d.show === 'length' || d.show === 'both';
  const widthOn = d.show === 'width' || d.show === 'both';
  const total = d.show === 'total';

  const lc = total ? PALETTE.total : lengthOn ? PALETTE.length : PALETTE.line;
  const wc = total ? PALETTE.total : widthOn ? PALETTE.width : PALETTE.line;
  const lw = total || lengthOn ? thick : thin;
  const ww = total || widthOn ? thick : thin;

  line(c, x, y, x + bw, y, lc, lw);
  line(c, x, y + bh, x + bw, y + bh, lc, lw);
  line(c, x, y, x, y + bh, wc, ww, widthOn && !total);
  line(c, x + bw, y, x + bw, y + bh, wc, ww, widthOn && !total);

  const gap = c.w * 0.06;
  if (lengthOn) {
    const t = `${d.cols} ${d.unit}`;
    label(c, t, x + bw / 2, y - gap, PALETTE.length);
    label(c, t, x + bw / 2, y + bh + gap, PALETTE.length);
  }
  if (widthOn) {
    const t = `${d.rows} ${d.unit}`;
    label(c, t, x - gap * 1.4, y + bh / 2, PALETTE.width);
    label(c, t, x + bw + gap * 1.4, y + bh / 2, PALETTE.width);
  }
  if (total && d.totalLabel) {
    label(c, d.totalLabel, x + bw / 2, y + bh / 2, PALETTE.total, 0.1);
  }
}

function drawUnroll(c: Ctx, d: Extract<Diagram, {kind: 'unroll'}>) {
  const sum = d.segments.reduce((a, s) => a + s.value, 0);
  const left = c.w * 0.06;
  const span = c.w - left * 2;
  const barY = c.h * 0.42;
  const thick = c.h * 0.08;
  const sep = c.w * 0.012;

  let acc = 0;
  const ticks: number[] = [0];
  d.segments.forEach(s => {
    const x1 = left + (acc / sum) * span;
    acc += s.value;
    const x2 = left + (acc / sum) * span;
    line(c, x1 + sep, barY, x2 - sep, barY, PALETTE[s.color], thick, false, 'butt');
    label(c, String(s.value), (x1 + x2) / 2, barY - thick * 1.4, PALETTE[s.color]);
    ticks.push(acc);
  });

  if (d.showTotals) {
    const axisY = barY + thick * 1.6;
    line(c, left, axisY, left + span, axisY, PALETTE.faint, c.w * 0.006);
    ticks.forEach((t, i) => {
      const tx = left + (t / sum) * span;
      const last = i === ticks.length - 1;
      line(c, tx, axisY - thick * 0.4, tx, axisY + thick * 0.4, PALETTE.line, c.w * 0.006);
      label(c, String(t), tx, axisY + thick * 1.1, last && d.showAnswer ? PALETTE.total : PALETTE.line, 0.05);
    });
  }

  if (d.showAnswer) {
    label(c, `${sum} ${d.unit}`, c.w / 2, c.h * 0.9, PALETTE.total, 0.08);
  }
}

function drawGrid(c: Ctx, d: Extract<Diagram, {kind: 'grid'}>) {
  const {x, y, bw, bh, unit} = fitBox(c, d.cols, d.rows, c.w * 0.14, c.h * 0.1);
  const {g} = c;
  const pad = unit * 0.08;
  const thin = c.w * 0.006;

  for (let r = 0; r < d.rows; r++) {
    let fill: string | null = null;
    if (d.show === 'total') fill = PALETTE.total;
    else if (d.show === 'skip') fill = PALETTE.length;
    else if ((d.show === 'row' || d.show === 'rows') && r === 0) fill = PALETTE.length;

    for (let col = 0; col < d.cols; col++) {
      const cx = x + col * unit + pad;
      const cy = y + r * unit + pad;
      const s = unit - pad * 2;
      if (fill) {
        g.save();
        g.globalAlpha = 0.45;
        g.fillStyle = fill;
        g.fillRect(cx, cy, s, s);
        g.restore();
      }
      g.save();
      g.strokeStyle = fill ?? PALETTE.faint;
      g.lineWidth = thin;
      g.strokeRect(cx, cy, s, s);
      g.restore();
    }

    const rowMid = y + r * unit + unit / 2;
    if (d.show === 'rows' || d.show === 'skip') {
      label(c, String(r + 1), x - unit * 0.45, rowMid, PALETTE.width);
    }
    if (d.show === 'skip') {
      label(c, String((r + 1) * d.cols), x + bw + unit * 0.5, rowMid, PALETTE.total);
    }
  }

  if (d.show === 'row') {
    label(c, String(d.cols), x + bw + unit * 0.45, y + unit / 2, PALETTE.length);
  }
  if (d.show === 'total') {
    label(c, String(d.cols * d.rows), x + bw / 2, y + bh / 2, PALETTE.line, 0.11);
  }
}

/** Draw one diagram. The canvas is cleared to transparent (black on glass). */
export function drawDiagram(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  diagram: Diagram,
  font: string,
) {
  g.clearRect(0, 0, w, h);
  const c: Ctx = {g, w, h, font};
  if (diagram.kind === 'rect') drawRect(c, diagram);
  else if (diagram.kind === 'unroll') drawUnroll(c, diagram);
  else drawGrid(c, diagram);
}
