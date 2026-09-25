#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rust = readFileSync(join(root, 'src-tauri/src/file_management.rs'), 'utf8');
const thumbs = readFileSync(join(root, 'src/hooks/useThumbnails.ts'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

assert(rust.includes('pub fn merge_thumbnail_queue'), 'queue merge is a shipped function');
assert(rust.includes('merge_thumbnail_queue(&mut queue, paths, 500, rotational)'), 'update_thumbnail_queue enqueues then returns');
assert(
  /cvar\.notify_all\(\);\s*Ok\(\(\)\)/.test(rust.slice(rust.indexOf('pub fn update_thumbnail_queue'))),
  'update_thumbnail_queue returns Ok after notify, does not generate thumbs',
);
assert(!/fn update_thumbnail_queue[\s\S]*generate_single_thumbnail/.test(rust.slice(rust.indexOf('pub fn update_thumbnail_queue'), rust.indexOf('pub fn update_thumbnail_queue') + 1200)), 'command must not generate thumbs inline');
assert(thumbs.includes('invoke(\'update_thumbnail_queue\''), 'frontend posts to the async queue');
assert(thumbs.includes('pendingQueueRef'), 'frontend batches visible paths without awaiting generation');

console.log('thumbnail queue: folder-open posts paths and returns; workers stay in background');
process.exit(0);
