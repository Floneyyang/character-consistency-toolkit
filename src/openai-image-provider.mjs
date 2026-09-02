import { assertImage, extensionForMimeType } from './domain.mjs';

const DEFAULT_BASE_URL = 'https://api.openai.com';
const DEFAULT_MODEL = 'gpt-image-2-2026-04-21';
const DEFAULT_QUALITY = 'medium';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;
const ALLOWED_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024']);
const ALLOWED_QUALITIES = new Set(['low', 'medium', 'high']);

export class ImageProviderError extends Error {
  constructor(kind, message, options) {
    super(message, options);
    this.name = 'ImageProviderError';
    this.kind = kind;
  }
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const normalized = value.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    return null;
  }
  const bytes = Buffer.from(normalized, 'base64');
  return bytes.length > 0 ? bytes : null;
}

async function parseProviderError(response) {
  let signal = '';
  try {
    signal = JSON.stringify(await response.json()).toLowerCase();
  } catch {
    // Provider error bodies are not guaranteed to be JSON.
  }
  if (response.status === 401 || response.status === 403) {
    return new ImageProviderError('configuration', 'OpenAI image access failed.');
  }
  if (response.status === 429) {
    return new ImageProviderError('rate-limited', 'OpenAI rate-limited the request.');
  }
  if (/moderat|safety|policy|content[_ -]?violation/.test(signal)) {
    return new ImageProviderError('moderated', 'OpenAI blocked the image request.');
  }
  if (
    /input[_ -]?image|reference[_ -]?image|image[_ -]?(?:decode|format|input)|invalid[_ -]?image|unsupported[_ -]?image/.test(
      signal,
    ) &&
    response.status < 500
  ) {
    return new ImageProviderError('invalid-reference', 'OpenAI rejected a reference image.');
  }
  if (response.status >= 500) {
    return new ImageProviderError('unavailable', 'OpenAI image generation is unavailable.');
  }
  return new ImageProviderError('invalid-request', 'OpenAI rejected the image request.');
}

export class OpenAIImageProvider {
  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    quality = DEFAULT_QUALITY,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImplementation = fetch,
  }) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required.');
    if (!ALLOWED_QUALITIES.has(quality)) {
      throw new Error('OPENAI_IMAGE_QUALITY must be low, medium, or high.');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Provider timeout must be a positive number.');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.quality = quality;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.fetchImplementation = fetchImplementation;
  }

  async generate({ prompt, references, size }) {
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new ImageProviderError('invalid-request', 'Image prompt is required.');
    }
    if (!Array.isArray(references) || references.length < 1 || references.length > 8) {
      throw new ImageProviderError('invalid-request', 'One to eight ordered references are required.');
    }
    if (!ALLOWED_SIZES.has(size)) {
      throw new ImageProviderError('invalid-request', 'Image size is unsupported.');
    }

    const body = new FormData();
    body.append('model', this.model);
    body.append('prompt', prompt);
    body.append('size', size);
    body.append('quality', this.quality);
    body.append('output_format', 'png');
    references.forEach((reference, index) => {
      const mimeType = assertImage(reference.bytes, `Reference ${index + 1}`);
      body.append(
        'image[]',
        new Blob([reference.bytes], { type: mimeType }),
        `reference-${index + 1}.${extensionForMimeType(mimeType)}`,
      );
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = new Date().toISOString();
    try {
      const response = await this.fetchImplementation(`${this.baseUrl}/v1/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw await parseProviderError(response);

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new ImageProviderError('invalid-response', 'OpenAI returned non-JSON data.', {
          cause: error,
        });
      }
      const bytes = decodeBase64(payload?.data?.[0]?.b64_json);
      let mimeType = null;
      try {
        mimeType = bytes ? assertImage(bytes, 'Generated image') : null;
      } catch {
        // Translate malformed provider output into a stable public error below.
      }
      if (!bytes || mimeType !== 'image/png') {
        throw new ImageProviderError('invalid-response', 'OpenAI returned invalid PNG data.');
      }

      return {
        bytes,
        mimeType,
        provenance: {
          provider: 'openai',
          model: this.model,
          requestId: response.headers.get('x-request-id'),
          startedAt,
          completedAt: new Date().toISOString(),
          parameters: {
            quality: this.quality,
            size,
            outputFormat: 'png',
            referenceCount: references.length,
          },
          usage: payload.usage ?? null,
        },
      };
    } catch (error) {
      if (error instanceof ImageProviderError) throw error;
      if (error?.name === 'AbortError') {
        throw new ImageProviderError('timeout', 'OpenAI image generation timed out.', {
          cause: error,
        });
      }
      throw new ImageProviderError(
        'outcome-unknown',
        'The OpenAI request outcome is unknown.',
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
