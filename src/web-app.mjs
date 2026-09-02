import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { assertImage, decodeBase64Image } from './domain.mjs';
import { ImageProviderError } from './openai-image-provider.mjs';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_JSON_BYTES = 21 * 1024 * 1024;
const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/app.js', 'app.js'],
  ['/styles.css', 'styles.css'],
]);
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function setSecurityHeaders(response) {
  response.setHeader(
    'content-security-policy',
    "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-frame-options', 'DENY');
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'Choose an image smaller than 15 MB.');
  }
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_JSON_BYTES) {
      throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'Choose an image smaller than 15 MB.');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'The request body is invalid.');
  }
}

function publicGenerationError(error) {
  if (error instanceof HttpError) return error;
  if (error instanceof ImageProviderError) {
    if (error.kind === 'configuration') {
      return new HttpError(503, 'NOT_CONFIGURED', 'Add OPENAI_API_KEY to the local .env file.');
    }
    if (error.kind === 'rate-limited') {
      return new HttpError(429, 'RATE_LIMITED', 'The image provider is busy. Please try again shortly.');
    }
    if (error.kind === 'moderated') {
      return new HttpError(422, 'INPUT_REJECTED', 'The image provider rejected this input.');
    }
    if (error.kind === 'invalid-reference' || error.kind === 'invalid-request') {
      return new HttpError(422, 'INVALID_INPUT', 'The image provider could not use this image.');
    }
    if (error.kind === 'timeout') {
      return new HttpError(504, 'GENERATION_TIMEOUT', 'Generation took too long. Please try again.');
    }
    return new HttpError(503, 'GENERATION_UNAVAILABLE', 'Character-sheet generation is unavailable.');
  }
  if (error?.code === 'ENOENT') {
    return new HttpError(404, 'NOT_FOUND', 'The requested character sheet was not found.');
  }
  if (error instanceof Error && /image|character name/i.test(error.message)) {
    return new HttpError(400, 'INVALID_INPUT', error.message);
  }
  return new HttpError(500, 'INTERNAL_ERROR', 'The local server could not complete the request.');
}

export function createWebApp({ service, providerConfigured, webDirectory }) {
  return async function handleRequest(request, response) {
    setSecurityHeaders(response);
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        sendJson(response, 200, { ready: providerConfigured });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/characters') {
        if (!providerConfigured || !service) {
          throw new HttpError(503, 'NOT_CONFIGURED', 'Add OPENAI_API_KEY to the local .env file.');
        }
        if (!request.headers['content-type']?.startsWith('application/json')) {
          throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the upload as JSON.');
        }
        const payload = await readJsonBody(request);
        const bytes = decodeBase64Image(payload?.image?.base64);
        if (!bytes || bytes.length > MAX_UPLOAD_BYTES) {
          throw new HttpError(400, 'INVALID_IMAGE', 'Choose a PNG, JPEG, or WebP image smaller than 15 MB.');
        }
        const detectedMimeType = assertImage(bytes, 'Reference image');
        if (
          payload?.image?.mimeType &&
          payload.image.mimeType !== detectedMimeType
        ) {
          throw new HttpError(400, 'INVALID_IMAGE', 'The image content does not match its file type.');
        }
        const character = await service.createCharacterSheetFromPhoto({
          name: payload?.name || 'My Character',
          photo: bytes,
        });
        sendJson(response, 201, {
          character: {
            id: character.id,
            name: character.name,
            imageUrl: `/api/characters/${encodeURIComponent(character.id)}/canonical-sheet`,
          },
        });
        return;
      }

      const sheetMatch = url.pathname.match(
        /^\/api\/characters\/([^/]+)\/canonical-sheet$/,
      );
      if (request.method === 'GET' && sheetMatch) {
        if (!service) throw new HttpError(503, 'NOT_CONFIGURED', 'The local service is unavailable.');
        const sheet = await service.getCanonicalSheet(
          decodeURIComponent(sheetMatch[1]),
        );
        const etag = `"${sheet.sha256}"`;
        if (request.headers['if-none-match'] === etag) {
          response.statusCode = 304;
          response.end();
          return;
        }
        response.statusCode = 200;
        response.setHeader('content-type', sheet.mimeType);
        response.setHeader('content-length', sheet.bytes.length);
        response.setHeader('cache-control', 'private, max-age=31536000, immutable');
        response.setHeader('etag', etag);
        response.end(sheet.bytes);
        return;
      }

      if (request.method === 'GET' && STATIC_FILES.has(url.pathname)) {
        const filename = STATIC_FILES.get(url.pathname);
        const bytes = await readFile(join(webDirectory, filename));
        response.statusCode = 200;
        response.setHeader('content-type', CONTENT_TYPES[extname(filename)]);
        response.setHeader('cache-control', 'no-cache');
        response.end(bytes);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/favicon.ico') {
        response.statusCode = 204;
        response.end();
        return;
      }

      throw new HttpError(404, 'NOT_FOUND', 'This page was not found.');
    } catch (error) {
      const publicError = publicGenerationError(error);
      sendJson(response, publicError.status, {
        error: { code: publicError.code, message: publicError.message },
      });
    }
  };
}
