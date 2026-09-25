#!/usr/bin/env node
// Static + unit check of the shipped slider live-preview path (no GPU / no UI).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/hooks/useImageProcessing.ts'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

assert(src.includes('export function livePreviewInvokeFlags'), 'livePreviewInvokeFlags must be exported from shipped hook');
assert(
  /if \(isSliderDragging\)[\s\S]{0,400}applyAdjustments\(renderAdjustments, true/.test(src),
  'drag path must call applyAdjustments(..., true) while isSliderDragging',
);
assert(
  /currentResRef\.current = targetRes;\s*applyAdjustments\(renderAdjustments, false/.test(src),
  'release path must apply immediately, not only inside the idle timer',
);
assert(
  !/isSliderDragging\)[\s\S]{0,200}setTimeout\(\(\) => \{[\s\S]{0,80}applyAdjustments\(renderAdjustments, true/.test(
    src,
  ),
  'live drag apply must not be deferred to setTimeout',
);

const flagsSrc = src.slice(src.indexOf('export function livePreviewInvokeFlags'));
const fn = flagsSrc.slice(0, flagsSrc.indexOf('export function useImageProcessing'));
assert(fn.includes('computeWaveform: waveformVisible'), 'waveform/histogram stay live while dragging');
assert(!fn.includes('computeWaveform: !dragging'), 'analytics must not be gated off during drag');
assert(fn.includes('skipRoi: dragging'), 'ROI skipped while dragging');

console.log('live-preview path: drag applies immediately on wgpu flags; histogram/waveform live during drag');
process.exit(0);
