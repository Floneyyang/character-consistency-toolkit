import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { CharacterConsistencyService } from '../src/service.mjs';
import { FileCharacterStore } from '../src/store.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const MP4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

class FakeImageProvider {
  constructor() {
    this.calls = [];
  }

  async generate(request) {
    this.calls.push(request);
    return {
      bytes: PNG,
      mimeType: 'image/png',
      provenance: {
        provider: 'fake',
        model: 'fake-image-v1',
        requestId: `request-${this.calls.length}`,
        startedAt: '2026-08-29T12:00:00.000Z',
        completedAt: '2026-08-29T12:00:01.000Z',
        parameters: { size: request.size, referenceCount: request.references.length },
        usage: null,
      },
    };
  }
}

class FakeVideoProvider {
  constructor() {
    this.calls = [];
    this.status = 'PENDING';
  }

  async create(request) {
    this.calls.push(request);
    return {
      taskId: '12345678-1234-1234-1234-123456789abc',
      provenance: {
        provider: 'fake-video',
        model: 'fake-video-v1',
        requestId: '12345678-1234-1234-1234-123456789abc',
        startedAt: '2026-08-29T12:00:00.000Z',
        parameters: { ratio: request.ratio, duration: request.duration },
      },
    };
  }

  async retrieve() {
    return {
      status: this.status,
      outputUrl: this.status === 'SUCCEEDED' ? 'https://example.test/video.mp4' : null,
      failure: null,
      completedAt: '2026-08-29T12:00:03.000Z',
    };
  }

  async download() {
    return { bytes: MP4, mimeType: 'video/mp4' };
  }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'character-lab-test-'));
  const approvedPath = join(directory, 'approved.png');
  const photoPath = join(directory, 'photo.jpg');
  await writeFile(approvedPath, PNG);
  await writeFile(photoPath, JPEG);
  const store = new FileCharacterStore(join(directory, 'data'));
  const provider = new FakeImageProvider();
  const videoProvider = new FakeVideoProvider();
  const service = new CharacterConsistencyService({
    store,
    imageProvider: provider,
    videoProvider,
    clock: () => new Date('2026-08-29T12:00:02.000Z'),
  });
  return { directory, approvedPath, photoPath, store, provider, videoProvider, service };
}

test('creates a canonical sheet with explicit primary and secondary references', async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));

  const character = await context.service.createCharacter({
    name: '  Mina  ',
    approvedImagePath: context.approvedPath,
    supportingPhotoPath: context.photoPath,
  });

  assert.equal(character.name, 'Mina');
  assert.equal(context.provider.calls.length, 1);
  assert.equal(context.provider.calls[0].size, '1536x1024');
  assert.deepEqual(
    context.provider.calls[0].references.map((reference) => reference.role),
    ['approved-character', 'supporting-photo'],
  );
  assert.match(context.provider.calls[0].prompt, /secondary evidence/);
  assert.equal(character.identity.sources.length, 2);
  assert.equal(character.identity.sources[0].role, 'approved-character');
  assert.equal(character.identity.sources[1].role, 'supporting-photo');
  assert.equal(character.identity.sources[0].originalName, undefined);
  assert.equal(character.identity.canonicalSheet.path, 'assets/canonical/canonical-sheet.png');
  assert.equal(character.identity.generation.prompt.version, 'v1');

  const persisted = await context.store.getCharacter(character.id);
  assert.deepEqual(persisted, character);
  const sheet = await readFile(
    join(context.store.characterDirectory(character.id), character.identity.canonicalSheet.path),
  );
  assert.deepEqual(sheet, PNG);
});

test('creates a variation from the canonical sheet only', async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  const character = await context.service.createCharacter({
    name: 'Mina',
    approvedImagePath: context.approvedPath,
    supportingPhotoPath: context.photoPath,
  });

  const variation = await context.service.createVariation({
    characterId: character.id,
    brief: 'A winter explorer edition in a red technical coat.',
  });

  assert.equal(context.provider.calls.length, 2);
  assert.equal(context.provider.calls[1].size, '1024x1536');
  assert.deepEqual(
    context.provider.calls[1].references.map((reference) => reference.role),
    ['canonical-sheet'],
  );
  assert.match(context.provider.calls[1].prompt, /winter explorer edition/);
  assert.equal(variation.generation.references[0].role, 'canonical-sheet');
  const persisted = await context.store.getCharacter(character.id);
  assert.equal(persisted.variations.length, 1);
  assert.equal(persisted.variations[0].id, variation.id);
});

test('creates a canonical sheet directly from in-memory image bytes', async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));

  const character = await context.service.createCharacterFromImages({
    name: 'Mina',
    approvedImage: PNG,
  });

  assert.equal(character.name, 'Mina');
  assert.deepEqual(
    context.provider.calls[0].references.map((reference) => reference.role),
    ['approved-character'],
  );
  assert.equal(character.identity.sources[0].mimeType, 'image/png');
});

