import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { AppearanceId } from '../../utils/appearance';

function readAppearance(): AppearanceId {
  const fromDom = document.documentElement.dataset.appearance;
  if (fromDom === 'light' || fromDom === 'dark') return fromDom;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function useAppearanceId(): AppearanceId {
  const [id, setId] = useState<AppearanceId>(() =>
    typeof document === 'undefined' ? 'dark' : readAppearance(),
  );

  useEffect(() => {
    const sync = () => setId(readAppearance());
    sync();
    const onCustom = () => sync();
    window.addEventListener('rayfine:appearance', onCustom);
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance'] });
    return () => {
      window.removeEventListener('rayfine:appearance', onCustom);
      obs.disconnect();
    };
  }, []);

  return id;
}

const SRC: Record<AppearanceId, string> = {
  light: '/rayfine-logo-light.svg',
  dark: '/rayfine-logo-dark.svg',
};

export default function RayfineLogo({
  className,
  variant = 'auto',
  alt = 'Rayfine',
}: {
  className?: string;
  /** light = dark mark on cream; dark = inverted mark on black. auto follows the theme. */
  variant?: AppearanceId | 'auto';
  alt?: string;
}) {
  const appearance = useAppearanceId();
  const mode: AppearanceId = variant === 'auto' ? appearance : variant;
  return (
    <img
      src={SRC[mode]}
      alt={alt}
      draggable={false}
      className={clsx('select-none', className)}
    />
  );
}
