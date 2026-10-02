/**
 * Which URL the loupe <img> should show.
 *
 * Unadjusted RAW library thumbs are the camera's embedded JPEG: different crop
 * and colour than the GPU develop. Showing them first then swapping to the
 * 4096 px preview looks like a zoom onto another picture.
 */
export function loupeImageSrc(opts: {
  previewUrl: string | undefined;
  thumbUrl: string | undefined;
  isRaw: boolean;
  isEdited: boolean;
}): string | undefined {
  if (opts.previewUrl) return opts.previewUrl;
  // RAW library thumbs are the camera JPEG (or a 720 px stand-in): different crop
  // than the GPU develop, so they must not paint first.
  if (opts.isRaw) return undefined;
  return opts.thumbUrl;
}
