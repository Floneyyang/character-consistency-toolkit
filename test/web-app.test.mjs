import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createWebApp } from '../src/web-app.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function startTestServer(options) {
  const handler = createWebApp({
    webDirectory: resolve(PROJECT_ROOT, 'web'),
    ...options,
  });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

test('serves the local upload interface and readiness state', async (t) => {
  const server = await startTestServer({ service: null, providerConfigured: false });
  t.after(server.close);

  const page = await fetch(`${server.baseUrl}/`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(html, /Drop your image here/);
  assert.match(html, /Create character sheet/);

  const health = await fetch(`${server.baseUrl}/api/health`);
  assert.deepEqual(await health.json(), { ready: false });
});

test('rejects generation cleanly when the API key is not configured', async (t) => {
  const server = await startTestServer({ service: null, providerConfigured: false });
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/api/characters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Mina', image: { base64: PNG.toString('base64') } }),
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'NOT_CONFIGURED',
      message: 'Add OPENAI_API_KEY to the local .env file.',
    },
  });
});

test('creates and serves a canonical sheet from an uploaded image', async (t) => {
  const calls = [];
  const service = {
    async createCharacterSheetFromPhoto(input) {
      calls.push(input);
      return { id: 'character-12345678', name: input.name };
    },
    async getCanonicalSheet() {
      return { bytes: PNG, mimeType: 'image/png', sha256: 'abc123' };
    },
  };
  const server = await startTestServer({ service, providerConfigured: true });
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/api/characters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Mina',
      image: { mimeType: 'image/png', base64: PNG.toString('base64') },
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'Mina');
  assert.deepEqual(calls[0].photo, PNG);
  assert.equal(
    payload.character.imageUrl,
    '/api/characters/character-12345678/canonical-sheet',
  );

  const image = await fetch(`${server.baseUrl}${payload.character.imageUrl}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('etag'), '"abc123"');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG);
});

test('rejects an upload whose declared type does not match its bytes', async (t) => {
  const service = {
    async createCharacterSheetFromPhoto() {
      throw new Error('must not be called');
    },
  };
  const server = await startTestServer({ service, providerConfigured: true });
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/api/characters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      image: { mimeType: 'image/jpeg', base64: PNG.toString('base64') },
    }),
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_IMAGE');
});
