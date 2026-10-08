import clsx from 'clsx';
import { useState, useEffect, useLayoutEffect, useRef, useCallback, memo, useMemo } from 'react';
import { useEditorStore } from '../../../store/useEditorStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { loupeImageSrc } from '../../../utils/loupeDisplay';
import { softProofCssFilter } from '../../../utils/softProofProfiles';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Stage, Layer, Ellipse, Line, Transformer, Group, Circle, Rect } from 'react-konva';
import { PercentCrop, Crop } from 'react-image-crop';
import { Stamp, Bandage } from 'lucide-react';
import { Adjustments, AiPatch, Coord, MaskContainer } from '../../../utils/adjustments';
import { Mask, SubMask, SubMaskMode, ToolType } from '../right/Masks';
import { AppSettings, BrushSettings, SelectedImage } from '../../ui/AppProperties';
import { RenderSize } from '../../../hooks/useImageRenderSize';
import { useOsPlatform } from '../../../hooks/useOsPlatform';
import { useTranslation } from 'react-i18next';
import type { OverlayMode } from '../right/CropPanel';
import CompositionOverlays from './overlays/CompositionOverlays';

interface CursorPreview {
  visible: boolean;
  x: number;
  y: number;
}

interface DrawnLine {
  brushSize: number;
  feather?: number;
  flow?: number;
  points: Array<Coord>;
  tool: ToolType;
}

interface ImageCanvasProps {
  appSettings: AppSettings | null;
  activeAiPatchContainerId: string | null;
  activeAiSubMaskId: string | null;
  activeMaskContainerId: string | null;
  activeMaskId: string | null;
  adjustments: Adjustments;
  brushSettings: BrushSettings | null;
  crop: Crop | null;
  finalPreviewUrl: string | null;
  handleCropComplete(c: Crop, cp: PercentCrop): void;
  imageRenderSize: RenderSize;
  isAiEditing: boolean;
  isCropping: boolean;
  isMaskControlHovered: boolean;
  isMasking: boolean;
  isSliderDragging: boolean;
  isStraightenActive: boolean;
  /** Interactive Guided Upright guide drawing (PerspectiveUpright=5) */
  isGuidedUprightActive?: boolean;
  isRotationActive?: boolean;
  maskOverlay: MaskOverlayBitmap | null;
  onGenerateAiMask(id: string | null, start: Coord, end: Coord): void;
  onLiveMaskPreview?: (previewMaskDef: any) => void;
  onManualCleanup?(subMaskId: string, sourceX: number, sourceY: number): Promise<void> | void;
  onQuickErase(subMaskId: string | null, startPoint: Coord, endpoint: Coord): void;
  onSelectAiSubMask(id: string | null): void;
  onSelectMask(id: string | null): void;
  onSelectAiPatchContainer?: (id: string | null) => void;
  onSelectMaskContainer?: (id: string | null) => void;
  onStraighten(val: number): void;
  selectedImage: SelectedImage;
  setCrop(crop: Crop, perfentCrop: PercentCrop): void;
  setIsMaskHovered(isHovered: boolean): void;
  setIsMaskTouchInteracting(isInteracting: boolean): void;
  showOriginal: boolean;
  beforeAfterSplit?: boolean;
  transformedOriginalUrl: string | null;
  uncroppedAdjustedPreviewUrl: string | null;
  updateSubMask(id: string | null, subMask: Partial<SubMask>): void;
  interactivePatch?: { url: string; normX: number; normY: number; normW: number; normH: number } | null;
  isWbPickerActive?: boolean;
  onWbPicked?: () => void;
  isPointColorPickerActive?: boolean;
  onPointColorPicked?: () => void;
  setAdjustments(fn: (prev: Adjustments) => Adjustments): void;
  overlayMode?: OverlayMode;
  overlayRotation?: number;
  cursorStyle: string;
  isMaxZoom?: boolean;
  liveRotation?: number | null;
  transformState: { scale: number; positionX: number; positionY: number };
  hasRenderedFirstFrame: boolean;
}

interface MaskOverlayProps {
  adjustments: Adjustments;
  imageHeight: number;
  imageWidth: number;
  onMaskInteractionEnd(): void;
  onMaskInteractionStart(event?: any): void;
  isToolActive: boolean;
  isSelected: boolean;
  showBrushStrokes?: boolean;
  onMaskMouseEnter(): void;
  onMaskMouseLeave(): void;
  onPreviewUpdate?(id: string, subMask: Partial<SubMask>): void;
  onSelect(): void;
  onUpdate(id: string, subMask: Partial<SubMask>): void;
  scale: number;
  scaleX?: number;
  scaleY?: number;
  subMask: SubMask;
  offsetX: number;
  offsetY: number;
  stageScale: number;
}

const getEdgeFadeStyle = (fadeDistancePx: number = 128): React.CSSProperties => ({
  WebkitMaskImage: `
    linear-gradient(to right, transparent, black ${fadeDistancePx}px, black calc(100% - ${fadeDistancePx}px), transparent),
    linear-gradient(to bottom, transparent, black ${fadeDistancePx}px, black calc(100% - ${fadeDistancePx}px), transparent)
  `,
  WebkitMaskComposite: 'source-in',
  maskImage: `
    linear-gradient(to right, transparent, black ${fadeDistancePx}px, black calc(100% - ${fadeDistancePx}px), transparent),
    linear-gradient(to bottom, transparent, black ${fadeDistancePx}px, black calc(100% - ${fadeDistancePx}px), transparent)
  `,
  maskComposite: 'intersect',
});

const OptimizedBrushLine = memo(
  ({ line, scale, cropX, cropY }: { line: DrawnLine; scale: number; cropX: number; cropY: number }) => {
    const flattenedPoints = useMemo(() => {
      const pts = new Float32Array(line.points.length * 2);
      for (let i = 0; i < line.points.length; i++) {
        pts[i * 2] = (line.points[i].x - cropX) * scale;
        pts[i * 2 + 1] = (line.points[i].y - cropY) * scale;
      }
      return Array.from(pts);
    }, [line.points, scale, cropX, cropY]);

    return (
      <Line
        hitStrokeWidth={line.brushSize * scale}
        lineCap="round"
        lineJoin="round"
        points={flattenedPoints}
        stroke="transparent"
        strokeScaleEnabled={false}
        perfectDrawEnabled={false}
        shadowForStrokeEnabled={false}
      />
    );
  },
);

const SourcePreviewLine = memo(
  ({
    line,
    scale,
    cropX,
    cropY,
    dx,
    dy,
  }: {
    line: DrawnLine;
    scale: number;
    cropX: number;
    cropY: number;
    dx: number;
    dy: number;
  }) => {
    const flattenedPoints = useMemo(() => {
      const pts = new Float32Array(line.points.length * 2);
      for (let i = 0; i < line.points.length; i++) {
        pts[i * 2] = (line.points[i].x + dx - cropX) * scale;
        pts[i * 2 + 1] = (line.points[i].y + dy - cropY) * scale;
      }
      return Array.from(pts);
    }, [line.points, scale, cropX, cropY, dx, dy]);

    return (
      <Group>
        <Line
          lineCap="round"
          lineJoin="round"
          points={flattenedPoints}
          stroke="rgba(255, 255, 255, 0.15)"
          strokeWidth={line.brushSize * scale}
          strokeScaleEnabled={false}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
        />
        <Line
          lineCap="round"
          lineJoin="round"
          points={flattenedPoints}
          stroke="white"
          strokeWidth={1.5}
          dash={[4, 4]}
          opacity={0.8}
          strokeScaleEnabled={false}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
        />
      </Group>
    );
  },
);

/** Live mask overlay from `generate_mask_overlay`: one intensity byte per pixel. */
export interface MaskOverlayBitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Tints the overlay red (alpha = intensity / 2) straight into a canvas: no image decode. */
const MaskOverlayCanvas = memo(({ overlay, style }: { overlay: MaskOverlayBitmap; style: React.CSSProperties }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageDataRef = useRef<ImageData | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width, height, data } = overlay;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    let image = imageDataRef.current;
    if (!image || image.width !== width || image.height !== height) {
      image = ctx.createImageData(width, height);
      for (let i = 0; i < image.data.length; i += 4) image.data[i] = 255;
      imageDataRef.current = image;
    }
    const pixels = image.data;
    for (let i = 0, a = 3; i < data.length; i++, a += 4) pixels[a] = data[i] >> 1;
    ctx.putImageData(image, 0, 0);
  }, [overlay]);

  return <canvas ref={canvasRef} className="absolute pointer-events-none" style={style} aria-hidden />;
});