test('creates a photo-first sheet with source-photo provenance', async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));

  const character = await context.service.createCharacterSheetFromPhoto({
    name: 'Mina',
    photo: PNG,
    outfitDirection: 'A tailored navy suit with silver loafers.',
  });

  assert.deepEqual(
    context.provider.calls[0].references.map((reference) => reference.role),
    ['source-photo'],
  );
  assert.equal(character.identity.sources[0].role, 'source-photo');
  assert.equal(character.identity.generation.prompt.id, 'photo-character-sheet');
  assert.equal(character.identity.generation.prompt.version, 'v3');
  assert.deepEqual(character.identity.creationInputs, {
    outfitDirection: 'A tailored navy suit with silver loafers.',
  });
  assert.match(
    context.provider.calls[0].prompt,
    /one horizontal frame containing exactly three equal vertical panels/,
  );
  assert.match(context.provider.calls[0].prompt, /Reference image 1 is the sole visual identity authority/);
  assert.match(context.provider.calls[0].prompt, /Do not beautify/);
  assert.match(context.provider.calls[0].prompt, /tailored navy suit/);
  assert.match(context.provider.calls[0].prompt, /subject remains fully clothed/);
  assert.doesNotMatch(context.provider.calls[0].prompt, /overrides clothing|Ignore any part/);
  assert.match(
    context.provider.calls[0].prompt,
    /same outfit, footwear, and wearable details must appear unchanged/,
  );
  assert.match(context.provider.calls[0].prompt, /18% gray seamless background/);
});

test('preserves source wardrobe when no outfit direction is supplied', async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));

  const character = await context.service.createCharacterSheetFromPhoto({
    name: 'Mina',
    photo: PNG,
  });

  assert.deepEqual(character.identity.creationInputs, { outfitDirection: null });
  assert.match(context.provider.calls[0].prompt, /No wardrobe direction was supplied/);
  assert.match(context.provider.calls[0].prompt, /Preserve the visible clothing/);
});

test('creates and completes an animation derived only from the canonical sheet', async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  const character = await context.service.createCharacterSheetFromPhoto({
    name: 'Mina',
    photo: PNG,
  });

  const animation = await context.service.startAnimation({
    characterId: character.id,
    brief: 'She turns toward camera and smiles as her coat moves in the wind.',
  });

  assert.equal(animation.status, 'PENDING');
  assert.equal(context.provider.calls.length, 2);
  assert.deepEqual(
    context.provider.calls[1].references.map((reference) => reference.role),
    ['canonical-sheet'],
  );
  assert.equal(context.provider.calls[1].size, '1536x1024');
  assert.match(context.provider.calls[1].prompt, /exactly one character/);
  assert.equal(context.videoProvider.calls.length, 1);
  assert.equal(context.videoProvider.calls[0].duration, 5);
  assert.equal(context.videoProvider.calls[0].ratio, '1280:720');
  assert.match(context.videoProvider.calls[0].prompt, /turns toward camera/);

  context.videoProvider.status = 'SUCCEEDED';
  const completed = await context.service.refreshAnimation({
    characterId: character.id,
    animationId: animation.id,
  });
  assert.equal(completed.status, 'SUCCEEDED');
  assert.equal(completed.video.asset.mimeType, 'video/mp4');
  const storedVideo = await context.service.getAnimationVideo({
    characterId: character.id,
    animationId: animation.id,
  });
  assert.deepEqual(storedVideo.bytes, MP4);
  const persisted = await context.store.getCharacter(character.id);
  assert.equal(persisted.animations.length, 1);
  assert.equal(persisted.animations[0].video.generation.provider, 'fake-video');
});

test('rejects an invalid animation brief before paid generation', async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  const character = await context.service.createCharacterSheetFromPhoto({
    name: 'Mina',
    photo: PNG,
  });

  await assert.rejects(
    () => context.service.startAnimation({ characterId: character.id, brief: 'x' }),
    /3 to 500 characters/,
  );
  assert.equal(context.provider.calls.length, 1);
  assert.equal(context.videoProvider.calls.length, 0);
});

test('rejects an outfit direction longer than 500 characters before generation', async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      context.service.createCharacterSheetFromPhoto({
        name: 'Mina',
        photo: PNG,
        outfitDirection: 'x'.repeat(501),
      }),
    /no more than 500 characters/,
  );
  assert.equal(context.provider.calls.length, 0);
  assert.deepEqual(await context.store.listCharacters(), []);
});

test('permanently deletes the character directory', async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  const character = await context.service.createCharacter({
    name: 'Mina',
    approvedImagePath: context.approvedPath,
  });

  await context.service.deleteCharacter(character.id);

  await assert.rejects(() => context.store.getCharacter(character.id), { code: 'ENOENT' });
});

test('removes staged source assets if generation fails', async (t) => {
  const context = await fixture();
  t.after(() => rm(context.directory, { recursive: true, force: true }));
  context.provider.generate = async () => {
    throw new Error('provider failed');
  };

  await assert.rejects(
    () =>
      context.service.createCharacter({
        name: 'Mina',
        approvedImagePath: context.approvedPath,
      }),
    /provider failed/,
  );
  assert.deepEqual(await context.store.listCharacters(), []);
});
