import { LAYOUTS, type Layout } from './CollageVariants';

export interface BorderAspect {
  id: string;
  w: number;
  h: number;
}

export const BORDER_ASPECTS: BorderAspect[] = [
  { id: '1:1', w: 1, h: 1 },
  { id: '4:5', w: 4, h: 5 },
  { id: '9:16', w: 9, h: 16 },
  { id: '16:9', w: 16, h: 9 },
  { id: '3:2', w: 3, h: 2 },
  { id: '2:3', w: 2, h: 3 },
  { id: '5:4', w: 5, h: 4 },
];

export const BORDER_MAX_PHOTOS = 5;

/** Border templates = the collage layouts for 1…5 photos (normalized cells, reading order). */
export const BORDER_LAYOUTS: Record<number, Layout[]> = Object.fromEntries(
  Array.from({ length: BORDER_MAX_PHOTOS }, (_, i) => [i + 1, (LAYOUTS[i + 1] || []).map((d) => d.layout)]),
);

export interface TemplateRef {
  count: number;
  index: number;
}

export function getBorderLayout(ref: TemplateRef): Layout {
  return BORDER_LAYOUTS[ref.count]?.[ref.index] ?? BORDER_LAYOUTS[1][0];
}

export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pixel rects for a layout on a W×H canvas. The margin (percent of the shorter side) is applied
 * as the outer border and as the gap between neighbouring cells.
 */
export function computeCellRects(layout: Layout, W: number, H: number, marginPct: number): CellRect[] {
  const m = (marginPct / 100) * Math.min(W, H);
  const innerW = W - 2 * m;
  const innerH = H - 2 * m;
  const eps = 1e-6;
  return layout.map((c) => {
    let x0 = m + c.x * innerW;
    let x1 = m + (c.x + c.width) * innerW;
    let y0 = m + c.y * innerH;
    let y1 = m + (c.y + c.height) * innerH;
    if (c.x > eps) x0 += m / 2;
    if (c.x + c.width < 1 - eps) x1 -= m / 2;
    if (c.y > eps) y0 += m / 2;
    if (c.y + c.height < 1 - eps) y1 -= m / 2;
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  });
}

/** Object-contain fit of an iw×ih image into a rect. */
export function containRect(iw: number, ih: number, r: CellRect): CellRect {
  if (!iw || !ih || !r.w || !r.h) return { x: r.x, y: r.y, w: 0, h: 0 };
  const s = Math.min(r.w / iw, r.h / ih);
  const w = iw * s;
  const h = ih * s;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/** Canvas pixel size for a given long edge. */
export function canvasSize(aspect: BorderAspect, longEdge: number): { width: number; height: number } {
  if (aspect.w >= aspect.h) {
    return { width: longEdge, height: Math.round((longEdge * aspect.h) / aspect.w) };
  }
  return { width: Math.round((longEdge * aspect.w) / aspect.h), height: longEdge };
}
