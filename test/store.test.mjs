import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { FileCharacterStore } from '../src/store.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('rejects asset path traversal', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'character-lab-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FileCharacterStore(directory);
  const id = 'character-12345678';
  await store.createCharacterDirectory(id);

  await assert.rejects(() => store.writeImage(id, '../escape.png', PNG), /path is invalid/);
});

test('refuses to overwrite immutable assets', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'character-lab-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FileCharacterStore(directory);
  const id = 'character-12345678';
  await store.createCharacterDirectory(id);
  await store.writeImage(id, 'assets/canonical/sheet.png', PNG);

  await assert.rejects(
    () => store.writeImage(id, 'assets/canonical/sheet.png', PNG),
    { code: 'EEXIST' },
  );
});
