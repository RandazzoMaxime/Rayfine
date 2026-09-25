/** Soft-proof profile names for the CSS simulation shell (not full ICC). */
export const SOFT_PROOF_PROFILES = [
  'sRGB',
  'Display P3',
  'Adobe RGB (1998)',
  'ProPhoto RGB',
  'Rec. 2020',
  'Rec. 709',
  'Gray Gamma 1.8',
  'Gray Gamma 2.2',
  'Japan Color 2001 Coated',
  'Japan Color 2001 Uncoated',
  'US Web Coated (SWOP) v2',
  'US Web Uncoated v2',
  'Coated FOGRA39',
  'Coated FOGRA51',
  'Uncoated FOGRA29',
  'GRACoL 2006 Coated1v2',
  'ISO Coated v2 (ECI)',
  'PSO Coated v3',
  'PSO Uncoated v3',
  'Japan Web Coated (Ad)',
  'Web Coated SWOP 2006 Grade 3',
  'Generic CMYK Profile',
] as const;

export type SoftProofProfile = (typeof SOFT_PROOF_PROFILES)[number];

/** Approximate CSS filter for a named soft-proof profile (shell only). */
export function softProofCssFilter(
  profile: string,
  intent: string,
  simulatePaper: boolean,
): string | undefined {
  const p = profile || 'sRGB';
  const pl = p.toLowerCase();
  let f: string;
  if (pl.includes('p3')) f = 'saturate(1.08) contrast(1.02)';
  else if (pl.includes('adobe')) f = 'saturate(1.12) contrast(1.03)';
  else if (pl.includes('prophoto')) f = 'saturate(1.15) contrast(1.04) brightness(1.01)';
  else if (pl.includes('2020')) f = 'saturate(1.18) contrast(1.05)';
  else if (pl.includes('gray')) f = 'grayscale(1) contrast(1.02)';
  else if (pl.includes('709')) f = 'saturate(0.98) contrast(1.01)';
  else if (pl.includes('gamma 1.8')) f = 'grayscale(1) contrast(0.98) brightness(1.02)';
  else if (pl.includes('uncoated') || pl.includes('fogra29') || pl.includes('pso uncoated'))
    // Uncoated stock: softer contrast, warmer paper
    f = 'saturate(0.78) contrast(0.93) brightness(0.98) sepia(0.12)';
  else if (pl.includes('pso coated') || pl.includes('fogra51') || pl.includes('fogra39'))
    f = 'saturate(0.84) contrast(0.97) brightness(0.96) sepia(0.06)';
  else if (pl.includes('japan web') || pl.includes('web coated swop 2006'))
    f = 'saturate(0.8) contrast(0.95) brightness(0.97) sepia(0.1)';
  else if (
    pl.includes('japan') ||
    pl.includes('swop') ||
    pl.includes('fogra') ||
    pl.includes('gracol') ||
    pl.includes('eci') ||
    pl.includes('cmyk') ||
    pl.includes('uncoated') ||
    pl.includes('coated') ||
    pl.includes('pso')
  )
    // CMYK press shells: muted gamut + slight ink cast
    f = 'saturate(0.82) contrast(0.96) brightness(0.97) sepia(0.08)';
  else f = 'saturate(0.96) contrast(0.98)';

  if (intent === 'perceptual') f += ' contrast(0.97) saturate(0.98)';
  if (intent === 'absolute') f += ' brightness(0.94) contrast(1.04) saturate(1.02)';
  if (simulatePaper) f += ' brightness(0.97) sepia(0.06)';
  return f;
}