const MaskOverlay = memo(
  ({
    adjustments,
    imageHeight,
    imageWidth,
    onMaskInteractionEnd,
    onMaskInteractionStart,
    isToolActive,
    isSelected,
    showBrushStrokes = true,
    onMaskMouseEnter,
    onMaskMouseLeave,
    onPreviewUpdate,
    onSelect,
    onUpdate,
    scale,
    scaleX,
    scaleY,
    subMask,
    offsetX,
    offsetY,
    stageScale,
  }: MaskOverlayProps) => {
    const shapeRef = useRef<any>(null);
    const trRef = useRef<any>(null);
    const rotateStartRef = useRef<any>(null);

    const sx = scaleX ?? scale;
    const sy = scaleY ?? scale;
    const crop = adjustments.crop;
    const isPercent = crop?.unit === '%';
    const cropX = crop ? (isPercent ? (crop.x / 100) * imageWidth : crop.x) : 0;
    const cropY = crop ? (isPercent ? (crop.y / 100) * imageHeight : crop.y) : 0;
    const cropW = crop ? (isPercent ? (crop.width / 100) * imageWidth : crop.width) : imageWidth;
    const cropH = crop ? (isPercent ? (crop.height / 100) * imageHeight : crop.height) : imageHeight;

    const [p, setP] = useState(subMask.parameters);
    const pRef = useRef(p);
    const isDragging = useRef(false);

    const dragStartPointer = useRef<Coord | null>(null);
    const dragStartParams = useRef<any>(null);

    const getPointer = useCallback(
      (stage: any) => {
        const pos = stage.getPointerPosition();
        if (!pos) return null;
        return { x: pos.x / stageScale - offsetX, y: pos.y / stageScale - offsetY };
      },
      [offsetX, offsetY, stageScale],
    );

    useEffect(() => {
      if (!isDragging.current) {
        setP(subMask.parameters);
        pRef.current = subMask.parameters;
      }
    }, [subMask.parameters]);

    const updateP = useCallback((newP: any) => {
      setP(newP);
      pRef.current = newP;
    }, []);

    const handleMaskTouchStart = useCallback(
      (e: any) => {
        if (e.evt && typeof e.evt.button === 'number' && e.evt.button !== 0) return;

        onMaskInteractionStart(e);
        if (e.evt.cancelable) e.evt.preventDefault();
        e.evt.stopPropagation?.();
      },
      [onMaskInteractionStart],
    );

    const handleMaskTouchEnd = useCallback(() => {
      onMaskInteractionEnd();
    }, [onMaskInteractionEnd]);

    const handleSelect = isToolActive ? undefined : onSelect;

    useEffect(() => {
      if (isSelected && trRef.current && shapeRef.current) {
        trRef.current?.nodes([shapeRef.current]);
        trRef.current?.getLayer().batchDraw();
      }
    }, [isSelected, isToolActive]);

    const lockDragBoundFunc = useCallback(function (this: any) {
      return this.getAbsolutePosition();
    }, []);

    const handleRadialDragStart = useCallback(
      (e: any) => {
        if (e.evt && typeof e.evt.button === 'number' && e.evt.button !== 0) return;
        isDragging.current = true;
        onMaskInteractionStart(e);
        dragStartPointer.current = getPointer(e.target.getStage());
        dragStartParams.current = { ...pRef.current };
      },
      [onMaskInteractionStart, getPointer],
    );

    const handleRadialDragMove = useCallback(
      (e: any) => {
        const pointerPos = getPointer(e.target.getStage());
        if (!pointerPos || !dragStartPointer.current || !dragStartParams.current) return;

        const dx = (pointerPos.x - dragStartPointer.current.x) / sx;
        const dy = (pointerPos.y - dragStartPointer.current.y) / sy;

        const newP = {
          ...dragStartParams.current,
          centerX: dragStartParams.current.centerX + dx,
          centerY: dragStartParams.current.centerY + dy,
        };

        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });

        onUpdate(subMask.id, { parameters: newP });
      },
      [scale, updateP, onPreviewUpdate, subMask.id, getPointer, onUpdate],
    );

    const handleRadialDragEnd = useCallback(() => {
      isDragging.current = false;
      onMaskInteractionEnd();
      onUpdate(subMask.id, { parameters: pRef.current });
    }, [subMask.id, onMaskInteractionEnd, onUpdate]);

    const handleRadialTransformStart = useCallback(
      (e: any) => {
        isDragging.current = true;
        onMaskInteractionStart(e);
      },
      [onMaskInteractionStart],
    );

    const handleRadialTransform = useCallback(() => {
      const node = shapeRef.current;
      if (!node) return;

      const scaleX = Math.abs(node.scaleX());
      const scaleY = Math.abs(node.scaleY());

      if (pRef.current.radiusX * scaleX < 5 || pRef.current.radiusY * scaleY < 5) {
        node.scaleX(node.lastValidScaleX || 1);
        node.scaleY(node.lastValidScaleY || 1);
      } else {
        node.lastValidScaleX = scaleX;
        node.lastValidScaleY = scaleY;
      }

      const newRadiusX = pRef.current.radiusX * node.scaleX();
      const newRadiusY = pRef.current.radiusY * node.scaleY();

      const newP = {
        ...pRef.current,
        centerX: node.x() / sx + cropX,
        centerY: node.y() / sy + cropY,
        radiusX: newRadiusX,
        radiusY: newRadiusY,
        rotation: node.rotation(),
      };

      if (onPreviewUpdate) {
        onPreviewUpdate(subMask.id, { parameters: newP });
      }

      onUpdate(subMask.id, { parameters: newP });
    }, [onPreviewUpdate, scale, cropX, cropY, subMask.id, onUpdate]);

    const handleRadialTransformEnd = useCallback(() => {
      const node = shapeRef.current;
      if (!node) return;

      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      const newRadiusX = pRef.current.radiusX * scaleX;
      const newRadiusY = pRef.current.radiusY * scaleY;

      node.scaleX(1);
      node.scaleY(1);

      const newP = {
        ...pRef.current,
        centerX: node.x() / sx + cropX,
        centerY: node.y() / sy + cropY,
        radiusX: newRadiusX,
        radiusY: newRadiusY,
        rotation: node.rotation(),
      };

      updateP(newP);
      isDragging.current = false;
      onMaskInteractionEnd();
      onUpdate(subMask.id, { parameters: newP });
    }, [scale, cropX, cropY, updateP, onMaskInteractionEnd, onUpdate, subMask.id]);

    const setRotateCursor = useCallback(
      (stage: any, pointerPos: any) => {
        const cx = (pRef.current.centerX - cropX) * sx;
        const cy = (pRef.current.centerY - cropY) * sy;
        const angle = Math.atan2(pointerPos.y - cy, pointerPos.x - cx) * (180 / Math.PI);

        const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0px 1px 2px rgba(0,0,0,0.8));">
          <g transform="rotate(${Math.round(angle)} 16 16)">
            <path d="M 23 9 A 10 10 0 0 1 23 23" />
            <path d="M 28 9 L 23 9 L 23 14" />
            <path d="M 28 23 L 23 23 L 23 18" />
          </g>
        </svg>`;
        const encodedSvg = encodeURIComponent(svgStr);
        stage.container().style.cursor = `url('data:image/svg+xml;utf8,${encodedSvg}') 16 16, crosshair`;
      },
      [cropX, cropY, scale],
    );

    const handleRotateStart = useCallback(
      (e: any) => {
        if (e.evt && typeof e.evt.button === 'number' && e.evt.button !== 0) return;

        isDragging.current = true;
        onMaskInteractionStart(e);
        e.cancelBubble = true;
        if (e.evt && e.evt.cancelable) e.evt.preventDefault();

        const stage = e.target.getStage();
        const pointer = getPointer(stage);
        if (!pointer) return;

        const cx = (pRef.current.centerX - cropX) * sx;
        const cy = (pRef.current.centerY - cropY) * sy;

        const startAngle = Math.atan2(pointer.y - cy, pointer.x - cx);
        rotateStartRef.current = {
          angle: startAngle,
          rotation: pRef.current.rotation || 0,
        };
      },
      [onMaskInteractionStart, cropX, cropY, scale, getPointer],
    );

    const handleRotateMove = useCallback(
      (e: any) => {
        if (!rotateStartRef.current) return;
        const stage = e.target.getStage();
        const pointer = getPointer(stage);
        if (!pointer) return;

        setRotateCursor(stage, pointer);

        const cx = (pRef.current.centerX - cropX) * sx;
        const cy = (pRef.current.centerY - cropY) * sy;

        const currentAngle = Math.atan2(pointer.y - cy, pointer.x - cx);
        const angleDiff = currentAngle - rotateStartRef.current.angle;
        const angleDiffDeg = (angleDiff * 180) / Math.PI;

        const newRotation = rotateStartRef.current.rotation + angleDiffDeg;

        const newP = {
          ...pRef.current,
          rotation: newRotation,
        };

        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });
        onUpdate(subMask.id, { parameters: newP });
      },
      [cropX, cropY, scale, updateP, onPreviewUpdate, subMask.id, setRotateCursor, getPointer, onUpdate],
    );

    const handleRotateEnd = useCallback(
      (e: any) => {
        isDragging.current = false;
        rotateStartRef.current = null;
        onMaskInteractionEnd();
        onUpdate(subMask.id, { parameters: pRef.current });

        if (e?.target?.getStage) {
          e.target.getStage().container().style.cursor = '';
        }
      },
      [subMask.id, onMaskInteractionEnd, onUpdate],
    );

    const handleRotateHoverMove = useCallback(
      (e: any) => {
        if (isToolActive || isDragging.current) return;
        const stage = e.target.getStage();
        const pointer = getPointer(stage);
        if (pointer) setRotateCursor(stage, pointer);
      },
      [isToolActive, setRotateCursor, getPointer],
    );

    const handleRotateMouseEnter = useCallback(
      (e: any) => {
        onMaskMouseEnter();
        if (!isToolActive && !isDragging.current) {
          const stage = e.target.getStage();
          const pointer = getPointer(stage);
          if (pointer) setRotateCursor(stage, pointer);
        }
      },
      [onMaskMouseEnter, isToolActive, setRotateCursor, getPointer],
    );

    const handleRotateMouseLeave = useCallback(
      (e: any) => {
        onMaskMouseLeave();
        if (!isDragging.current) {
          const stage = e.target.getStage();
          stage.container().style.cursor = '';
        }
      },
      [onMaskMouseLeave],
    );

    const handleLinearGroupDragStart = useCallback(
      (e: any) => {
        if (e.evt && typeof e.evt.button === 'number' && e.evt.button !== 0) return;
        isDragging.current = true;
        onMaskInteractionStart(e);
        dragStartPointer.current = getPointer(e.target.getStage());
        dragStartParams.current = { ...pRef.current };
        e.cancelBubble = true;
      },
      [onMaskInteractionStart, getPointer],
    );

    const handleLinearGroupDragMove = useCallback(
      (e: any) => {
        const pointerPos = getPointer(e.target.getStage());
        if (!pointerPos || !dragStartPointer.current || !dragStartParams.current) return;

        const dx = (pointerPos.x - dragStartPointer.current.x) / sx;
        const dy = (pointerPos.y - dragStartPointer.current.y) / sy;

        const newP = {
          ...dragStartParams.current,
          startX: dragStartParams.current.startX + dx,
          startY: dragStartParams.current.startY + dy,
          endX: dragStartParams.current.endX + dx,
          endY: dragStartParams.current.endY + dy,
        };

        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });
        onUpdate(subMask.id, { parameters: newP });
      },
      [scale, updateP, onPreviewUpdate, subMask.id, getPointer, onUpdate],
    );

    const handleLinearGroupDragEnd = useCallback(
      (e: any) => {
        isDragging.current = false;
        e.cancelBubble = true;
        onMaskInteractionEnd();
        onUpdate(subMask.id, { parameters: pRef.current });
      },
      [subMask.id, onMaskInteractionEnd, onUpdate],
    );

    const handleLinearPointDragStart = useCallback(
      (e: any) => {
        if (e.evt && typeof e.evt.button === 'number' && e.evt.button !== 0) return;
        isDragging.current = true;
        onMaskInteractionStart(e);
        e.cancelBubble = true;
      },
      [onMaskInteractionStart],
    );

    const handleLinearPointDragMove = useCallback(
      (e: any, pointType: string) => {
        const stage = e.target.getStage();
        const pointerPos = getPointer(stage);
        if (!pointerPos) return;

        const newX = pointerPos.x / sx + cropX;
        const newY = pointerPos.y / sy + cropY;

        const newP = { ...pRef.current };
        if (pointType === 'start') {
          newP.startX = newX;
          newP.startY = newY;
        } else {
          newP.endX = newX;
          newP.endY = newY;
        }
        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });
        onUpdate(subMask.id, { parameters: newP });
      },
      [scale, cropX, cropY, updateP, onPreviewUpdate, subMask.id, getPointer, onUpdate],
    );

    const handleLinearRangeDragMove = useCallback(
      (e: any) => {
        const stage = e.target.getStage();
        const pointerPos = getPointer(stage);
        if (!pointerPos) return;

        const { startX, startY, endX, endY } = pRef.current;
        const sX = (startX - cropX) * scale;
        const sY = (startY - cropY) * scale;
        const eX = (endX - cropX) * scale;
        const eY = (endY - cropY) * scale;

        const dx = eX - sX;
        const dy = eY - sY;
        const len = Math.sqrt(dx * dx + dy * dy);

        let newRange = pRef.current.range;
        if (len > 0) {
          const dist = Math.abs(dx * (sY - pointerPos.y) - (sX - pointerPos.x) * dy) / len;
          newRange = Math.max(0.1, dist / sy);
        }

        const newP = { ...pRef.current, range: newRange };
        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });

        onUpdate(subMask.id, { parameters: newP });
      },
      [scale, cropX, cropY, updateP, onPreviewUpdate, subMask.id, getPointer, onUpdate],
    );

    const handleLinearPointDragEnd = useCallback(
      (e: any) => {
        isDragging.current = false;
        e.cancelBubble = true;
        onMaskInteractionEnd();
        onUpdate(subMask.id, { parameters: pRef.current });
      },
      [subMask.id, onMaskInteractionEnd, onUpdate],
    );

    if (!subMask.visible) {
      return null;
    }

    const commonProps = {
      dash: [4, 4],
      onClick: handleSelect,
      onTap: handleSelect,
      opacity: isSelected ? 1 : 0.7,
      stroke: isSelected
        ? '#0ea5e9'
        : subMask.mode === SubMaskMode.Subtractive
          ? '#f43f5e'
          : subMask.mode === SubMaskMode.Intersect
            ? '#a855f7'
            : 'white',
      strokeScaleEnabled: false,
      strokeWidth: isSelected ? 3 : 2,
    };

    if (subMask.type === Mask.AiSubject || subMask.type === Mask.QuickEraser) {
      const { startX, startY, endX, endY } = p;
      if (startX !== undefined && startY !== undefined && endX !== undefined && endY !== undefined) {
        const isPoint = Math.abs(startX - endX) < 1e-6 && Math.abs(startY - endY) < 1e-6;
        if (isPoint) {
          return (
            <Circle
              x={(startX - cropX) * scale}
              y={(startY - cropY) * scale}
              radius={5}
              stroke={isSelected ? '#0ea5e9' : 'white'}
              strokeWidth={2}
              listening={!isToolActive}
              onClick={handleSelect}
              onTap={handleSelect}
              onTouchEnd={handleMaskTouchEnd}
              onTouchStart={handleMaskTouchStart}
              onMouseEnter={onMaskMouseEnter}
              onMouseLeave={onMaskMouseLeave}
              shadowColor="black"
              shadowBlur={2}
              shadowOpacity={0.8}
            />
          );
        } else {
          return (
            <Rect
              height={Math.max(0.1, Math.abs(endY - startY) * scale)}
              onMouseEnter={onMaskMouseEnter}
              onMouseLeave={onMaskMouseLeave}
              onTouchEnd={handleMaskTouchEnd}
              onTouchStart={handleMaskTouchStart}
              width={Math.max(0.1, Math.abs(endX - startX) * scale)}
              x={(Math.min(startX, endX) - cropX) * scale}
              y={(Math.min(startY, endY) - cropY) * scale}
              {...commonProps}
            />
          );
        }
      }
      return null;
    }

    if (
      subMask.type === Mask.Brush ||
      subMask.type === Mask.Flow ||
      subMask.type === Mask.Clone ||
      subMask.type === Mask.Heal
    ) {
      const { lines = [], sourceX, sourceY } = p;

      let dx = 0;
      let dy = 0;
      let hasSource = false;

      if (
        (subMask.type === Mask.Clone || subMask.type === Mask.Heal) &&
        sourceX !== undefined &&
        sourceY !== undefined &&
        lines.length > 0
      ) {
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const line of lines) {
          for (const pt of line.points) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
          }
        }
        if (minX !== Infinity) {
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          dx = sourceX - cx;
          dy = sourceY - cy;
          hasSource = true;
        }
      }

      return (
        <Group
          onClick={handleSelect}
          onTap={handleSelect}
          onTouchEnd={handleMaskTouchEnd}
          onTouchStart={handleMaskTouchStart}
        >
          <Group visible={showBrushStrokes !== false}>
            {lines.map((line: DrawnLine, i: number) => (
              <OptimizedBrushLine key={i} line={line} scale={scale} cropX={cropX} cropY={cropY} />
            ))}

            {hasSource &&
              isSelected &&
              lines.map((line: DrawnLine, i: number) => (
                <SourcePreviewLine
                  key={`source-${i}`}
                  line={line}
                  scale={scale}
                  cropX={cropX}
                  cropY={cropY}
                  dx={dx}
                  dy={dy}
                />
              ))}
          </Group>

          {sourceX !== undefined && sourceY !== undefined && isSelected && (
            <Group x={(sourceX - cropX) * scale} y={(sourceY - cropY) * scale}>
              <Circle
                radius={6 / stageScale}
                stroke="white"
                strokeWidth={2 / stageScale}
                shadowColor="black"
                shadowBlur={2 / stageScale}
              />
              <Circle
                radius={6 / stageScale}
                stroke="black"
                strokeWidth={1 / stageScale}
                dash={[2 / stageScale, 2 / stageScale]}
              />
              <Line
                points={[-10 / stageScale, 0, 10 / stageScale, 0]}
                stroke="white"
                strokeWidth={1.5 / stageScale}
                shadowColor="black"
                shadowBlur={2 / stageScale}
              />
              <Line
                points={[0, -10 / stageScale, 0, 10 / stageScale]}
                stroke="white"
                strokeWidth={1.5 / stageScale}
                shadowColor="black"
                shadowBlur={2 / stageScale}
              />
            </Group>
          )}
        </Group>
      );
    }

    if (subMask.type === Mask.Radial) {
      const { centerX, centerY, radiusX, radiusY, rotation } = p;
      if (p.isInitialDraw && (radiusX < 1 || radiusY < 2)) return null;

      return (
        <Group>
          {isSelected && !isToolActive && (
            <Ellipse
              x={(centerX - cropX) * scale}
              y={(centerY - cropY) * scale}
              radiusX={Math.max(0.1, radiusX * scale) + 35}
              radiusY={Math.max(0.1, radiusY * scale) + 35}
              rotation={rotation}
              fill="transparent"
              draggable
              dragBoundFunc={lockDragBoundFunc}
              onDragStart={handleRotateStart}
              onDragMove={handleRotateMove}
              onDragEnd={handleRotateEnd}
              onMouseEnter={handleRotateMouseEnter}
              onMouseMove={handleRotateHoverMove}
              onMouseLeave={handleRotateMouseLeave}
              onTouchStart={handleRotateStart}
              onTouchMove={handleRotateMove}
              onTouchEnd={handleRotateEnd}
            />
          )}

          <Ellipse
            {...commonProps}
            ref={shapeRef}
            fill="transparent"
            draggable={!isToolActive}
            dragBoundFunc={lockDragBoundFunc}
            onDragStart={handleRadialDragStart}
            onDragMove={handleRadialDragMove}
            onDragEnd={handleRadialDragEnd}
            onMouseEnter={(e: any) => {
              onMaskMouseEnter();
              if (!isToolActive && !isDragging.current) {
                e.target.getStage().container().style.cursor = 'move';
              }
            }}
            onMouseLeave={(e: any) => {
              onMaskMouseLeave();
              if (!isDragging.current && e?.target?.getStage) {
                e.target.getStage().container().style.cursor = '';
              }
            }}
            onTouchEnd={handleMaskTouchEnd}
            onTouchStart={handleMaskTouchStart}
            radiusX={Math.max(0.1, radiusX * scale)}
            radiusY={Math.max(0.1, radiusY * scale)}
            rotation={rotation}
            x={(centerX - cropX) * scale}
            y={(centerY - cropY) * scale}
          />
          {isSelected && !isToolActive && (
            <Transformer
              ref={trRef}
              centeredScaling={true}
              rotateEnabled={false}
              enabledAnchors={[
                'top-left',
                'top-right',
                'bottom-left',
                'bottom-right',
                'top-center',
                'bottom-center',
                'middle-left',
                'middle-right',
              ]}
              onMouseDown={(e) => {
                if (e.evt && typeof e.evt.button === 'number' && e.evt.button !== 0) return;
                e.cancelBubble = true;
                e.evt.preventDefault();
              }}
              onTouchStart={(e) => {
                handleMaskTouchStart(e);
                e.cancelBubble = true;
                e.evt.preventDefault();
              }}
              onTouchEnd={handleMaskTouchEnd}
              boundBoxFunc={(oldBox, newBox) => {
                if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
                  return oldBox;
                }
                return newBox;
              }}
              onTransformStart={handleRadialTransformStart}
              onTransform={handleRadialTransform}
              onTransformEnd={handleRadialTransformEnd}
              onMouseEnter={onMaskMouseEnter}
              onMouseLeave={onMaskMouseLeave}
            />
          )}
        </Group>
      );
    }

    if (subMask.type === Mask.Linear) {
      const defaultRange = Math.min(cropW, cropH) * 0.1;
      const { startX, startY, endX, endY, range = defaultRange } = p;

      const flickDistX = startX - endX;
      const flickDistY = startY - endY;
      if (p.isInitialDraw && Math.sqrt(flickDistX * flickDistX + flickDistY * flickDistY) < 1) return null;

      const sX = (startX - cropX) * scale;
      const sY = (startY - cropY) * scale;
      const eX = (endX - cropX) * scale;
      const eY = (endY - cropY) * scale;
      const r = range * scale;

      const idx = endX - startX;
      const idy = endY - startY;
      const angle = Math.atan2(idy, idx);
      const angleDeg = (angle * 180) / Math.PI;

      const centerX = sX + (eX - sX) / 2;
      const centerY = sY + (eY - sY) / 2;

      const nx = -Math.sin(angle);
      const ny = Math.cos(angle);
      const dx_norm = Math.cos(angle);
      const dy_norm = Math.sin(angle);

      const EXT = 5000;
      const topRangePts = [
        sX + nx * r - dx_norm * EXT,
        sY + ny * r - dy_norm * EXT,
        eX + nx * r + dx_norm * EXT,
        eY + ny * r + dy_norm * EXT,
      ];
      const botRangePts = [
        sX - nx * r - dx_norm * EXT,
        sY - ny * r - dy_norm * EXT,
        eX - nx * r + dx_norm * EXT,
        eY - ny * r + dy_norm * EXT,
      ];

      const lineProps = {
        ...commonProps,
        strokeWidth: isSelected ? 2.5 : 2,
        dash: [6, 6],
        hitStrokeWidth: 40,
      };

      const showFeatherLines = isSelected && (!isToolActive || p.isInitialDraw);

      return (
        <Group>
          <Group
            x={centerX}
            y={centerY}
            rotation={angleDeg}
            draggable={isSelected && !isToolActive}
            dragBoundFunc={lockDragBoundFunc}
            onDragStart={handleLinearGroupDragStart}
            onDragMove={handleLinearGroupDragMove}
            onDragEnd={handleLinearGroupDragEnd}
            onClick={handleSelect}
            onTap={handleSelect}
            onTouchEnd={handleMaskTouchEnd}
            onTouchStart={handleMaskTouchStart}
            onMouseEnter={(e: any) => {
              onMaskMouseEnter();
              if (!isToolActive) e.target.getStage().container().style.cursor = 'move';
            }}
            onMouseLeave={(e: any) => {
              onMaskMouseLeave();
              e.target.getStage().container().style.cursor = '';
            }}
          >
            <Line points={[-5000, 0, 5000, 0]} {...lineProps} dash={[2, 3]} />
          </Group>

          {showFeatherLines && (
            <>
              <Line
                points={topRangePts}
                {...lineProps}
                draggable={!isToolActive}
                dragBoundFunc={lockDragBoundFunc}
                onDragStart={handleLinearPointDragStart}
                onDragMove={handleLinearRangeDragMove}
                onDragEnd={handleLinearPointDragEnd}
                onTouchEnd={handleMaskTouchEnd}
                onTouchStart={handleMaskTouchStart}
                onMouseEnter={(e: any) => {
                  onMaskMouseEnter();
                  if (!isToolActive) e.target.getStage().container().style.cursor = 'row-resize';
                }}
                onMouseLeave={(e: any) => {
                  onMaskMouseLeave();
                  e.target.getStage().container().style.cursor = '';
                }}
              />
              <Line
                points={botRangePts}
                {...lineProps}
                draggable={!isToolActive}
                dragBoundFunc={lockDragBoundFunc}
                onDragStart={handleLinearPointDragStart}
                onDragMove={handleLinearRangeDragMove}
                onDragEnd={handleLinearPointDragEnd}
                onTouchEnd={handleMaskTouchEnd}
                onTouchStart={handleMaskTouchStart}
                onMouseEnter={(e: any) => {
                  onMaskMouseEnter();
                  if (!isToolActive) e.target.getStage().container().style.cursor = 'row-resize';
                }}
                onMouseLeave={(e: any) => {
                  onMaskMouseLeave();
                  e.target.getStage().container().style.cursor = '';
                }}
              />
            </>
          )}

          {isSelected && !isToolActive && (
            <>
              <Circle
                x={sX}
                y={sY}
                radius={8 / stageScale}
                fill="#0ea5e9"
                stroke="white"
                strokeWidth={2 / stageScale}
                draggable
                dragBoundFunc={lockDragBoundFunc}
                onDragStart={handleLinearPointDragStart}
                onDragMove={(e) => handleLinearPointDragMove(e, 'start')}
                onDragEnd={handleLinearPointDragEnd}
                onTouchEnd={handleMaskTouchEnd}
                onTouchStart={handleMaskTouchStart}
                onMouseEnter={(e: any) => {
                  onMaskMouseEnter();
                  e.target.getStage().container().style.cursor = 'grab';
                }}
                onMouseLeave={(e: any) => {
                  onMaskMouseLeave();
                  e.target.getStage().container().style.cursor = '';
                }}
              />
              <Circle
                x={eX}
                y={eY}
                radius={8 / stageScale}
                fill="#0ea5e9"
                stroke="white"
                strokeWidth={2 / stageScale}
                draggable
                dragBoundFunc={lockDragBoundFunc}
                onDragStart={handleLinearPointDragStart}
                onDragMove={(e) => handleLinearPointDragMove(e, 'end')}
                onDragEnd={handleLinearPointDragEnd}
                onTouchEnd={handleMaskTouchEnd}
                onTouchStart={handleMaskTouchStart}
                onMouseEnter={(e: any) => {
                  onMaskMouseEnter();
                  e.target.getStage().container().style.cursor = 'grab';
                }}
                onMouseLeave={(e: any) => {
                  onMaskMouseLeave();
                  e.target.getStage().container().style.cursor = '';
                }}
              />
            </>
          )}

          {!isSelected && (
            <>
              <Line
                points={topRangePts}
                {...lineProps}
                opacity={0.7}
                stroke="white"
                listening={true}
                onClick={handleSelect}
                onTap={handleSelect}
                onTouchEnd={handleMaskTouchEnd}
                onTouchStart={handleMaskTouchStart}
                onMouseEnter={(e: any) => {
                  onMaskMouseEnter();
                  if (!isToolActive) e.target.getStage().container().style.cursor = 'row-resize';
                }}
                onMouseLeave={(e: any) => {
                  onMaskMouseLeave();
                  e.target.getStage().container().style.cursor = '';
                }}
              />
              <Line
                points={botRangePts}
                {...lineProps}
                opacity={0.7}
                stroke="white"
                listening={true}
                onClick={handleSelect}
                onTap={handleSelect}
                onTouchEnd={handleMaskTouchEnd}
                onTouchStart={handleMaskTouchStart}
                onMouseEnter={(e: any) => {
                  onMaskMouseEnter();
                  if (!isToolActive) e.target.getStage().container().style.cursor = 'row-resize';
                }}
                onMouseLeave={(e: any) => {
                  onMaskMouseLeave();
                  e.target.getStage().container().style.cursor = '';
                }}
              />
            </>
          )}
        </Group>
      );
    }

    if (subMask.type === Mask.Color || subMask.type === Mask.Luminance) {
      const samples: Array<{ x: number; y: number }> = Array.isArray(p.samples) && p.samples.length > 0
        ? p.samples
        : (p.targetX !== undefined && p.targetX >= 0 && p.targetY !== undefined && p.targetY >= 0
            ? [{ x: p.targetX, y: p.targetY }]
            : []);
      if (samples.length === 0) return null;
      return (
        <Group listening={false}>
          {samples.map((sample, index) => (
            <Circle
              key={`${subMask.id}-sample-${index}`}
              x={(sample.x - cropX) * scale}
              y={(sample.y - cropY) * scale}
              radius={5}
              stroke={isSelected ? '#0ea5e9' : 'white'}
              strokeWidth={2}
              listening={false}
              onTouchEnd={handleMaskTouchEnd}
              onTouchStart={handleMaskTouchStart}
              shadowColor="black"
              shadowBlur={2}
              shadowOpacity={0.8}
            />
          ))}
        </Group>
      );
    }
    return null;
  },
);

const ImageCanvas = memo(
  ({
    appSettings,
    activeAiPatchContainerId,
    activeAiSubMaskId,
    activeMaskContainerId,
    activeMaskId,
    adjustments,
    brushSettings,
    crop,
    finalPreviewUrl,
    handleCropComplete,
    imageRenderSize,
    interactivePatch,
    isAiEditing,
    isCropping,
    isMaskControlHovered,
    isMasking,
    isSliderDragging,
    isStraightenActive,
    isGuidedUprightActive = false,
    isRotationActive,
    maskOverlay,
    onGenerateAiMask,
    onLiveMaskPreview,
    onManualCleanup,
    onQuickErase,
    onSelectAiSubMask,
    onSelectMask,
    onSelectAiPatchContainer,
    onSelectMaskContainer,
    onStraighten,
    selectedImage,
    setCrop,
    setIsMaskHovered,
    setIsMaskTouchInteracting,
    showOriginal,
    beforeAfterSplit = false,
    transformedOriginalUrl,
    uncroppedAdjustedPreviewUrl,
    updateSubMask,
    isWbPickerActive = false,
    onWbPicked,
    isPointColorPickerActive = false,
    onPointColorPicked,
    setAdjustments,
    overlayRotation,
    overlayMode,
    cursorStyle,
    isMaxZoom,
    liveRotation,
    transformState,
    hasRenderedFirstFrame,
  }: ImageCanvasProps) => {
    const beforeAfterOrientation = useEditorStore((s) => s.beforeAfterOrientation);
    const softProofing = useEditorStore((s) => s.softProofing);
    const showMaskOverlay = useEditorStore((s) => s.showMaskOverlay);
    const softProofProfile = useEditorStore((s) => s.softProofProfile);
    const softProofIntent = useEditorStore((s) => s.softProofIntent);
    const softProofSimulatePaper = useEditorStore((s) => s.softProofSimulatePaper);
    const softProofShowGamutWarning = useEditorStore((s) => s.softProofShowGamutWarning);
    const softProofFilter = softProofing
      ? softProofCssFilter(softProofProfile, softProofIntent || 'relative', !!softProofSimulatePaper)
      : undefined;

    const [isCropViewVisible, setIsCropViewVisible] = useState(false);
    const cropImageRef = useRef<HTMLImageElement>(null);
    const [displayedMask, setDisplayedMask] = useState<MaskOverlayBitmap | null>(null);
    const [originalLoaded, setOriginalLoaded] = useState<boolean>(false);
    const [baSplitRatio, setBaSplitRatio] = useState(0.5); // 0–1, left = before
    const baDragRef = useRef(false);
    const [localInitialDrawParams, setLocalInitialDrawParams] = useState<any>(null);
    // A mask drag renders like a slider drag (interactive preview, save on release). The
    // window pointerup is a safety net: a press that never becomes a Konva drag must not
    // leave the editor stuck in drag mode (it would hold back saving).
    const maskDragReleaseRef = useRef<(() => void) | null>(null);
    const setIsMaskInteractionActive = useCallback((active: boolean) => {
      const { isSliderDragging: dragging, setEditor } = useEditorStore.getState();
      if (active) {
        if (!dragging) setEditor({ isSliderDragging: true });
        if (!maskDragReleaseRef.current) {
          const release = () => {
            window.removeEventListener('pointerup', release);
            window.removeEventListener('pointercancel', release);
            maskDragReleaseRef.current = null;
            useEditorStore.getState().setEditor({ isSliderDragging: false });
          };
          maskDragReleaseRef.current = release;
          window.addEventListener('pointerup', release);
          window.addEventListener('pointercancel', release);
        }
      } else if (maskDragReleaseRef.current) {
        maskDragReleaseRef.current();
      }
    }, []);
    useEffect(() => () => maskDragReleaseRef.current?.(), []);
    const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);
    const isDrawing = useRef(false);
    const drawingStageRef = useRef<any>(null);
    const dragStartPointer = useRef<Coord | null>(null);
    const lastBrushPoint = useRef<Coord | null>(null);
    const currentLine = useRef<DrawnLine | null>(null);
    const previewBoxRef = useRef<{ start: Coord; end: Coord } | null>(null);
    const [previewBox, setPreviewBox] = useState<{ start: Coord; end: Coord } | null>(null);
    const activeStrokeIndex = useRef<number | null>(null);

    const [cursorPreview, setCursorPreview] = useState<CursorPreview>({ x: 0, y: 0, visible: false });
    const [straightenLine, setStraightenLine] = useState<any>(null);
    const isStraightening = useRef(false);
    const [guidedDraft, setGuidedDraft] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
    const [guideLoupe, setGuideLoupe] = useState<{ sx: number; sy: number } | null>(null);
    const isGuidedDrawing = useRef(false);
    const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
    const guideImgRef = useRef<HTMLImageElement | null>(null);
    const guideLoupeSampleRef = useRef<{ x: number; y: number; stageW: number; stageH: number } | null>(null);

    const libraryIsRaw = useLibraryStore(
      (s) => s.imageList.find((i) => i.path === selectedImage.path)?.is_raw ?? false,
    );
    const libraryIsEdited = useLibraryStore(
      (s) => s.imageList.find((i) => i.path === selectedImage.path)?.is_edited ?? false,
    );
    const previewSrc = loupeImageSrc({
      previewUrl: finalPreviewUrl || undefined,
      thumbUrl: selectedImage.thumbnailUrl,
      isRaw: selectedImage.isRaw || libraryIsRaw,
      isEdited: libraryIsEdited,
    });

    const [displayState, setDisplayState] = useState({
      base: previewSrc,
      fade: null as string | null,
    });
    const prevImageIdentityRef = useRef(selectedImage.path);

    const [baseTool, setBaseTool] = useState<ToolType>(brushSettings?.tool ?? ToolType.Brush);
    const [isAltPressed, setIsAltPressed] = useState(false);
    const [isCtrlPressed, setIsCtrlPressed] = useState(false);
    const retainedPatchRef = useRef<typeof interactivePatch>(null);

    const holdPreviousFrame = useEditorStore((s) => s.holdPreviousFrame);
    const isWgpuActive =
      appSettings?.useWgpuRenderer !== false && ((selectedImage?.isReady && hasRenderedFirstFrame) || holdPreviousFrame);
    const { t } = useTranslation();
    const osPlatform = useOsPlatform();
    const modifierKey = osPlatform === 'macos' ? 'Cmd' : 'Ctrl';

    const manualCleanupStateRef = useRef({
      inFlight: false,
      pending: false,
      activeId: null as string | null,
      sourceX: 0,
      sourceY: 0,
    });

    const triggerManualCleanup = useCallback(
      async (activeId: string, sourceX: number, sourceY: number) => {
        if (!onManualCleanup) return;

        if (manualCleanupStateRef.current.inFlight) {
          manualCleanupStateRef.current.pending = true;
          manualCleanupStateRef.current.activeId = activeId;
          manualCleanupStateRef.current.sourceX = sourceX;
          manualCleanupStateRef.current.sourceY = sourceY;
          return;
        }

        manualCleanupStateRef.current.inFlight = true;
        manualCleanupStateRef.current.pending = false;

        try {
          await onManualCleanup(activeId, sourceX, sourceY);
        } finally {
          manualCleanupStateRef.current.inFlight = false;
          if (manualCleanupStateRef.current.pending && manualCleanupStateRef.current.activeId) {
            triggerManualCleanup(
              manualCleanupStateRef.current.activeId,
              manualCleanupStateRef.current.sourceX,
              manualCleanupStateRef.current.sourceY,
            );
          }
        }
      },
      [onManualCleanup],
    );

    const paddingX = imageRenderSize.width * 0.5;
    const paddingY = imageRenderSize.height * 0.5;

    const stageLeft = imageRenderSize.offsetX - paddingX;
    const stageTop = imageRenderSize.offsetY - paddingY;
    const stageWidth = imageRenderSize.width > 0 ? imageRenderSize.width + paddingX * 2 : 0;
    const stageHeight = imageRenderSize.height > 0 ? imageRenderSize.height + paddingY * 2 : 0;

    const groupOffsetX = paddingX;
    const groupOffsetY = paddingY;

    const [settledScale, setSettledScale] = useState(transformState.scale);
    useEffect(() => {
      const timer = setTimeout(() => {
        setSettledScale(transformState.scale);
      }, 150);
      return () => clearTimeout(timer);
    }, [transformState.scale]);

    const maxDimension = Math.max(stageWidth, stageHeight, 1);
    const maxSafeScale = Math.max(1, Math.min(settledScale, 4092 / maxDimension));

    const getCanvasPointer = useCallback(
      (stage: any) => {
        const pos = stage.getPointerPosition();
        if (!pos) return null;
        return {
          x: pos.x / maxSafeScale - groupOffsetX,
          y: pos.y / maxSafeScale - groupOffsetY,
        };
      },
      [groupOffsetX, groupOffsetY, maxSafeScale],
    );

    useEffect(() => {
      if (interactivePatch) {
        retainedPatchRef.current = interactivePatch;
      }
    }, [interactivePatch]);

    useEffect(() => {
      const newSrc = previewSrc;
      const isNewImage = prevImageIdentityRef.current !== selectedImage.path;

      if (isNewImage) {
        prevImageIdentityRef.current = selectedImage.path;
        setDisplayState({ base: newSrc, fade: null });
        return;
      }

      // No crossfade: the new source is stacked over the old one at full opacity
      // until it has decoded, then promoted to base, so it swaps without a flash.
      if (isSliderDragging || !displayState.base || displayState.base === newSrc) {
        setDisplayState({ base: newSrc, fade: null });
        return;
      }
      setDisplayState((prev) => ({ base: prev.base, fade: newSrc ?? null }));
      const timer = setTimeout(() => setDisplayState({ base: newSrc, fade: null }), 150);
      return () => clearTimeout(timer);
    }, [previewSrc, selectedImage.path, isSliderDragging]);

    useEffect(() => {
      setBaseTool(brushSettings?.tool ?? ToolType.Brush);
    }, [brushSettings?.tool]);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Alt') {
          e.preventDefault();
          (window as any).altKeyDown = true;
          setIsAltPressed(true);
        }
        if (e.key === 'Control' || e.key === 'Meta') {
          (window as any).ctrlKeyDown = true;
          setIsCtrlPressed(true);
        }
      };
      const handleKeyUp = (e: KeyboardEvent) => {
        if (e.key === 'Alt') {
          e.preventDefault();
          (window as any).altKeyDown = false;
          setIsAltPressed(false);
        }
        if (e.key === 'Control' || e.key === 'Meta') {
          (window as any).ctrlKeyDown = false;
          setIsCtrlPressed(false);
        }
      };
      const handleBlur = () => {
        (window as any).altKeyDown = false;
        setIsAltPressed(false);
        (window as any).ctrlKeyDown = false;
        setIsCtrlPressed(false);
      };

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      window.addEventListener('blur', handleBlur);

      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        window.removeEventListener('blur', handleBlur);
        (window as any).altKeyDown = false;
        (window as any).ctrlKeyDown = false;
      };
    }, []);

    const activeContainer = useMemo(() => {
      if (isMasking) {
        return adjustments.masks.find((c: MaskContainer) => c.id === activeMaskContainerId);
      }
      if (isAiEditing) {
        return adjustments.aiPatches.find((p: AiPatch) => p.id === activeAiPatchContainerId);
      }
      return null;
    }, [
      adjustments.masks,
      adjustments.aiPatches,
      activeMaskContainerId,
      activeAiPatchContainerId,
      isMasking,
      isAiEditing,
    ]);

    const activeSubMask = useMemo(() => {
      if (!activeContainer) {
        return null;
      }
      if (isMasking) {
        return activeContainer.subMasks.find((m: SubMask) => m.id === activeMaskId);
      }
      if (isAiEditing) {
        return activeContainer.subMasks.find((m: SubMask) => m.id === activeAiSubMaskId);
      }
      return null;
    }, [activeContainer, activeMaskId, activeAiSubMaskId, isMasking, isAiEditing]);

    const effectiveImageDimensions = useMemo(() => {
      const steps = adjustments.orientationSteps || 0;
      const w = selectedImage.width || 0;
      const h = selectedImage.height || 0;
      if (steps === 1 || steps === 3) {
        return { width: h, height: w };
      }
      return { width: w, height: h };
    }, [selectedImage.width, selectedImage.height, adjustments.orientationSteps]);

    const activeCrop = adjustments.crop;
    const isPercentCrop = activeCrop?.unit === '%';
    const cropX = activeCrop
      ? isPercentCrop
        ? (activeCrop.x / 100) * effectiveImageDimensions.width
        : activeCrop.x
      : 0;
    const cropY = activeCrop
      ? isPercentCrop
        ? (activeCrop.y / 100) * effectiveImageDimensions.height
        : activeCrop.y
      : 0;

    const scaleX = imageRenderSize.scaleX || imageRenderSize.scale || 1;
    const scaleY = imageRenderSize.scaleY || imageRenderSize.scale || 1;
    const effectiveZoomScale = transformState.scale > 0 ? transformState.scale : 1;
    const brushStageSize = (brushSettings?.size ?? 0) / effectiveZoomScale;
    const brushImageSpaceSize = brushStageSize / (scaleY || 1);

    const isBrushActive =
      (isMasking || isAiEditing) &&
      (activeSubMask?.type === Mask.Brush ||
        activeSubMask?.type === Mask.Flow ||
        activeSubMask?.type === Mask.Clone ||
        activeSubMask?.type === Mask.Heal);
    const isManualCleanupActive =
      isAiEditing && (activeSubMask?.type === Mask.Clone || activeSubMask?.type === Mask.Heal);

    const isCloneOrHealActive =
      (isMasking || isAiEditing) && (activeSubMask?.type === Mask.Clone || activeSubMask?.type === Mask.Heal);

    const activeLineFlow = activeSubMask?.type === Mask.Flow ? (activeSubMask?.parameters?.flow ?? 10) : undefined;

    const brushCursorPreview = useMemo(() => {
      const radius = Math.max(0.1, brushStageSize / 2);
      const feather = Math.max(0, Math.min(1, (brushSettings?.feather ?? 0) / 100));
      const subMaskOpacity = Math.max(0, Math.min(1, (activeSubMask?.opacity ?? 100) / 100));
      const containerOpacity =
        activeContainer && 'opacity' in activeContainer && typeof activeContainer.opacity === 'number'
          ? Math.max(0, Math.min(1, activeContainer.opacity / 100))
          : 1;
      const flowOpacity =
        activeSubMask?.type === Mask.Flow ? Math.max(0, Math.min(1, (activeSubMask.parameters?.flow ?? 10) / 100)) : 1;
      const alpha = Math.max(0, Math.min(0.5, 0.5 * subMaskOpacity * containerOpacity * flowOpacity));

      const isEraser = isAltPressed ? baseTool !== ToolType.Eraser : baseTool === ToolType.Eraser;

      const strokeColor = isEraser
        ? (a: number) => `rgba(244, 63, 94, ${a.toFixed(3)})`
        : (a: number) => `rgba(14, 165, 233, ${a.toFixed(3)})`;

      if (feather <= 0.001) {
        return {
          fill: strokeColor(alpha),
          radius,
        };
      }

      const innerStop = 1 - feather;
      const colorStops: Array<number | string> = [0, strokeColor(alpha)];

      if (innerStop > 0.001) {
        colorStops.push(innerStop, strokeColor(alpha));
      }

      for (const t of [0.25, 0.5, 0.75, 1]) {
        const smoothstep = t * t * (3 - 2 * t);
        const intensity = 1 - smoothstep;
        colorStops.push(Math.min(1, innerStop + feather * t), strokeColor(alpha * intensity));
      }

      return {
        colorStops,
        radius,
      };
    }, [
      activeContainer,
      activeSubMask?.opacity,
      activeSubMask?.parameters?.flow,
      activeSubMask?.type,
      brushSettings?.feather,
      brushStageSize,
      baseTool,
      isAltPressed,
    ]);

    const isAiSubjectActive =
      (isMasking || isAiEditing) &&
      (activeSubMask?.type === Mask.AiSubject || activeSubMask?.type === Mask.QuickEraser);
    const isParametricActive = (isMasking || isAiEditing) && activeSubMask?.type === Mask.Color;
    const isInitialDrawing = (isMasking || isAiEditing) && activeSubMask?.parameters?.isInitialDraw === true;

    const isToolActive = isBrushActive || isAiSubjectActive || isInitialDrawing || isParametricActive;

    useEffect(() => {
      if (maskOverlay && (isMasking || isAiEditing)) {
        setDisplayedMask(maskOverlay);
      } else {
        setDisplayedMask(null);
      }
    }, [maskOverlay, isMasking, isAiEditing]);

    useEffect(() => {
      if (isToolActive) {
        return;
      }
      isDrawing.current = false;
      drawingStageRef.current = null;
      dragStartPointer.current = null;
      currentLine.current = null;
      lastBrushPoint.current = null;
      setPreviewBox(null);
      previewBoxRef.current = null;
      setLocalInitialDrawParams(null);
    }, [isToolActive]);

    useEffect(() => {
      if (!isMasking && !isAiEditing) {
        setIsMaskInteractionActive(false);
      }
    }, [isMasking, isAiEditing]);

    useEffect(() => {
      const clearTouchInteraction = () => {
        setIsMaskTouchInteracting(false);
      };

      window.addEventListener('touchend', clearTouchInteraction);
      window.addEventListener('touchcancel', clearTouchInteraction);

      return () => {
        window.removeEventListener('touchend', clearTouchInteraction);
        window.removeEventListener('touchcancel', clearTouchInteraction);
      };
    }, [setIsMaskTouchInteracting]);

    const sortedSubMasks = useMemo(() => {
      if (!activeContainer) {
        return [];
      }
      const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
      const selectedMask = activeContainer.subMasks.find((m: SubMask) => m.id === activeId);
      const otherMasks = activeContainer.subMasks.filter((m: SubMask) => m.id !== activeId);
      return selectedMask ? [...otherMasks, selectedMask] : activeContainer.subMasks;
    }, [activeContainer, activeMaskId, activeAiSubMaskId, isMasking, isAiEditing]);

    const cloneHealMarkers = useMemo(() => {
      const markers: any[] = [];
      if (!adjustments.aiPatches && !adjustments.masks) return markers;

      const processContainers = (containers: any[], isAi: boolean) => {
        containers.forEach((container) => {
          container.subMasks.forEach((sm: SubMask) => {
            if (sm.type !== Mask.Clone && sm.type !== Mask.Heal) return;
            const lines = sm.parameters?.lines || [];
            if (lines.length === 0) return;

            let minX = Infinity,
              minY = Infinity,
              maxX = -Infinity,
              maxY = -Infinity;
            for (const line of lines) {
              for (const pt of line.points) {
                if (pt.x < minX) minX = pt.x;
                if (pt.x > maxX) maxX = pt.x;
                if (pt.y < minY) minY = pt.y;
                if (pt.y > maxY) maxY = pt.y;
              }
            }
            if (minX === Infinity) return;

            const drawingCenterX = (minX + maxX) / 2;
            const drawingCenterY = (minY + maxY) / 2;

            const sourceX = sm.parameters?.sourceX;
            const sourceY = sm.parameters?.sourceY;

            let cx = drawingCenterX;
            let cy = drawingCenterY;

            if (sourceX !== undefined && sourceY !== undefined) {
              cx = (drawingCenterX + sourceX) / 2;
              cy = (drawingCenterY + sourceY) / 2;
            }

            markers.push({
              id: sm.id,
              containerId: container.id,
              type: sm.type,
              cx,
              cy,
              isAi,
            });
          });
        });
      };

      if (isAiEditing && adjustments.aiPatches) processContainers(adjustments.aiPatches, true);
      if (isMasking && adjustments.masks) processContainers(adjustments.masks, false);

      return markers;
    }, [adjustments, isAiEditing, isMasking]);

    useEffect(() => {
      if (isCropping && uncroppedAdjustedPreviewUrl) {
        const timer = setTimeout(() => setIsCropViewVisible(true), 10);
        return () => clearTimeout(timer);
      } else {
        setIsCropViewVisible(false);
      }
    }, [isCropping, uncroppedAdjustedPreviewUrl]);

    const handleWbClick = useCallback(
      (e: any) => {
        if (!isWbPickerActive || !finalPreviewUrl || !onWbPicked) return;

        const stage = e.target.getStage();
        const pointerPos = getCanvasPointer(stage);
        if (!pointerPos) return;

        const x = pointerPos.x / scaleX;
        const y = pointerPos.y / scaleY;

        const imgLogicalWidth = imageRenderSize.width / scaleX;
        const imgLogicalHeight = imageRenderSize.height / scaleY;

        if (x < 0 || x > imgLogicalWidth || y < 0 || y > imgLogicalHeight) return;

        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = finalPreviewUrl;

        img.onload = () => {
          const radius = 5;
          const side = radius * 2 + 1;

          const canvas = document.createElement('canvas');
          canvas.width = side;
          canvas.height = side;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;

          const scaleX = img.width / imgLogicalWidth;
          const scaleY = img.height / imgLogicalHeight;
          const srcX = Math.floor(x * scaleX);
          const srcY = Math.floor(y * scaleY);

          const startX = Math.max(0, srcX - radius);
          const startY = Math.max(0, srcY - radius);
          const endX = Math.min(img.width, srcX + radius + 1);
          const endY = Math.min(img.height, srcY + radius + 1);
          const sw = endX - startX;
          const sh = endY - startY;

          if (sw <= 0 || sh <= 0) return;

          ctx.drawImage(img, startX, startY, sw, sh, 0, 0, sw, sh);

          const imageData = ctx.getImageData(0, 0, sw, sh);
          const data = imageData.data;

          let rTotal = 0,
            gTotal = 0,
            bTotal = 0;
          let count = 0;

          for (let i = 0; i < data.length; i += 4) {
            rTotal += data[i];
            gTotal += data[i + 1];
            bTotal += data[i + 2];
            count++;
          }

          if (count === 0) return;

          const avgR = rTotal / count;
          const avgG = gTotal / count;
          const avgB = bTotal / count;

          const linR = Math.pow(avgR / 255.0, 2.2);
          const linG = Math.pow(avgG / 255.0, 2.2);
          const linB = Math.pow(avgB / 255.0, 2.2);

          const sumRB = linR + linB;
          const deltaTemp = sumRB > 0.0001 ? ((linB - linR) / sumRB) * 125.0 : 0;

          const linM = sumRB / 2.0;
          const sumGM = linG + linM;
          const deltaTint = sumGM > 0.0001 ? ((linG - linM) / sumGM) * 400.0 : 0;

          setAdjustments((prev: Adjustments) => ({
            ...prev,
            temperature: Math.max(-100, Math.min(100, (prev.temperature || 0) + deltaTemp)),
            tint: Math.max(-100, Math.min(100, (prev.tint || 0) + deltaTint)),
          }));

          onWbPicked();
        };
      },
      [isWbPickerActive, finalPreviewUrl, imageRenderSize, onWbPicked, setAdjustments, getCanvasPointer],
    );

    const handlePointColorClick = useCallback(
      (e: any) => {
        if (!isPointColorPickerActive || !finalPreviewUrl || !onPointColorPicked) return;

        const stage = e.target.getStage();
        const pointerPos = getCanvasPointer(stage);
        if (!pointerPos) return;

        const x = pointerPos.x / scaleX;
        const y = pointerPos.y / scaleY;

        const imgLogicalWidth = imageRenderSize.width / scaleX;
        const imgLogicalHeight = imageRenderSize.height / scaleY;

        if (x < 0 || x > imgLogicalWidth || y < 0 || y > imgLogicalHeight) return;

        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = finalPreviewUrl;

        img.onload = () => {
          const radius = 4;
          const canvas = document.createElement('canvas');
          const side = radius * 2 + 1;
          canvas.width = side;
          canvas.height = side;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;

          const scaleX = img.width / imgLogicalWidth;
          const scaleY = img.height / imgLogicalHeight;
          const srcX = Math.floor(x * scaleX);
          const srcY = Math.floor(y * scaleY);

          const startX = Math.max(0, srcX - radius);
          const startY = Math.max(0, srcY - radius);
          const endX = Math.min(img.width, srcX + radius + 1);
          const endY = Math.min(img.height, srcY + radius + 1);
          const sw = endX - startX;
          const sh = endY - startY;
          if (sw <= 0 || sh <= 0) return;

          ctx.drawImage(img, startX, startY, sw, sh, 0, 0, sw, sh);
          const data = ctx.getImageData(0, 0, sw, sh).data;
          let rTotal = 0,
            gTotal = 0,
            bTotal = 0,
            count = 0;
          for (let i = 0; i < data.length; i += 4) {
            rTotal += data[i];
            gTotal += data[i + 1];
            bTotal += data[i + 2];
            count++;
          }
          if (count === 0) return;
          const r = rTotal / count / 255;
          const g = gTotal / count / 255;
          const b = bTotal / count / 255;
          // RGB → HSL (H in -1..1 for LR-ish storage, S/L 0..1)
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const l = (max + min) / 2;
          let h = 0;
          let s = 0;
          if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
              case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                break;
              case g:
                h = ((b - r) / d + 2) / 6;
                break;
              default:
                h = ((r - g) / d + 4) / 6;
                break;
            }
          }
          // Map H 0..1 → -1..1 for row storage used by XMP PointColors
          const srcH = h * 2 - 1;
          const srcS = s;
          const srcL = l;

          setAdjustments((prev: Adjustments) => {
            const rows = Array.isArray((prev as any).pointColors) ? [...(prev as any).pointColors] : [];
            rows.push([srcH, srcS, srcL, 0, 0]);
            const variance = Array.isArray((prev as any).colorVariance)
              ? [...(prev as any).colorVariance]
              : [];
            variance.push(0);
            return { ...prev, pointColors: rows, colorVariance: variance } as Adjustments;
          });

          onPointColorPicked();
        };
      },
      [
        isPointColorPickerActive,
        finalPreviewUrl,
        imageRenderSize,
        onPointColorPicked,
        setAdjustments,
        getCanvasPointer,
      ],
    );


    const handleStart = useCallback(
      (e: any) => {
        if (e.evt && typeof e.evt.button === 'number' && e.evt.button !== 0) {
          return;
        }

        if (e.evt && e.evt.cancelable) e.evt.preventDefault();

        if (isWbPickerActive) {
          handleWbClick(e);
          return;
        }
        if (isPointColorPickerActive) {
          handlePointColorClick(e);
          return;
        }

        if (isParametricActive && activeSubMask) {
          const pos = getCanvasPointer(e.target.getStage());
          if (!pos) return;

          const x = pos.x / scaleX + cropX;
          const y = pos.y / scaleY + cropY;

          let newParams = { ...activeSubMask.parameters };
          const samples: Array<{ x: number; y: number }> = Array.isArray(newParams.samples)
            ? [...newParams.samples]
            : (Number.isFinite(newParams.targetX) && newParams.targetX >= 0 && Number.isFinite(newParams.targetY) && newParams.targetY >= 0
                ? [{ x: Number(newParams.targetX), y: Number(newParams.targetY) }]
                : []);
          if (e.evt?.altKey) {
            let closestIndex = -1;
            let closestDistance = 20 / Math.max(scaleX, 0.001);
            samples.forEach((sample, index) => {
              const distance = Math.hypot(sample.x - x, sample.y - y);
              if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
              }
            });
            if (closestIndex >= 0) samples.splice(closestIndex, 1);
          } else if (e.evt?.shiftKey) {
            if (samples.length < 5) samples.push({ x, y });
          } else {
            samples.splice(0, samples.length, { x, y });
          }
          newParams.samples = samples.slice(0, 5);
          if (samples.length > 0) {
            const activeSample = samples[samples.length - 1];
            newParams.targetX = activeSample.x;
            newParams.targetY = activeSample.y;
          } else {
            newParams.targetX = -10000;
            newParams.targetY = -10000;
          }
          newParams.rotation = adjustments.rotation || 0;
          newParams.flipHorizontal = adjustments.flipHorizontal || false;
          newParams.flipVertical = adjustments.flipVertical || false;
          newParams.orientationSteps = adjustments.orientationSteps || 0;
          delete newParams.isInitialDraw;

          const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
          updateSubMask(activeId, { parameters: newParams });
          return;
        }

        if (isInitialDrawing && activeSubMask) {
          isDrawing.current = true;
          drawingStageRef.current = e.target.getStage();
          const pos = getCanvasPointer(e.target.getStage());
          if (!pos) return;

          const x = pos.x / scaleX + cropX;
          const y = pos.y / scaleY + cropY;

          dragStartPointer.current = { x, y };

          let initialParams = { ...activeSubMask.parameters };

          if (activeSubMask.type === Mask.Radial) {
            initialParams = {
              ...initialParams,
              centerX: x,
              centerY: y,
              radiusX: 0,
              radiusY: 0,
              rotation: 0,
            };
          } else if (activeSubMask.type === Mask.Linear) {
            initialParams = {
              ...initialParams,
              startX: x,
              startY: y,
              endX: x,
              endY: y,
              range: 0,
            };
          }

          setLocalInitialDrawParams(initialParams);
          return;
        }

        if (isManualCleanupActive && activeSubMask) {
          const isCtrlPressedLocal = e.evt.ctrlKey || e.evt.metaKey || (window as any).ctrlKeyDown;
          if (isCtrlPressedLocal || activeSubMask.parameters?.sourceX === undefined) {
            const pos = getCanvasPointer(e.target.getStage());
            if (!pos) return;

            const x = pos.x / scaleX + cropX;
            const y = pos.y / scaleY + cropY;

            const activeId = activeAiSubMaskId;
            if (activeId) {
              updateSubMask(activeId, {
                parameters: { ...activeSubMask.parameters, sourceX: x, sourceY: y },
              });

              if (onManualCleanup && activeSubMask.parameters?.lines?.length > 0) {
                onManualCleanup(activeId, x, y);
              }
            }

            if (e.evt && e.evt.cancelable) e.evt.preventDefault();
            return;
          }
        }

        if (isToolActive) {
          const stage = e.target.getStage();
          const pos = getCanvasPointer(stage);
          if (!pos) {
            isDrawing.current = false;
            currentLine.current = null;
            setPreviewBox(null);
            previewBoxRef.current = null;
            setIsMaskInteractionActive(false);
            return;
          }

          if (isAiSubjectActive) {
            isDrawing.current = true;
            drawingStageRef.current = stage;
            const newBox = { start: pos, end: pos };
            previewBoxRef.current = newBox;
            setPreviewBox(newBox);
            setIsMaskInteractionActive(true);
            return;
          }

          const isAltPressed = e.evt.altKey || (window as any).altKeyDown;
          let effectiveTool;

          if (isAiSubjectActive) {
            effectiveTool = ToolType.AiSeletor;
          } else if (isAltPressed) {
            effectiveTool = baseTool === ToolType.Brush ? ToolType.Eraser : ToolType.Brush;
          } else {
            effectiveTool = baseTool;
          }
          const isShiftClick = isBrushActive && e.evt.shiftKey && lastBrushPoint.current;

          if (isShiftClick) {
            const startImageSpace = lastBrushPoint.current!;
            const endImageSpace = {
              x: pos.x / scaleX + cropX,
              y: pos.y / scaleY + cropY,
            };

            const dx = endImageSpace.x - startImageSpace.x;
            const dy = endImageSpace.y - startImageSpace.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const steps = Math.max(Math.ceil(distance), 2);
            const interpolatedPoints: Coord[] = [];
            for (let i = 0; i <= steps; i++) {
              const t = i / steps;
              interpolatedPoints.push({
                x: startImageSpace.x + dx * t,
                y: startImageSpace.y + dy * t,
              });
            }

            const imageSpaceLine: DrawnLine = {
              brushSize: brushImageSpaceSize,
              feather: brushSettings?.feather ? brushSettings?.feather / 100 : 0,
              flow: activeLineFlow,
              points: interpolatedPoints,
              tool: effectiveTool,
            };

            const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
            const existingLines = activeSubMask?.parameters?.lines || [];

            updateSubMask(activeId, {
              parameters: {
                ...activeSubMask?.parameters,
                lines: [...existingLines, imageSpaceLine],
              },
            });

            lastBrushPoint.current = endImageSpace;
            isDrawing.current = false;
            currentLine.current = null;
            return;
          }

          isDrawing.current = true;
          activeStrokeIndex.current = null;
          drawingStageRef.current = stage;

          if (isManualCleanupActive) {
            setIsMaskInteractionActive(true);
          }

          const newLine: DrawnLine = {
            brushSize: isBrushActive && brushSettings?.size ? brushStageSize : 2,
            points: [pos],
            tool: effectiveTool,
          };
          currentLine.current = newLine;
        } else {
          if (e.target === e.target.getStage()) {
            if (isMasking) {
              onSelectMask(null);
            }
            if (isAiEditing) {
              onSelectAiSubMask(null);
            }
          }
        }
      },
      [
        isWbPickerActive,
        isPointColorPickerActive,
        handleWbClick,
        handlePointColorClick,
        isInitialDrawing,
        isBrushActive,
        isManualCleanupActive,
        activeLineFlow,
        isAiSubjectActive,
        isParametricActive,
        brushSettings,
        onSelectMask,
        onSelectAiSubMask,
        isMasking,
        isAiEditing,
        imageRenderSize,
        adjustments,
        activeMaskId,
        activeAiSubMaskId,
        activeSubMask,
        updateSubMask,
        cropX,
        cropY,
        isToolActive,
        brushImageSpaceSize,
        brushStageSize,
        baseTool,
        getCanvasPointer,
      ],
    );

    const handleMove = useCallback(
      (e: any) => {
        if (isWbPickerActive) {
          return;
        }

        let pos;
        if (e && typeof e.target?.getStage === 'function') {
          const stage = e.target.getStage();
          pos = getCanvasPointer(stage);
        } else if (e && (e.clientX != null || (e.touches && e.touches[0]))) {
          const stage = drawingStageRef.current;
          if (stage) {
            stage.setPointersPositions(e);
            pos = getCanvasPointer(stage);
          }
        }

        if (isToolActive) {
          if (pos) {
            setCursorPreview({ x: pos.x, y: pos.y, visible: true });
          } else {
            setCursorPreview((p: CursorPreview) => ({ ...p, visible: false }));
          }
        }

        if (!isDrawing.current || !isToolActive) {
          return;
        }

        if (isAiSubjectActive && previewBoxRef.current && pos) {
          const updatedBox = { ...previewBoxRef.current, end: pos };
          previewBoxRef.current = updatedBox;
          setPreviewBox(updatedBox);
          if (e.evt && e.evt.cancelable) e.evt.preventDefault();
          return;
        }

        if (isInitialDrawing && dragStartPointer.current && activeSubMask && localInitialDrawParams) {
          const stage =
            drawingStageRef.current || (e && typeof e.target?.getStage === 'function' ? e.target.getStage() : null);
          if (!stage) return;
          const pointerPos = getCanvasPointer(stage);
          if (!pointerPos) return;

          const x = pointerPos.x / scaleX + cropX;
          const y = pointerPos.y / scaleY + cropY;

          const distX = x - dragStartPointer.current.x;
          const distY = y - dragStartPointer.current.y;
          const screenThreshold = 15;
          if (Math.sqrt(distX * distX + distY * distY) < screenThreshold / scaleX) {
            return;
          }

          let updatedParams = { ...localInitialDrawParams };

          if (activeSubMask.type === Mask.Radial) {
            updatedParams.radiusX = Math.max(1, Math.abs(x - dragStartPointer.current.x));
            updatedParams.radiusY = Math.max(1, Math.abs(y - dragStartPointer.current.y));
          } else if (activeSubMask.type === Mask.Linear) {
            const dx = x - dragStartPointer.current.x;
            const dy = y - dragStartPointer.current.y;
            const R = Math.max(1, Math.sqrt(dx * dx + dy * dy));

            const px = -dy / R;
            const py = dx / R;
            const handleDist = Math.min(effectiveImageDimensions.width, effectiveImageDimensions.height) * 0.2;

            updatedParams.startX = dragStartPointer.current.x + px * handleDist;
            updatedParams.startY = dragStartPointer.current.y + py * handleDist;
            updatedParams.endX = dragStartPointer.current.x - px * handleDist;
            updatedParams.endY = dragStartPointer.current.y - py * handleDist;
            updatedParams.range = R;
          }

          setLocalInitialDrawParams(updatedParams);

          if (onLiveMaskPreview && activeContainer && activeSubMask) {
            const previewSubMask = {
              ...activeSubMask,
              parameters: updatedParams,
            };
            const previewContainer = {
              ...activeContainer,
              subMasks: activeContainer.subMasks.map((sm: SubMask) =>
                sm.id === activeSubMask.id ? previewSubMask : sm,
              ),
            };
            onLiveMaskPreview(previewContainer);
          }

          const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
          if (activeId) {
            updateSubMask(activeId, { parameters: updatedParams });
          }

          if (e.evt && e.evt.cancelable) e.evt.preventDefault();
          return;
        }

        if (!pos) {
          return;
        }

        if (currentLine.current) {
          const lastPoint = currentLine.current.points[currentLine.current.points.length - 1];
          if (lastPoint) {
            const dx = pos.x - lastPoint.x;
            const dy = pos.y - lastPoint.y;
            if (dx * dx + dy * dy < 4) {
              if (e.evt && e.evt.cancelable) e.evt.preventDefault();
              return;
            }
          }

          const updatedLine = {
            ...currentLine.current,
            points: [...currentLine.current.points, pos],
          };
          currentLine.current = updatedLine;

          const activeId = isMasking ? activeMaskId : activeAiSubMaskId;

          if (isManualCleanupActive && activeId) {
            const imageSpaceLine: DrawnLine = {
              brushSize: brushImageSpaceSize,
              feather: brushSettings?.feather ? brushSettings?.feather / 100 : 0,
              flow: activeLineFlow,
              points: updatedLine.points.map((p: Coord) => ({
                x: p.x / scaleX + cropX,
                y: p.y / scaleY + cropY,
              })),
              tool: updatedLine.tool,
            };

            const existingLines = activeSubMask?.parameters?.lines ? [...activeSubMask.parameters.lines] : [];

            if (activeStrokeIndex.current !== null) {
              existingLines[activeStrokeIndex.current] = imageSpaceLine;
            } else {
              activeStrokeIndex.current = existingLines.length;
              existingLines.push(imageSpaceLine);
            }

            updateSubMask(activeId, {
              parameters: {
                ...activeSubMask?.parameters,
                lines: existingLines,
              },
            });

            const sourceX = activeSubMask?.parameters.sourceX;
            const sourceY = activeSubMask?.parameters.sourceY;
            if (sourceX !== undefined && sourceY !== undefined) {
              triggerManualCleanup(activeId, sourceX, sourceY);
            }
          } else if (onLiveMaskPreview && activeContainer && activeSubMask && isBrushActive) {
            const imageSpaceLine: DrawnLine = {
              brushSize: brushImageSpaceSize,
              feather: brushSettings?.feather ? brushSettings?.feather / 100 : 0,
              flow: activeLineFlow,
              points: updatedLine.points.map((p: Coord) => ({
                x: p.x / scaleX + cropX,
                y: p.y / scaleY + cropY,
              })),
              tool: updatedLine.tool,
            };

            const existingLines = activeSubMask.parameters?.lines || [];
            const previewSubMask = {
              ...activeSubMask,
              parameters: {
                ...activeSubMask.parameters,
                lines: [...existingLines, imageSpaceLine],
              },
            };

            const previewContainer = {
              ...activeContainer,
              subMasks: activeContainer.subMasks.map((sm: SubMask) =>
                sm.id === activeSubMask.id ? previewSubMask : sm,
              ),
            };

            onLiveMaskPreview(previewContainer);
          }
          if (e.evt && e.evt.cancelable) e.evt.preventDefault();
        }
      },
      [
        isToolActive,
        isWbPickerActive,
        isInitialDrawing,
        activeMaskId,
        activeAiSubMaskId,
        updateSubMask,
        onLiveMaskPreview,
        activeContainer,
        activeSubMask,
        isBrushActive,
        isManualCleanupActive,
        onManualCleanup,
        activeLineFlow,
        isAiSubjectActive,
        imageRenderSize,
        cropX,
        cropY,
        effectiveImageDimensions,
        brushSettings,
        isMasking,
        localInitialDrawParams,
        brushImageSpaceSize,
        baseTool,
        getCanvasPointer,
      ],
    );

    const handleUp = useCallback(() => {
      if (!isDrawing.current) {
        return;
      }

      setIsMaskInteractionActive(false);

      if (isInitialDrawing && activeSubMask) {
        isDrawing.current = false;
        const activeId = isMasking ? activeMaskId : activeAiSubMaskId;

        const newParams = { ...localInitialDrawParams };
        delete newParams.isInitialDraw;

        if (activeSubMask.type === Mask.Radial && newParams.radiusX < 10 && newParams.radiusY < 10) {
          newParams.radiusX = 100;
          newParams.radiusY = 100;
        } else if (activeSubMask.type === Mask.Linear) {
          if (!newParams.range || newParams.range < 10) {
            const handleDist = Math.min(effectiveImageDimensions.width, effectiveImageDimensions.height) * 0.2;
            newParams.startX = dragStartPointer.current!.x + handleDist;
            newParams.startY = dragStartPointer.current!.y;
            newParams.endX = dragStartPointer.current!.x - handleDist;
            newParams.endY = dragStartPointer.current!.y;
            newParams.range = 100;
          }
        }

        updateSubMask(activeId, { parameters: newParams });
        setLocalInitialDrawParams(null);
        dragStartPointer.current = null;
        return;
      }

      if (!currentLine.current && !(isAiSubjectActive && previewBoxRef.current)) {
        return;
      }

      if (isAiSubjectActive && previewBoxRef.current) {
        const wasDrawing = isDrawing.current;
        isDrawing.current = false;
        const box = previewBoxRef.current;
        previewBoxRef.current = null;
        setPreviewBox(null);
        drawingStageRef.current = null;

        if (!wasDrawing || !box) {
          return;
        }

        const activeId = isMasking ? activeMaskId : activeAiSubMaskId;

        let startPoint = { x: box.start.x / scaleX + cropX, y: box.start.y / scaleY + cropY };
        let endPoint = { x: box.end.x / scaleX + cropX, y: box.end.y / scaleY + cropY };

        const dx = box.end.x - box.start.x;
        const dy = box.end.y - box.start.y;
        if (Math.sqrt(dx * dx + dy * dy) < 5) {
          endPoint = { x: startPoint.x, y: startPoint.y };
        }

        if (activeId) {
          updateSubMask(activeId, {
            parameters: {
              ...activeSubMask?.parameters,
              startX: startPoint.x,
              startY: startPoint.y,
              endX: endPoint.x,
              endY: endPoint.y,
            },
          });
        }

        if (activeSubMask?.type === Mask.QuickEraser && onQuickErase) {
          onQuickErase(activeId, startPoint, endPoint);
        } else if (activeSubMask?.type === Mask.AiSubject && onGenerateAiMask) {
          onGenerateAiMask(activeId, startPoint, endPoint);
        }
        return;
      }

      const wasDrawing = isDrawing.current;
      isDrawing.current = false;
      const line = currentLine.current;
      currentLine.current = null;
      drawingStageRef.current = null;

      if (!wasDrawing || !line) {
        return;
      }

      const activeId = isMasking ? activeMaskId : activeAiSubMaskId;

      if (isBrushActive) {
        const imageSpaceLine: DrawnLine = {
          brushSize: brushImageSpaceSize,
          feather: brushSettings?.feather ? brushSettings?.feather / 100 : 0,
          flow: activeLineFlow,
          points: line.points.map((p: Coord) => ({
            x: p.x / scaleX + cropX,
            y: p.y / scaleY + cropY,
          })),
          tool: line.tool,
        };

        const existingLines = activeSubMask?.parameters?.lines ? [...activeSubMask.parameters.lines] : [];

        if (activeStrokeIndex.current !== null) {
          existingLines[activeStrokeIndex.current] = imageSpaceLine;
        } else {
          existingLines.push(imageSpaceLine);
        }

        updateSubMask(activeId, {
          parameters: {
            ...activeSubMask?.parameters,
            lines: existingLines,
          },
        });

        activeStrokeIndex.current = null;

        const lastPoint = line.points[line.points.length - 1];
        if (lastPoint) {
          lastBrushPoint.current = {
            x: lastPoint.x / scaleX + cropX,
            y: lastPoint.y / scaleY + cropY,
          };
        }

        if (isManualCleanupActive && activeId) {
          const sourceX = activeSubMask?.parameters.sourceX;
          const sourceY = activeSubMask?.parameters.sourceY;
          if (sourceX !== undefined && sourceY !== undefined) {
            triggerManualCleanup(activeId, sourceX, sourceY);
          }
        }
      }
    }, [
      isInitialDrawing,
      activeAiSubMaskId,
      activeMaskId,
      activeSubMask,
      cropX,
      cropY,
      brushSettings,
      imageRenderSize.scale,
      isAiEditing,
      isBrushActive,
      isManualCleanupActive,
      triggerManualCleanup,
      activeLineFlow,
      isMasking,
      onGenerateAiMask,
      onQuickErase,
      updateSubMask,
      effectiveImageDimensions,
      localInitialDrawParams,
      brushImageSpaceSize,
      brushStageSize,
      baseTool,
    ]);

    // Pointer moves reach handleMove from the stage and, while drawing, from window too:
    // several times per frame, each re-rendering the canvas (cursor preview, shape being
    // placed). Process the latest move once per frame; preventDefault stays synchronous.
    const handleMoveRef = useRef(handleMove);
    handleMoveRef.current = handleMove;
    const pendingMoveRef = useRef<any>(null);
    const moveFrameRef = useRef<number | null>(null);
    const scheduleMove = useCallback((e: any) => {
      const native = e?.evt ?? e;
      if (isDrawing.current && native?.cancelable) native.preventDefault();
      pendingMoveRef.current = e;
      if (moveFrameRef.current !== null) return;
      moveFrameRef.current = requestAnimationFrame(() => {
        moveFrameRef.current = null;
        const latest = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (latest) handleMoveRef.current(latest);
      });
    }, []);
    useEffect(() => () => {
      if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current);
    }, []);

    const handleMouseEnter = useCallback(() => {
      if (isToolActive) {
        setCursorPreview((p: CursorPreview) => ({ ...p, visible: true }));
      }
    }, [isToolActive]);

    const handleMouseLeave = useCallback(() => {
      setCursorPreview((p: CursorPreview) => ({ ...p, visible: false }));
    }, []);

    useEffect(() => {
      if (!isToolActive) return;

      function onGlobalMove(e: MouseEvent | TouchEvent) {
        if (!isDrawing.current) return;
        scheduleMove(e);
      }

      function onGlobalUp() {
        if (!isDrawing.current) return;
        handleUp();
      }

      window.addEventListener('mousemove', onGlobalMove, { passive: false });
      window.addEventListener('mouseup', onGlobalUp);
      window.addEventListener('touchmove', onGlobalMove, { passive: false });
      window.addEventListener('touchcancel', onGlobalUp);
      return () => {
        window.removeEventListener('mousemove', onGlobalMove);
        window.removeEventListener('mouseup', onGlobalUp);
        window.removeEventListener('touchmove', onGlobalMove);
        window.removeEventListener('touchcancel', onGlobalUp);
      };
    }, [isToolActive, scheduleMove, handleUp]);

    const handleStraightenMouseDown = (e: any) => {
      if (e.evt.button !== 0 && !e.evt.touches) {
        return;
      }

      isStraightening.current = true;
      const pos = e.target.getStage().getPointerPosition();
      setStraightenLine({ start: pos, end: pos });
    };

    const handleStraightenMouseMove = (e: any) => {
      if (!isStraightening.current) {
        return;
      }

      const pos = e.target.getStage().getPointerPosition();
      setStraightenLine((prev: any) => ({ ...prev, end: pos }));
      if (e.evt && e.evt.cancelable) e.evt.preventDefault();
    };

    const handleStraightenMouseUp = () => {
      if (!isStraightening.current) {
        return;
      }
      isStraightening.current = false;
      if (
        !straightenLine ||
        (straightenLine.start.x === straightenLine.end.x && straightenLine.start.y === straightenLine.start.y)
      ) {
        setStraightenLine(null);
        return;
      }

      const { start, end } = straightenLine;
      const { rotation = 0 } = adjustments;
      const theta_rad = (rotation * Math.PI) / 180;
      const cos_t = Math.cos(theta_rad);
      const sin_t = Math.sin(theta_rad);
      const width = uncroppedImageRenderSize?.width ?? 0;
      const height = uncroppedImageRenderSize?.height ?? 0;
      const cx = width / 2;
      const cy = height / 2;

      const unrotate = (p: Coord) => {
        const x = p.x - cx;
        const y = p.y - cy;
        return {
          x: cx + x * cos_t + y * sin_t,
          y: cy - x * sin_t + y * cos_t,
        };
      };

      const start_unrotated = unrotate(start);
      const end_unrotated = unrotate(end);
      const dx = end_unrotated.x - start_unrotated.x;
      const dy = end_unrotated.y - start_unrotated.y;
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      let targetAngle;

      if (angle > -45 && angle <= 45) {
        targetAngle = 0;
      } else if (angle > 45 && angle <= 135) {
        targetAngle = 90;
      } else if (angle > 135 || angle <= -135) {
        targetAngle = 180;
      } else {
        targetAngle = -90;
      }

      let correction = targetAngle - angle;
      if (correction > 180) {
        correction -= 360;
      }
      if (correction < -180) {
        correction += 360;
      }

      onStraighten(correction);
      setStraightenLine(null);
    };

    const handleStraightenMouseLeave = () => {
      if (isStraightening.current) {
        isStraightening.current = false;
        setStraightenLine(null);
      }
    };

    const paintGuideLoupe = () => {
      const sample = guideLoupeSampleRef.current;
      const canvas = loupeCanvasRef.current;
      const img = guideImgRef.current;
      if (!sample || !canvas || !img || !img.complete || !img.naturalWidth) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const size = canvas.width;
      const zoom = 5;
      const sw = size / zoom;
      const sh = size / zoom;
      const px = (sample.x / Math.max(1, sample.stageW)) * img.naturalWidth;
      const py = (sample.y / Math.max(1, sample.stageH)) * img.naturalHeight;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#1c1c1c';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, px - sw / 2, py - sh / 2, sw, sh, 0, 0, size, size);
    };

    const trackGuideLoupe = (e: any) => {
      const stage = e.target?.getStage?.();
      const pos = stage?.getPointerPosition?.();
      if (!stage || !pos) {
        guideLoupeSampleRef.current = null;
        setGuideLoupe(null);
        return;
      }
      const box = stage.container().getBoundingClientRect();
      guideLoupeSampleRef.current = { x: pos.x, y: pos.y, stageW: stage.width(), stageH: stage.height() };
      setGuideLoupe({ sx: box.left + pos.x, sy: box.top + pos.y });
      paintGuideLoupe();
    };

    useLayoutEffect(() => {
      if (guideLoupe) paintGuideLoupe();
    }, [guideLoupe]);

    /** Guided Upright: draw 1–2 lines; estimate vertical/horizontal/rotate from guides. */
    const handleGuidedMouseDown = (e: any) => {
      trackGuideLoupe(e);
      if (e.evt.button !== 0 && !e.evt.touches) return;
      const existing = Array.isArray((adjustments as any).guidedUprightLines)
        ? (adjustments as any).guidedUprightLines
        : [];
      if (existing.length >= 2) {
        // Third click clears and restarts
        setAdjustments((prev) => ({ ...prev, guidedUprightLines: [] }));
      }
      isGuidedDrawing.current = true;
      const pos = e.target.getStage().getPointerPosition();
      setGuidedDraft({ start: pos, end: pos });
    };

    const handleGuidedMouseMove = (e: any) => {
      trackGuideLoupe(e);
      if (!isGuidedDrawing.current) return;
      const pos = e.target.getStage().getPointerPosition();
      setGuidedDraft((prev) => (prev ? { ...prev, end: pos } : prev));
      if (e.evt && e.evt.cancelable) e.evt.preventDefault();
    };

    const handleGuidedMouseUp = () => {
      if (!isGuidedDrawing.current) return;
      isGuidedDrawing.current = false;
      if (
        !guidedDraft ||
        (guidedDraft.start.x === guidedDraft.end.x && guidedDraft.start.y === guidedDraft.end.y)
      ) {
        setGuidedDraft(null);
        return;
      }
      const w = uncroppedImageRenderSize?.width || imageRenderSize?.width || 1;
      const h = uncroppedImageRenderSize?.height || imageRenderSize?.height || 1;
      const norm = [
        guidedDraft.start.x / w,
        guidedDraft.start.y / h,
        guidedDraft.end.x / w,
        guidedDraft.end.y / h,
      ];
      setGuidedDraft(null);
      setAdjustments((prev) => {
        const prevLines = Array.isArray(prev.guidedUprightLines) ? [...prev.guidedUprightLines] : [];
        // max 2 lines
        const lines = (prevLines.length >= 2 ? [] : prevLines).concat([norm]).slice(0, 2);

        // Estimate geometry from guides (LR-style shell: map angles → vertical/horizontal/rotate)
        let transformVertical = prev.transformVertical ?? 0;
        let transformHorizontal = prev.transformHorizontal ?? 0;
        let transformRotate = prev.transformRotate ?? 0;

        const angles: number[] = [];
        for (const ln of lines) {
          if (!ln || ln.length < 4) continue;
          const dx = (ln[2] - ln[0]) * w;
          const dy = (ln[3] - ln[1]) * h;
          angles.push(Math.atan2(dy, dx) * (180 / Math.PI));
        }

        if (angles.length === 1) {
          const a = angles[0];
          // Snap toward nearest H/V
          let target = 0;
          if (a > -45 && a <= 45) target = 0;
          else if (a > 45 && a <= 135) target = 90;
          else if (a > 135 || a <= -135) target = 180;
          else target = -90;
          let corr = target - a;
          if (corr > 180) corr -= 360;
          if (corr < -180) corr += 360;
          // Small rotate for near-horizontal; vertical bias for near-vertical
          if (Math.abs(target) === 0 || Math.abs(target) === 180) {
            transformRotate = Math.max(-10, Math.min(10, corr * 0.35));
            transformHorizontal = Math.max(-100, Math.min(100, corr * 2.5));
          } else {
            transformVertical = Math.max(-100, Math.min(100, corr * 2.5));
            transformRotate = Math.max(-10, Math.min(10, (corr > 90 ? corr - 90 : corr) * 0.2));
          }
        } else if (angles.length >= 2) {
          // Two guides: one treated as H, one as V by closeness
          const scored = angles.map((a) => {
            const toH = Math.min(Math.abs(a), Math.abs(Math.abs(a) - 180));
            const toV = Math.min(Math.abs(a - 90), Math.abs(a + 90));
            return { a, toH, toV };
          });
          scored.sort((x, y) => x.toH - y.toH);
          const hGuide = scored[0];
          const vGuide = scored[1].toV <= scored[0].toV ? scored[1] : scored.find((s) => s !== hGuide) || scored[1];
          // Horizontal correction → rotate + horizontal keystone
          let hCorr = -hGuide.a;
          if (hCorr > 90) hCorr -= 180;
          if (hCorr < -90) hCorr += 180;
          transformRotate = Math.max(-10, Math.min(10, hCorr * 0.4));
          transformHorizontal = Math.max(-100, Math.min(100, hCorr * 3));
          // Vertical correction → vertical keystone
          let vA = vGuide.a;
          // distance from ±90
          let vCorr = vA > 0 ? 90 - vA : -90 - vA;
          transformVertical = Math.max(-100, Math.min(100, vCorr * 3));
        }

        return {
          ...prev,
          guidedUprightLines: lines,
          perspectiveUpright: 5,
          transformVertical,
          transformHorizontal,
          transformRotate,
        };
      });
    };

    const handleGuidedMouseLeave = () => {
      setGuideLoupe(null);
      if (isGuidedDrawing.current) {
        isGuidedDrawing.current = false;
        setGuidedDraft(null);
      }
    };


    const cropPreviewUrl = uncroppedAdjustedPreviewUrl || selectedImage.thumbnailUrl;
    useEffect(() => {
      const url = finalPreviewUrl || cropPreviewUrl;
      if (!url) {
        guideImgRef.current = null;
        return;
      }
      const img = new Image();
      img.src = url;
      guideImgRef.current = img;
    }, [finalPreviewUrl, cropPreviewUrl]);
    const originalSrc = transformedOriginalUrl;
    const isShowingOriginal = showOriginal && !!originalSrc;
    const isSplitBA = !!beforeAfterSplit && !!originalSrc && originalLoaded;
    const baHorizontal = isSplitBA && beforeAfterOrientation === 'horizontal';
    const baTwoUp = isSplitBA && beforeAfterOrientation === 'two-up';

    useEffect(() => {
      if (!originalSrc) {
        setOriginalLoaded(false);
        return;
      }

      const img = new Image();
      img.src = originalSrc;

      if (img.complete) {
        setOriginalLoaded(true);
      } else {
        setOriginalLoaded(false);
        img.onload = () => setOriginalLoaded(true);
      }

      return () => {
        img.onload = null;
      };
    }, [originalSrc]);

    const currentTarget = previewSrc;
    const baseIsReady = displayState.base === currentTarget && !displayState.fade;

    const visiblePatch = interactivePatch ?? (baseIsReady ? null : retainedPatchRef.current);

    useEffect(() => {
      if (baseIsReady && !interactivePatch) {
        retainedPatchRef.current = null;
      }
    }, [baseIsReady, interactivePatch]);

    const uncroppedImageRenderSize = useMemo<Partial<RenderSize> | null>(() => {
      if (!selectedImage?.width || !selectedImage?.height || !imageRenderSize?.width || !imageRenderSize?.height) {
        return null;
      }

      const viewportWidth = imageRenderSize.width + 2 * imageRenderSize.offsetX;
      const viewportHeight = imageRenderSize.height + 2 * imageRenderSize.offsetY;

      let uncroppedEffectiveWidth = selectedImage.width;
      let uncroppedEffectiveHeight = selectedImage.height;
      const orientationSteps = adjustments.orientationSteps || 0;
      if (orientationSteps === 1 || orientationSteps === 3) {
        [uncroppedEffectiveWidth, uncroppedEffectiveHeight] = [uncroppedEffectiveHeight, uncroppedEffectiveWidth];
      }

      if (uncroppedEffectiveWidth <= 0 || uncroppedEffectiveHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
        return null;
      }

      const squeeze =
        Number((adjustments as any).anamorphicSqueeze) > 1.01
          ? Number((adjustments as any).anamorphicSqueeze)
          : 1;
      const scale = Math.min(
        viewportWidth / (uncroppedEffectiveWidth * squeeze),
        viewportHeight / uncroppedEffectiveHeight,
      );

      const renderWidth = uncroppedEffectiveWidth * squeeze * scale;
      const renderHeight = uncroppedEffectiveHeight * scale;

      return { width: renderWidth, height: renderHeight };
    }, [
      selectedImage?.width,
      selectedImage?.height,
      imageRenderSize,
      adjustments.orientationSteps,
      (adjustments as any).anamorphicSqueeze,
    ]);

    const cropImageTransforms = useMemo(() => {
      const rotation = liveRotation !== null && liveRotation !== undefined ? liveRotation : adjustments.rotation || 0;
      return `rotate(${rotation}deg)`;
    }, [adjustments.rotation, liveRotation]);

    const getCropDimensions = () => {
      if (!crop || !uncroppedImageRenderSize?.width || !uncroppedImageRenderSize?.height) {
        return { width: 0, height: 0 };
      }

      const width = crop.unit === '%' ? uncroppedImageRenderSize.width * (crop.width / 100) : crop.width;
      const height = crop.unit === '%' ? uncroppedImageRenderSize.height * (crop.height / 100) : crop.height;

      return { width, height };
    };

    const effectiveCursor = useMemo(() => {
      if (isWbPickerActive || isPointColorPickerActive) return 'crosshair';
      if (isParametricActive) return 'crosshair';
      if (isInitialDrawing) return 'crosshair';

      if (isBrushActive && !isManualCleanupActive) return 'none';

      if (isManualCleanupActive) {
        if (activeSubMask?.parameters?.sourceX === undefined || isCtrlPressed) {
          const targetSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" style="filter: drop-shadow(0px 1px 2px rgba(0,0,0,0.8));">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="2" x2="12" y2="10" />
        <line x1="12" y1="14" x2="12" y2="22" />
        <line x1="2" y1="12" x2="10" y2="12" />
        <line x1="14" y1="12" x2="22" y2="12" />
      </svg>`;

          return `url('data:image/svg+xml;utf8,${encodeURIComponent(targetSvg)}') 12 12, crosshair`;
        }
        return 'none';
      }

      if (isAiSubjectActive) return 'crosshair';

      return cursorStyle;
    }, [
      isWbPickerActive,
      isInitialDrawing,
      isBrushActive,
      isManualCleanupActive,
      activeSubMask,
      isAiSubjectActive,
      isParametricActive,
      cursorStyle,
      isCtrlPressed,
    ]);

    const handlePreviewUpdate = useCallback(
      (id: string, subMaskPreview: Partial<SubMask>) => {
        if (!activeContainer || !onLiveMaskPreview) return;
        const previewContainer = {
          ...activeContainer,
          subMasks: activeContainer.subMasks.map((sm: SubMask) => (sm.id === id ? { ...sm, ...subMaskPreview } : sm)),
        };
        onLiveMaskPreview(previewContainer);
      },
      [activeContainer, onLiveMaskPreview],
    );

    // Konva fires a move per mouse event (often several per frame); each update rewrites the
    // adjustments (whole-panel render, GPU render, overlay request). Apply the latest one per
    // frame instead; the drag-end update goes through here too, so the final value lands.
    const latestMaskCallbacks = useRef({ updateSubMask, handlePreviewUpdate });
    latestMaskCallbacks.current = { updateSubMask, handlePreviewUpdate };
    const pendingMaskUpdates = useRef(new Map<string, { update?: Partial<SubMask>; preview?: Partial<SubMask> }>());
    const maskUpdateFrame = useRef<number | null>(null);
    const scheduleMaskUpdates = useCallback(() => {
      if (maskUpdateFrame.current !== null) return;
      maskUpdateFrame.current = requestAnimationFrame(() => {
        maskUpdateFrame.current = null;
        const pending = pendingMaskUpdates.current;
        pendingMaskUpdates.current = new Map();
        const { updateSubMask: update, handlePreviewUpdate: preview } = latestMaskCallbacks.current;
        pending.forEach((entry, id) => {
          if (entry.preview) preview(id, entry.preview);
          if (entry.update) update(id, entry.update);
        });
      });
    }, []);
    useEffect(() => () => {
      if (maskUpdateFrame.current !== null) cancelAnimationFrame(maskUpdateFrame.current);
    }, []);
    const updateSubMaskPerFrame = useCallback(
      (id: string, subMask: Partial<SubMask>) => {
        pendingMaskUpdates.current.set(id, { ...pendingMaskUpdates.current.get(id), update: subMask });
        scheduleMaskUpdates();
      },
      [scheduleMaskUpdates],
    );
    const previewSubMaskPerFrame = useCallback(
      (id: string, subMask: Partial<SubMask>) => {
        pendingMaskUpdates.current.set(id, { ...pendingMaskUpdates.current.get(id), preview: subMask });
        scheduleMaskUpdates();
      },
      [scheduleMaskUpdates],
    );

    const handleMaskInteractionStart = useCallback(
      (e?: any) => {
        setIsMaskInteractionActive(true);
        const eventType = e?.evt?.type;
        if (eventType === 'touchstart') {
          setIsMaskTouchInteracting(true);
        }
      },
      [setIsMaskTouchInteracting],
    );

    const handleMaskInteractionEnd = useCallback(() => {
      setIsMaskInteractionActive(false);
      setIsMaskTouchInteracting(false);
    }, [setIsMaskTouchInteracting]);

    const currentActiveSubMaskId = activeAiSubMaskId || activeMaskId;
    // The overlay stays up while dragging a mask, a slider or hovering mask controls: it is
    // what shows where a feather/range change lands.
    const maskOpacity =
      !showMaskOverlay || isShowingOriginal
        ? 0
        : isCloneOrHealActive
          ? hoveredMarkerId === currentActiveSubMaskId || isMaskControlHovered
            ? 1
            : 0
          : 1;

    return (
      <div className="relative" style={{ width: '100%', height: '100%', cursor: effectiveCursor }}>
        <div
          className="absolute inset-0 w-full h-full transition-opacity duration-200 flex items-center justify-center"
          style={{
            opacity: isCropViewVisible ? 0 : 1,
            pointerEvents: isCropViewVisible ? 'none' : 'auto',
          }}
        >
          <div
            className="opacity-100"
            style={{
              height: '100%',
              position: 'relative',
              width: '100%',
            }}
          >
            <div className="absolute inset-0 w-full h-full">
              <svg
                className="pointer-events-none"
                style={
                  imageRenderSize.width > 0 && imageRenderSize.height > 0
                    ? {
                        position: 'absolute',
                        left: `${imageRenderSize.offsetX}px`,
                        top: `${imageRenderSize.offsetY}px`,
                        width: `${imageRenderSize.width}px`,
                        height: `${imageRenderSize.height}px`,
                        overflow: 'visible',
                        filter: softProofFilter,
                        clipPath: baTwoUp ? 'inset(0 0 0 50%)' : undefined,
                      }
                    : {
                        position: 'absolute',
                        inset: '0px',
                        width: '100%',
                        height: '100%',
                        overflow: 'visible',
                        filter: softProofFilter,
                        clipPath: baTwoUp ? 'inset(0 0 0 50%)' : undefined,
                      }
                }
                preserveAspectRatio={imageRenderSize.width > 0 && imageRenderSize.height > 0 ? 'none' : 'xMidYMid meet'}
              >
                {displayState.base && !isWgpuActive && (
                  <image
                    href={displayState.base}
                    x="0"
                    y="0"
                    width="100%"
                    height="100%"
                    style={{ imageRendering: isMaxZoom ? 'pixelated' : 'auto' }}
                  />
                )}

                {displayState.fade && !isWgpuActive && (
                  <image
                    href={displayState.fade}
                    x="0"
                    y="0"
                    width="100%"
                    height="100%"
                    style={{
                      imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                    }}
                  />
                )}

                {visiblePatch && !isWgpuActive && (
                  <image
                    href={visiblePatch.url}
                    x={`${visiblePatch.normX * 100}%`}
                    y={`${visiblePatch.normY * 100}%`}
                    width={`${visiblePatch.normW * 100}%`}
                    height={`${visiblePatch.normH * 100}%`}
                    preserveAspectRatio="none"
                    style={{ imageRendering: isMaxZoom ? 'pixelated' : 'auto' }}
                  />
                )}
              </svg>

              {originalSrc && (
                <img
                  alt="Original"
                  className={
                    imageRenderSize.width > 0 && imageRenderSize.height > 0
                      ? 'pointer-events-none'
                      : 'absolute inset-0 w-full h-full object-contain pointer-events-none'
                  }
                  src={originalSrc}
                  style={
                    imageRenderSize.width > 0 && imageRenderSize.height > 0
                      ? {
                          position: 'absolute',
                          left: `${imageRenderSize.offsetX}px`,
                          top: `${imageRenderSize.offsetY}px`,
                          width: `${imageRenderSize.width}px`,
                          height: `${imageRenderSize.height}px`,
                          imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                          opacity: ((isSplitBA || isShowingOriginal) && originalLoaded) ? 1 : 0,
                          transition: originalLoaded && !isSplitBA ? 'opacity 150ms ease-in-out' : 'none',
                          zIndex: 2,
                          clipPath: isSplitBA
                            ? baTwoUp
                              ? 'inset(0 50% 0 0)'
                              : baHorizontal
                                ? `inset(0 0 ${(1 - baSplitRatio) * 100}% 0)`
                                : `inset(0 ${(1 - baSplitRatio) * 100}% 0 0)`
                            : undefined,
                          // Original / Before never gets soft-proof CSS (Proof applies to developed layer only)
                          filter: undefined,
                        }
                      : {
                          imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                          opacity: ((isSplitBA || isShowingOriginal) && originalLoaded) ? 1 : 0,
                          transition: originalLoaded && !isSplitBA ? 'opacity 150ms ease-in-out' : 'none',
                          zIndex: 2,
                          clipPath: isSplitBA
                            ? baTwoUp
                              ? 'inset(0 50% 0 0)'
                              : baHorizontal
                                ? `inset(0 0 ${(1 - baSplitRatio) * 100}% 0)`
                                : `inset(0 ${(1 - baSplitRatio) * 100}% 0 0)`
                            : undefined,
                          filter: undefined,
                        }
                  }
                />
              )}
              {isSplitBA && !baTwoUp && imageRenderSize.width > 0 && (
                <>
                  <div
                    className={clsx('absolute z-[4] bg-white/90 shadow pointer-events-auto', baHorizontal ? 'cursor-ns-resize' : 'cursor-ew-resize')}
                    style={
                      baHorizontal
                        ? {
                            left: `${imageRenderSize.offsetX}px`,
                            top: `${imageRenderSize.offsetY + imageRenderSize.height * baSplitRatio - 1}px`,
                            width: `${imageRenderSize.width}px`,
                            height: '2px',
                          }
                        : {
                            left: `${imageRenderSize.offsetX + imageRenderSize.width * baSplitRatio - 1}px`,
                            top: `${imageRenderSize.offsetY}px`,
                            width: '2px',
                            height: `${imageRenderSize.height}px`,
                          }
                    }
                    role="separator"
                    aria-orientation={baHorizontal ? 'horizontal' : 'vertical'}
                    aria-valuenow={Math.round(baSplitRatio * 100)}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      baDragRef.current = true;
                      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                      const startPos = baHorizontal ? e.clientY : e.clientX;
                      const startRatio = baSplitRatio;
                      const span = baHorizontal ? imageRenderSize.height : imageRenderSize.width;
                      const onMove = (ev: PointerEvent) => {
                        if (!baDragRef.current) return;
                        const delta = (baHorizontal ? ev.clientY : ev.clientX) - startPos;
                        const next = Math.min(0.92, Math.max(0.08, startRatio + delta / span));
                        setBaSplitRatio(next);
                      };
                      const onUp = () => {
                        baDragRef.current = false;
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                      };
                      window.addEventListener('pointermove', onMove);
                      window.addEventListener('pointerup', onUp);
                    }}
                  />
                  {/* wider hit area */}
                  <div
                    className={clsx('absolute z-[4] pointer-events-auto', baHorizontal ? 'cursor-ns-resize' : 'cursor-ew-resize')}
                    style={
                      baHorizontal
                        ? {
                            left: `${imageRenderSize.offsetX}px`,
                            top: `${imageRenderSize.offsetY + imageRenderSize.height * baSplitRatio - 6}px`,
                            width: `${imageRenderSize.width}px`,
                            height: '12px',
                          }
                        : {
                            left: `${imageRenderSize.offsetX + imageRenderSize.width * baSplitRatio - 6}px`,
                            top: `${imageRenderSize.offsetY}px`,
                            width: '12px',
                            height: `${imageRenderSize.height}px`,
                          }
                    }
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      baDragRef.current = true;
                      const startPos = baHorizontal ? e.clientY : e.clientX;
                      const startRatio = baSplitRatio;
                      const span = baHorizontal ? imageRenderSize.height : imageRenderSize.width;
                      const onMove = (ev: PointerEvent) => {
                        if (!baDragRef.current) return;
                        const delta = (baHorizontal ? ev.clientY : ev.clientX) - startPos;
                        const next = Math.min(0.92, Math.max(0.08, startRatio + delta / span));
                        setBaSplitRatio(next);
                      };
                      const onUp = () => {
                        baDragRef.current = false;
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                      };
                      window.addEventListener('pointermove', onMove);
                      window.addEventListener('pointerup', onUp);
                    }}
                  />
                  <div
                    className="absolute pointer-events-none z-[4] text-[9px] font-bold uppercase tracking-wider text-white drop-shadow-md"
                    style={{
                      left: `${imageRenderSize.offsetX + 8}px`,
                      top: `${imageRenderSize.offsetY + 8}px`,
                    }}
                  >
                    Before
                  </div>
                  <div
                    className="absolute pointer-events-none z-[4] text-[9px] font-bold uppercase tracking-wider text-white drop-shadow-md"
                    style={
                      baHorizontal
                        ? {
                            left: `${imageRenderSize.offsetX + 8}px`,
                            top: `${imageRenderSize.offsetY + imageRenderSize.height * baSplitRatio + 8}px`,
                          }
                        : {
                            left: `${imageRenderSize.offsetX + imageRenderSize.width * baSplitRatio + 8}px`,
                            top: `${imageRenderSize.offsetY + 8}px`,
                          }
                    }
                  >
                    {softProofing ? 'Proof' : 'After'}
                  </div>
                </>
              )}
              
              {softProofing && imageRenderSize.width > 0 && (
                <div
                  className="absolute pointer-events-none z-[5] border-2 border-amber-500/70 rounded-sm"
                  style={{
                    left: `${imageRenderSize.offsetX}px`,
                    top: `${imageRenderSize.offsetY}px`,
                    width: `${imageRenderSize.width}px`,
                    height: `${imageRenderSize.height}px`,
                    boxShadow: softProofSimulatePaper
                      ? 'inset 0 0 60px rgba(245, 158, 11, 0.12), inset 0 0 0 9999px rgba(255,248,230,0.04)'
                      : 'inset 0 0 48px rgba(245, 158, 11, 0.10)',
                  }}
                  aria-hidden
                >
                  <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/55 text-[9px] font-semibold uppercase tracking-wide text-amber-100/90 max-w-[90%] truncate">
                    {softProofProfile || 'sRGB'}
                    {softProofIntent ? ` · ${softProofIntent}` : ''}
                    {softProofSimulatePaper ? ' · paper' : ''}
                  </div>
                </div>
              )}
              {softProofing && softProofShowGamutWarning && imageRenderSize.width > 0 && (
                <div
                  className="absolute pointer-events-none z-[6] mix-blend-multiply opacity-45"
                  style={{
                    left: `${imageRenderSize.offsetX}px`,
                    top: `${imageRenderSize.offsetY}px`,
                    width: `${imageRenderSize.width}px`,
                    height: `${imageRenderSize.height}px`,
                    // Profile-biased approx OOG shell (not true ICC gamut mapping)
                    background: (() => {
                      const pl = (softProofProfile || 'sRGB').toLowerCase();
                      if (pl.includes('gray')) {
                        return 'radial-gradient(ellipse at 50% 50%, rgba(255,40,40,0.4) 0%, transparent 60%)';
                      }
                      if (pl.includes('swop') || pl.includes('fogra') || pl.includes('japan') || pl.includes('cmyk')) {
                        return 'radial-gradient(ellipse at 25% 35%, rgba(255,0,100,0.45) 0%, transparent 50%), radial-gradient(ellipse at 75% 60%, rgba(0,80,255,0.4) 0%, transparent 48%), radial-gradient(ellipse at 50% 80%, rgba(0,200,80,0.25) 0%, transparent 45%)';
                      }
                      if (pl.includes('p3') || pl.includes('2020') || pl.includes('prophoto')) {
                        // Wide gamut: smaller warning regions
                        return 'radial-gradient(ellipse at 20% 30%, rgba(255,0,80,0.22) 0%, transparent 40%), radial-gradient(ellipse at 80% 70%, rgba(0,100,255,0.18) 0%, transparent 38%)';
                      }
                      if (pl.includes('adobe')) {
                        return 'radial-gradient(ellipse at 28% 38%, rgba(255,0,80,0.3) 0%, transparent 50%), radial-gradient(ellipse at 72% 68%, rgba(0,120,255,0.25) 0%, transparent 48%)';
                      }
                      return 'radial-gradient(ellipse at 30% 40%, rgba(255,0,80,0.35) 0%, transparent 55%), radial-gradient(ellipse at 70% 65%, rgba(0,120,255,0.3) 0%, transparent 50%)';
                    })(),
                  }}
                  aria-hidden
                  title={`Approx. out-of-gamut highlight (${softProofProfile || 'sRGB'})`}
                />
              )}

              
              {baTwoUp && imageRenderSize.width > 0 && (
                <>
                  <div
                    className="absolute pointer-events-none z-[4] text-[9px] font-bold uppercase tracking-wider text-white drop-shadow-md"
                    style={{
                      left: `${imageRenderSize.offsetX + 8}px`,
                      top: `${imageRenderSize.offsetY + 8}px`,
                    }}
                  >
                    Before
                  </div>
                  <div
                    className="absolute pointer-events-none z-[4] text-[9px] font-bold uppercase tracking-wider text-white drop-shadow-md"
                    style={{
                      left: `${imageRenderSize.offsetX + imageRenderSize.width / 2 + 8}px`,
                      top: `${imageRenderSize.offsetY + 8}px`,
                    }}
                  >
                    {softProofing ? 'Proof' : 'After'}
                  </div>
                  <div
                    className="absolute z-[4] bg-white/50 pointer-events-none"
                    style={{
                      left: `${imageRenderSize.offsetX + imageRenderSize.width / 2 - 0.5}px`,
                      top: `${imageRenderSize.offsetY}px`,
                      width: '1px',
                      height: `${imageRenderSize.height}px`,
                    }}
                    aria-hidden
                  />
                </>
              )}

              {displayedMask && (
                <MaskOverlayCanvas
                  overlay={displayedMask}
                  style={{
                    height: `${imageRenderSize.height}px`,
                    left: `${imageRenderSize.offsetX}px`,
                    opacity: maskOpacity,
                    top: `${imageRenderSize.offsetY}px`,
                    transition: 'opacity 300ms ease-in-out',
                    width: `${imageRenderSize.width}px`,
                    imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                    zIndex: 3,
                  }}
                />
              )}
            </div>

            <div className="absolute inset-0 pointer-events-none z-50">
              {!isDrawing.current &&
                cloneHealMarkers.map((m) => {
                  const left = (m.cx - cropX) * scaleX + imageRenderSize.offsetX;
                  const top = (m.cy - cropY) * scaleY + imageRenderSize.offsetY;

                  return (
                    <div
                      key={`html-marker-${m.id}`}
                      className="absolute pointer-events-auto flex items-center justify-center cursor-pointer"
                      style={{
                        left,
                        top,
                        transform: `translate(-50%, -50%) scale(${1 / maxSafeScale})`,
                        transformOrigin: 'center',
                      }}
                      onMouseEnter={() => {
                        setHoveredMarkerId(m.id);
                        setIsMaskHovered(true);
                      }}
                      onMouseLeave={() => {
                        setHoveredMarkerId(null);
                        setIsMaskHovered(false);
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (m.isAi) {
                          if (onSelectAiPatchContainer) onSelectAiPatchContainer(m.containerId);
                          onSelectAiSubMask(m.id);
                        } else {
                          if (onSelectMaskContainer) onSelectMaskContainer(m.containerId);
                          onSelectMask(m.id);
                        }
                      }}
                    >
                      <div className="p-1.5 rounded-full shadow-md transition-transform hover:scale-110 bg-surface/70 text-text-primary shadow-black/20">
                        {m.type === Mask.Clone ? <Stamp size={16} /> : <Bandage size={16} />}
                      </div>
                    </div>
                  );
                })}

              {!isDrawing.current &&
                activeSubMask &&
                (activeSubMask.type === Mask.Clone || activeSubMask.type === Mask.Heal) &&
                activeSubMask.parameters?.sourceX !== undefined &&
                activeSubMask.parameters?.sourceY !== undefined && (
                  <div
                    className="absolute pointer-events-auto rounded-full"
                    style={{
                      left:
                        (activeSubMask.parameters.sourceX - cropX) * scaleX + imageRenderSize.offsetX,
                      top: (activeSubMask.parameters.sourceY - cropY) * scaleY + imageRenderSize.offsetY,
                      width: 32,
                      height: 32,
                      transform: `translate(-50%, -50%) scale(${1 / maxSafeScale})`,
                      transformOrigin: 'center',
                      cursor: 'crosshair',
                    }}
                    data-tooltip={t('editor.masks.tooltips.selectNewSourcePoint', { modifier: modifierKey })}
                  />
                )}
            </div>
          </div>

          {(isMasking || isAiEditing || isWbPickerActive || isPointColorPickerActive) && (
            <div
              style={{
                position: 'absolute',
                top: stageTop,
                left: stageLeft,
                transformOrigin: '0 0',
                transform: `scale(${1 / maxSafeScale})`,
                width: stageWidth * maxSafeScale,
                height: stageHeight * maxSafeScale,
                zIndex: 4,
                touchAction: 'none',
                userSelect: 'none',
                opacity: isShowingOriginal ? 0 : 1,
                transition: 'opacity 150ms ease-in-out',
                ...getEdgeFadeStyle(128),
              }}
            >
              <Stage
                width={stageWidth * maxSafeScale}
                height={stageHeight * maxSafeScale}
                onMouseDown={handleStart}
                onTouchStart={handleStart}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onMouseMove={scheduleMove}
                onTouchMove={scheduleMove}
                onMouseUp={handleUp}
                onTouchEnd={handleUp}
              >
                <Layer listening={!showOriginal || !!beforeAfterSplit}>
                  <Group scaleX={maxSafeScale} scaleY={maxSafeScale}>
                    <Group x={groupOffsetX} y={groupOffsetY}>
                      {(isMasking || isAiEditing) &&
                        activeContainer &&
                        sortedSubMasks.map((subMask: SubMask) => {
                          const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
                          const renderSubMask =
                            subMask.id === activeId && localInitialDrawParams
                              ? { ...subMask, parameters: localInitialDrawParams }
                              : subMask;

                          const isCloneOrHeal = renderSubMask.type === Mask.Clone || renderSubMask.type === Mask.Heal;
                          const isThisSubMaskActive = renderSubMask.id === activeId;
                          const isActivelyDrawingThis = isThisSubMaskActive && isDrawing.current;
                          const isHoveringThisMarker = hoveredMarkerId === renderSubMask.id;

                          let showBrushStrokes = true;
                          if (isCloneOrHeal) {
                            showBrushStrokes =
                              isActivelyDrawingThis ||
                              isHoveringThisMarker ||
                              (isThisSubMaskActive && isMaskControlHovered);
                          }

                          return (
                            <MaskOverlay
                              adjustments={adjustments}
                              imageHeight={effectiveImageDimensions.height}
                              imageWidth={effectiveImageDimensions.width}
                              isSelected={renderSubMask.id === activeId}
                              isToolActive={isToolActive}
                              showBrushStrokes={showBrushStrokes}
                              key={renderSubMask.id}
                              onMaskInteractionEnd={handleMaskInteractionEnd}
                              onMaskInteractionStart={handleMaskInteractionStart}
                              onMaskMouseEnter={() => !isToolActive && setIsMaskHovered(true)}
                              onMaskMouseLeave={() => !isToolActive && setIsMaskHovered(false)}
                              onPreviewUpdate={previewSubMaskPerFrame}
                              onSelect={() =>
                                isMasking ? onSelectMask(renderSubMask.id) : onSelectAiSubMask(renderSubMask.id)
                              }
                              onUpdate={updateSubMaskPerFrame}
                              scale={scaleX}
                              scaleX={scaleX}
                              scaleY={scaleY}
                              subMask={renderSubMask}
                              offsetX={groupOffsetX}
                              offsetY={groupOffsetY}
                              stageScale={maxSafeScale}
                            />
                          );
                        })}

                      {previewBox && (
                        <Rect
                          x={Math.min(previewBox.start.x, previewBox.end.x)}
                          y={Math.min(previewBox.start.y, previewBox.end.y)}
                          width={Math.max(0.1, Math.abs(previewBox.end.x - previewBox.start.x))}
                          height={Math.max(0.1, Math.abs(previewBox.end.y - previewBox.start.y))}
                          stroke="#0ea5e9"
                          strokeWidth={2}
                          dash={[4, 4]}
                          listening={false}
                        />
                      )}
                      {isBrushActive &&
                        cursorPreview.visible &&
                        (!isManualCleanupActive ||
                          (activeSubMask?.parameters?.sourceX !== undefined && !isCtrlPressed)) && (
                          <Circle
                            {...(brushCursorPreview.colorStops
                              ? {
                                  fillRadialGradientColorStops: brushCursorPreview.colorStops,
                                  fillRadialGradientEndPoint: { x: 0, y: 0 },
                                  fillRadialGradientEndRadius: brushCursorPreview.radius,
                                  fillRadialGradientStartPoint: { x: 0, y: 0 },
                                  fillRadialGradientStartRadius: 0,
                                }
                              : { fill: brushCursorPreview.fill })}
                            listening={false}
                            perfectDrawEnabled={false}
                            radius={brushCursorPreview.radius}
                            x={cursorPreview.x}
                            y={cursorPreview.y}
                          />
                        )}
                    </Group>
                  </Group>
                </Layer>
              </Stage>
            </div>
          )}
        </div>

        <div
          className="absolute inset-0 w-full h-full flex items-center justify-center transition-opacity duration-200"
          style={{
            opacity: isCropViewVisible ? 1 : 0,
            pointerEvents: isCropViewVisible ? 'auto' : 'none',
          }}
        >
          {cropPreviewUrl && uncroppedImageRenderSize && (
            <div
              style={{
                height: uncroppedImageRenderSize.height,
                position: 'relative',
                width: uncroppedImageRenderSize.width,
              }}
            >
              <ReactCrop
                aspect={adjustments.aspectRatio ?? undefined}
                crop={crop ?? undefined}
                onChange={setCrop}
                onComplete={handleCropComplete}
                ruleOfThirds={false}
                renderSelectionAddon={() => {
                  const { width, height } = getCropDimensions();
                  if (width <= 0 || height <= 0) {
                    return null;
                  }
                  const showDenseGrid = isRotationActive && !isStraightenActive;
                  const currentOverlayMode = isRotationActive || isStraightenActive ? 'none' : overlayMode || 'none';
                  return (
                    <CompositionOverlays
                      width={width}
                      height={height}
                      mode={currentOverlayMode}
                      rotation={overlayRotation || 0}
                      denseVisible={showDenseGrid}
                    />
                  );
                }}
              >
                <img
                  alt="Crop preview"
                  ref={cropImageRef}
                  src={cropPreviewUrl}
                  style={{
                    display: 'block',
                    width: `${uncroppedImageRenderSize.width}px`,
                    height: `${uncroppedImageRenderSize.height}px`,
                    objectFit: 'contain',
                    transform: cropImageTransforms,
                    imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                  }}
                />
              </ReactCrop>

              {isStraightenActive && (
                <Stage
                  height={uncroppedImageRenderSize.height}
                  onMouseDown={handleStraightenMouseDown}
                  onTouchStart={handleStraightenMouseDown}
                  onMouseLeave={handleStraightenMouseLeave}
                  onMouseMove={handleStraightenMouseMove}
                  onTouchMove={handleStraightenMouseMove}
                  onMouseUp={handleStraightenMouseUp}
                  onTouchEnd={handleStraightenMouseUp}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    zIndex: 10,
                    cursor: 'crosshair',
                    touchAction: 'none',
                  }}
                  width={uncroppedImageRenderSize.width}
                >
                  <Layer>
                    {straightenLine && (
                      <Line
                        dash={[4, 4]}
                        listening={false}
                        points={[
                          straightenLine.start.x,
                          straightenLine.start.y,
                          straightenLine.end.x,
                          straightenLine.end.y,
                        ]}
                        stroke="#0ea5e9"
                        strokeWidth={2}
                      />
                    )}
                  </Layer>
                </Stage>
              )}

              {isGuidedUprightActive && !isStraightenActive && (
                <Stage
                  height={uncroppedImageRenderSize.height}
                  onMouseDown={handleGuidedMouseDown}
                  onTouchStart={handleGuidedMouseDown}
                  onMouseLeave={handleGuidedMouseLeave}
                  onMouseMove={handleGuidedMouseMove}
                  onTouchMove={handleGuidedMouseMove}
                  onMouseUp={handleGuidedMouseUp}
                  onTouchEnd={handleGuidedMouseUp}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    zIndex: 11,
                    cursor: 'crosshair',
                    touchAction: 'none',
                  }}
                  width={uncroppedImageRenderSize.width}
                >
                  <Layer>
                    {(Array.isArray((adjustments as any).guidedUprightLines)
                      ? (adjustments as any).guidedUprightLines
                      : []
                    ).map((ln: number[], i: number) => {
                      if (!ln || ln.length < 4) return null;
                      const ww = uncroppedImageRenderSize.width || 1;
                      const hh = uncroppedImageRenderSize.height || 1;
                      return (
                        <Line
                          key={`guide-${i}`}
                          dash={[6, 4]}
                          listening={false}
                          points={[ln[0] * ww, ln[1] * hh, ln[2] * ww, ln[3] * hh]}
                          stroke={i === 0 ? '#f59e0b' : '#a78bfa'}
                          strokeWidth={2}
                        />
                      );
                    })}
                    {guidedDraft && (
                      <Line
                        dash={[4, 4]}
                        listening={false}
                        points={[
                          guidedDraft.start.x,
                          guidedDraft.start.y,
                          guidedDraft.end.x,
                          guidedDraft.end.y,
                        ]}
                        stroke="#fbbf24"
                        strokeWidth={2}
                      />
                    )}
                  </Layer>
                </Stage>
              )}
              {isGuidedUprightActive && guideLoupe && (
                <div
                  className="pointer-events-none fixed z-[80] overflow-hidden border-[3px] border-black bg-neutral-900 shadow-lg"
                  style={{
                    width: 128,
                    height: 128,
                    left: Math.min(window.innerWidth - 136, guideLoupe.sx + 8),
                    top: Math.min(window.innerHeight - 136, guideLoupe.sy + 16),
                  }}
                >
                  <canvas ref={loupeCanvasRef} width={128} height={128} className="block h-full w-full" />
                  <svg className="absolute inset-0 h-full w-full" viewBox="0 0 128 128" aria-hidden>
                    <path d="M64 54v20M54 64h20" stroke="white" strokeWidth="1.6" />
                  </svg>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
);

export default ImageCanvas;
