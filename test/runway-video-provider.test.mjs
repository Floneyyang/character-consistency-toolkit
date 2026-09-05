import assert from 'node:assert/strict';
import test from 'node:test';
import { RunwayVideoProvider, VideoProviderError } from '../src/runway-video-provider.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const MP4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

test('uploads a first frame and creates a cost-controlled Runway task', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/uploads')) {
      return new Response(
        JSON.stringify({
          uploadUrl: 'https://uploads.example.test',
          runwayUri: 'runway://asset-1',
          fields: { key: 'value' },
        }),
        { status: 200 },
      );
    }
    if (url === 'https://uploads.example.test') return new Response(null, { status: 204 });
    if (url.endsWith('/image_to_video')) {
      return new Response(JSON.stringify({ id: '12345678-1234-1234-1234-123456789abc' }), {
        status: 200,
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const provider = new RunwayVideoProvider({ apiKey: 'secret', fetchImpl });

  const result = await provider.create({
    firstFrame: PNG,
    prompt: 'She turns and smiles.',
    ratio: '1280:720',
    duration: 5,
  });

  assert.equal(result.taskId, '12345678-1234-1234-1234-123456789abc');
  assert.equal(result.provenance.provider, 'runway');
  assert.equal(result.provenance.model, 'gen4_turbo');
  const createBody = JSON.parse(requests[2].options.body);
  assert.deepEqual(createBody, {
    model: 'gen4_turbo',
    promptImage: 'runway://asset-1',
    promptText: 'She turns and smiles.',
    ratio: '1280:720',
    duration: 5,
  });
  assert.equal(requests[0].options.headers.authorization, 'Bearer secret');
  assert.equal(requests[0].options.headers['x-runway-version'], '2024-11-06');
});

test('retrieves completed tasks and validates downloaded MP4 output', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/tasks/')) {
      return new Response(
        JSON.stringify({
          status: 'SUCCEEDED',
          output: ['https://outputs.example.test/video.mp4'],
          updatedAt: '2026-09-04T12:00:00.000Z',
        }),
        { status: 200 },
      );
    }
    if (url === 'https://outputs.example.test/video.mp4') {
      return new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4' } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const provider = new RunwayVideoProvider({ apiKey: 'secret', fetchImpl });

  const task = await provider.retrieve('12345678-1234-1234-1234-123456789abc');
  const output = await provider.download(task.outputUrl);

  assert.equal(task.status, 'SUCCEEDED');
  assert.deepEqual(output.bytes, MP4);
});

test('maps authentication failures without leaking provider details', async () => {
  const provider = new RunwayVideoProvider({
    apiKey: 'secret',
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'sensitive provider detail' }), { status: 401 }),
  });

  await assert.rejects(
    () => provider.retrieve('12345678-1234-1234-1234-123456789abc'),
    (error) => {
      assert.ok(error instanceof VideoProviderError);
      assert.equal(error.kind, 'configuration');
      assert.doesNotMatch(error.message, /sensitive/);
      return true;
    },
  );
});
