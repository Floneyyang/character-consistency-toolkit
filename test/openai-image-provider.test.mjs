import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageProviderError, OpenAIImageProvider } from '../src/openai-image-provider.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('sends ordered references to the image edits endpoint and records provenance', async () => {
  let capturedUrl;
  let capturedRequest;
  const provider = new OpenAIImageProvider({
    apiKey: 'test-key',
    model: 'gpt-image-test',
    quality: 'medium',
    baseUrl: 'https://example.test/',
    fetchImplementation: async (url, request) => {
      capturedUrl = url;
      capturedRequest = request;
      return new Response(
        JSON.stringify({
          data: [{ b64_json: PNG.toString('base64') }],
          usage: { input_tokens: 12, output_tokens: 34 },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'request-123',
          },
        },
      );
    },
  });

  const result = await provider.generate({
    prompt: 'Create a sheet.',
    references: [
      { role: 'approved-character', bytes: PNG, mimeType: 'image/png' },
      { role: 'supporting-photo', bytes: PNG, mimeType: 'image/png' },
    ],
    size: '1536x1024',
  });

  assert.equal(capturedUrl, 'https://example.test/v1/images/edits');
  assert.equal(capturedRequest.method, 'POST');
  assert.equal(capturedRequest.headers.Authorization, 'Bearer test-key');
  assert.equal(capturedRequest.body.get('model'), 'gpt-image-test');
  assert.equal(capturedRequest.body.get('prompt'), 'Create a sheet.');
  assert.equal(capturedRequest.body.get('size'), '1536x1024');
  assert.equal(capturedRequest.body.get('output_format'), 'png');
  assert.deepEqual(
    capturedRequest.body.getAll('image[]').map((file) => file.name),
    ['reference-1.png', 'reference-2.png'],
  );
  assert.deepEqual(result.bytes, PNG);
  assert.equal(result.provenance.requestId, 'request-123');
  assert.equal(result.provenance.parameters.referenceCount, 2);
  assert.deepEqual(result.provenance.usage, { input_tokens: 12, output_tokens: 34 });
});

test('maps authentication failures without exposing provider response text', async () => {
  const provider = new OpenAIImageProvider({
    apiKey: 'secret-key',
    fetchImplementation: async () =>
      new Response(JSON.stringify({ error: { message: 'secret provider detail' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
  });

  await assert.rejects(
    () =>
      provider.generate({
        prompt: 'Create a sheet.',
        references: [{ role: 'approved-character', bytes: PNG }],
        size: '1536x1024',
      }),
    (error) =>
      error instanceof ImageProviderError &&
      error.kind === 'configuration' &&
      !error.message.includes('secret provider detail'),
  );
});

test('maps malformed image output to an invalid response', async () => {
  const provider = new OpenAIImageProvider({
    apiKey: 'test-key',
    fetchImplementation: async () =>
      new Response(JSON.stringify({ data: [{ b64_json: 'bm90LWFuLWltYWdl' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  await assert.rejects(
    () =>
      provider.generate({
        prompt: 'Create a sheet.',
        references: [{ role: 'approved-character', bytes: PNG }],
        size: '1536x1024',
      }),
    (error) => error instanceof ImageProviderError && error.kind === 'invalid-response',
  );
});
