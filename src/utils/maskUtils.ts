import { v4 as uuidv4 } from 'uuid';
import { Mask, SubMaskMode, formatMaskTypeName } from '../components/panel/right/Masks';
import { ImageDimensions } from '../hooks/useImageRenderSize';

export const createSubMask = (
  type: Mask,
  imageDimensions: ImageDimensions,
  mode: SubMaskMode = SubMaskMode.Additive
) => {
  const { width, height } = imageDimensions || { width: 1000, height: 1000 };
  const common = {
    id: uuidv4(),
    visible: true,
    invert: false,
    opacity: 100,
    mode,
    name: formatMaskTypeName(type),
    type,
  };

  switch (type) {
    case Mask.Radial:
      return {
        ...common,
        parameters: {
          centerX: width / 2,
          centerY: height / 2,
          radiusX: width / 4,
          radiusY: width / 4,
          rotation: 0,
          feather: 0.5,
        },
      };
    case Mask.Linear:
      return {
        ...common,
        parameters: { startX: width * 0.25, startY: height / 2, endX: width * 0.75, endY: height / 2, range: 50 },
      };
    case Mask.Brush:
      return { ...common, parameters: { lines: [] } };
    case Mask.Flow:
      return { ...common, parameters: { lines: [], flow: 10 } };
    case Mask.AiSubject:
      return { ...common, parameters: { maskDataBase64: null, grow: 0, feather: 0 } };
    case Mask.AiForeground:
      return { ...common, parameters: { maskDataBase64: null, grow: 0, feather: 0 } };
    case Mask.QuickEraser:
      return { ...common, parameters: { maskDataBase64: null, grow: 50, feather: 50 } };
    default:
      return { ...common, parameters: {} };
  }
};


/**
 * Convert XMP-imported mask geometry from normalized 0–1 coords to image pixels.
 * CRS CircularGradient/Gradient use 0–1; RapidRAW canvas expects pixel space.
 */
export function denormalizeMaskCoordinates<T extends { masks?: any[] }>(
  adjustments: T,
  width: number,
  height: number,
): T {
  if (!adjustments?.masks?.length || !width || !height) return adjustments;
  const masks = adjustments.masks.map((container: any) => {
    if (!container?.subMasks?.length) return container;
    const subMasks = container.subMasks.map((sub: any) => {
      const p = sub?.parameters;
      if (!p || !p.normalized) return sub;
      const next = { ...p };
      if (sub.type === 'radial' || sub.type === 'Radial') {
        if (typeof next.centerX === 'number' && next.centerX <= 1.5) next.centerX = next.centerX * width;
        if (typeof next.centerY === 'number' && next.centerY <= 1.5) next.centerY = next.centerY * height;
        if (typeof next.radiusX === 'number' && next.radiusX <= 1.5) next.radiusX = next.radiusX * width;
        if (typeof next.radiusY === 'number' && next.radiusY <= 1.5) next.radiusY = next.radiusY * height;
      } else if (sub.type === 'linear' || sub.type === 'Linear') {
        if (typeof next.startX === 'number' && next.startX <= 1.5) next.startX = next.startX * width;
        if (typeof next.startY === 'number' && next.startY <= 1.5) next.startY = next.startY * height;
        if (typeof next.endX === 'number' && next.endX <= 1.5) next.endX = next.endX * width;
        if (typeof next.endY === 'number' && next.endY <= 1.5) next.endY = next.endY * height;
      }
      delete next.normalized;
      return { ...sub, parameters: next };
    });
    return { ...container, subMasks };
  });
  return { ...adjustments, masks };
}
