import { useId, type SVGProps } from 'react';

export type ToolIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number | string;
};

function box({ size = 24, className, strokeWidth: _strokeWidth, ...rest }: ToolIconProps) {
  return { width: size, height: size, className, 'aria-hidden': true as const, ...rest };
}

/** Inpaint: tilted eraser block, open notch, baseline. Traced from the toolbar reference. */
export function InpaintIcon(props: ToolIconProps) {
  return (
    <svg viewBox="8 6 22 21" fill="none" {...box(props)}>
      <path fill="currentColor" d="M21 9.15 26.15 14.9 16.55 24.15 14.15 15.55Z" />
      <path
        d="M13.25 17.9 11.15 20.45 14.35 24.15H26.35"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mask: checker disc. Light and dim squares follow the toolbar color. */
export function MaskIcon(props: ToolIconProps) {
  const clipId = `mask-disc-${useId().replace(/:/g, '')}`;
  const origin = 2.7;
  const cell = 2.65;
  const cells = [];
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      const light = (row + col) % 2 === 0;
      cells.push(
        <rect
          key={`${row}-${col}`}
          x={origin + col * cell}
          y={origin + row * cell}
          width={cell + 0.02}
          height={cell + 0.02}
          fill="currentColor"
          opacity={light ? 1 : 0.38}
        />,
      );
    }
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" {...box(props)}>
      <defs>
        <clipPath id={clipId}>
          <circle cx="12" cy="12" r="9" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>{cells}</g>
    </svg>
  );
}
