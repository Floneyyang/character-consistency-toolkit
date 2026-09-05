import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAIImageProvider } from './openai-image-provider.mjs';
import { RunwayVideoProvider } from './runway-video-provider.mjs';
import { CharacterConsistencyService } from './service.mjs';
import { FileCharacterStore } from './store.mjs';
import { createWebApp } from './web-app.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number.parseInt(process.env.PORT || '4173', 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const store = new FileCharacterStore(
  resolve(PROJECT_ROOT, process.env.CHARACTER_LAB_DATA_DIR || 'data'),
);
const providerConfigured = Boolean(process.env.OPENAI_API_KEY);
const imageProvider = providerConfigured
  ? new OpenAIImageProvider({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_IMAGE_MODEL,
      quality: process.env.OPENAI_IMAGE_QUALITY,
    })
  : null;
const videoProviderConfigured = Boolean(process.env.RUNWAYML_API_SECRET);
const videoProvider = videoProviderConfigured
  ? new RunwayVideoProvider({
      apiKey: process.env.RUNWAYML_API_SECRET,
      model: process.env.RUNWAYML_VIDEO_MODEL,
    })
  : null;
const service = new CharacterConsistencyService({ store, imageProvider, videoProvider });
const handler = createWebApp({
  service,
  providerConfigured,
  videoProviderConfigured,
  webDirectory: resolve(PROJECT_ROOT, 'web'),
});
const server = createServer((request, response) => {
  void handler(request, response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Character Consistency Lab: http://127.0.0.1:${port}`);
  if (!providerConfigured) {
    console.log('Generation is disabled until OPENAI_API_KEY is added to .env.');
  }
  if (!videoProviderConfigured) {
    console.log('Animation is disabled until RUNWAYML_API_SECRET is added to .env.');
  }
});

const shutdown = () => server.close(() => process.exit());
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
