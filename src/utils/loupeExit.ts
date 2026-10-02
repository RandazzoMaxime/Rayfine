/** Click hit the letterbox around the photo, not the image itself. */
export function isLoupeLetterboxClick(opts: {
  target: unknown;
  stage: unknown;
  zoom: number;
}): boolean {
  return opts.stage != null && opts.target === opts.stage && opts.zoom <= 1.01;
}

/** Library loupe: Escape returns to the grid without dropping the selection. */
export function escapeReturnsLoupeToGrid(opts: {
  selectedImage: unknown;
  libraryDisplayMode: string | undefined | null;
}): boolean {
  return !opts.selectedImage && opts.libraryDisplayMode === 'loupe';
}
