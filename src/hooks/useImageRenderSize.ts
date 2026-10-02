import { useState, useLayoutEffect } from 'react';

export interface ImageDimensions {
  height: number;
  width: number;
}

export interface RenderSize {
  containerHeight: number;
  containerWidth: number;
  height: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  width: number;
}

const DEFAULT_SIZE: RenderSize = {
  width: 0,
  height: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
  containerWidth: 0,
  containerHeight: 0,
};

export const useImageRenderSize = (
  containerRef: React.RefObject<HTMLElement | null>,
  imageDimensions: ImageDimensions | null,
  pixelAspectX = 1,
) => {
  const [renderSize, setRenderSize] = useState<RenderSize>(DEFAULT_SIZE);
  const imgWidth = imageDimensions?.width;
  const imgHeight = imageDimensions?.height;
  const aspectX = Number.isFinite(pixelAspectX) && pixelAspectX > 1.01 ? pixelAspectX : 1;

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container || !imgWidth || !imgHeight) {
      setRenderSize(DEFAULT_SIZE);
      return;
    }

    const updateSize = () => {
      const { clientWidth: containerWidth, clientHeight: containerHeight } = container;
      const imageAspectRatio = (imgWidth * aspectX) / imgHeight;
      const containerAspectRatio = containerWidth / containerHeight;

      let width, height;
      if (imageAspectRatio > containerAspectRatio) {
        width = containerWidth;
        height = containerWidth / imageAspectRatio;
      } else {
        height = containerHeight;
        width = containerHeight * imageAspectRatio;
      }

      const offsetX = (containerWidth - width) / 2;
      const offsetY = (containerHeight - height) / 2;
      const scaleX = width / imgWidth;
      const scaleY = height / imgHeight;

      setRenderSize({
        width,
        height,
        scale: scaleX,
        scaleX,
        scaleY,
        offsetX,
        offsetY,
        containerWidth,
        containerHeight,
      });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });

    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [containerRef, imgWidth, imgHeight, aspectX]);

  return renderSize;
};
