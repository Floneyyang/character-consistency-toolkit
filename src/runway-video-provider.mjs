import { assertId, assertImage, assertMp4 } from './domain.mjs';

const DEFAULT_BASE_URL = 'https://api.dev.runwayml.com/v1';
const API_VERSION = '2024-11-06';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 2 * 60_000;

export class VideoProviderError extends Error {
  constructor(kind, message, options = {}) {
    super(message, options);
    this.name = 'VideoProviderError';
    this.kind = kind;
  }
}

function errorKind(status, payload) {
  const message = JSON.stringify(payload ?? '').toLowerCase();
  if (status === 401 || status === 403) return 'configuration';
  if (status === 429) return 'rate-limited';
  if (message.includes('moderation') || message.includes('safety')) return 'moderated';
  if (status >= 400 && status < 500) return 'invalid-request';
  return 'unavailable';
}

export class RunwayVideoProvider {
  constructor({
    apiKey,
    model = 'gen4_turbo',
    fetchImpl = globalThis.fetch,
    baseUrl = DEFAULT_BASE_URL,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    downloadTimeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  }) {
    if (!apiKey) throw new VideoProviderError('configuration', 'Runway API key is missing.');
    if (model !== 'gen4_turbo') {
      throw new VideoProviderError('configuration', 'RUNWAYML_VIDEO_MODEL must be gen4_turbo.');
    }
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new Error('Runway request timeout must be positive.');
    }
    if (!Number.isFinite(downloadTimeoutMs) || downloadTimeoutMs <= 0) {
      throw new Error('Runway download timeout must be positive.');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.downloadTimeoutMs = downloadTimeoutMs;
  }

  async #request(url, options, { timeoutMs, mutation = false } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await this.fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (cause) {
      const timedOut = cause?.name === 'AbortError';
      const kind = mutation ? 'outcome-unknown' : timedOut ? 'timeout' : 'unavailable';
      throw new VideoProviderError(kind, 'Runway request did not complete locally.', { cause });
    } finally {
      clearTimeout(timeout);
    }
    return response;
  }

  async #api(path, options = {}, { mutation = false } = {}) {
    const response = await this.#request(
      `${this.baseUrl}${path}`,
      {
        ...options,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'x-runway-version': API_VERSION,
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
      },
      { timeoutMs: this.requestTimeoutMs, mutation },
    );
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text.slice(0, 500) };
      }
    }
    if (!response.ok) {
      throw new VideoProviderError(
        errorKind(response.status, payload),
        `Runway request failed with status ${response.status}.`,
      );
    }
    return payload;
  }

  async #uploadImage(bytes, mimeType) {
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
    const upload = await this.#api('/uploads', {
      method: 'POST',
      body: JSON.stringify({ filename: `animation-keyframe.${extension}`, type: 'ephemeral' }),
    });
    if (!upload?.uploadUrl || !upload?.runwayUri || !upload?.fields) {
      throw new VideoProviderError('unavailable', 'Runway upload response is incomplete.');
    }
    const form = new FormData();
    for (const [key, value] of Object.entries(upload.fields)) form.append(key, String(value));
    form.append('file', new Blob([bytes], { type: mimeType }), `animation-keyframe.${extension}`);
    const response = await this.#request(
      upload.uploadUrl,
      { method: 'POST', body: form },
      { timeoutMs: this.requestTimeoutMs },
    );
    if (!response.ok) {
      throw new VideoProviderError('unavailable', `Runway upload failed with status ${response.status}.`);
    }
    return upload.runwayUri;
  }

  async create({ firstFrame, prompt, ratio = '1280:720', duration = 5 }) {
    const mimeType = assertImage(firstFrame, 'Animation first frame');
    const promptImage = await this.#uploadImage(firstFrame, mimeType);
    const startedAt = new Date().toISOString();
    const task = await this.#api(
      '/image_to_video',
      {
        method: 'POST',
        body: JSON.stringify({
          model: this.model,
          promptImage,
          promptText: prompt,
          ratio,
          duration,
        }),
      },
      { mutation: true },
    );
    if (!task?.id) throw new VideoProviderError('unavailable', 'Runway task ID is missing.');
    return {
      taskId: task.id,
      provenance: {
        provider: 'runway',
        model: this.model,
        requestId: task.id,
        startedAt,
        parameters: { ratio, duration },
      },
    };
  }

  async retrieve(taskId) {
    assertId(`task-${taskId}`, 'Provider task ID');
    const task = await this.#api(`/tasks/${encodeURIComponent(taskId)}`);
    const status = String(task?.status || '').toUpperCase();
    if (!['PENDING', 'THROTTLED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED'].includes(status)) {
      throw new VideoProviderError('unavailable', 'Runway returned an unknown task status.');
    }
    return {
      status,
      outputUrl: status === 'SUCCEEDED' ? task?.output?.[0] ?? null : null,
      failureCode: status === 'FAILED' ? task?.failureCode ?? null : null,
      failureCategory:
        status === 'FAILED'
          ? /^SAFETY\./.test(String(task?.failureCode ?? '')) ||
            /moderation|safety/i.test(String(task?.failure ?? ''))
            ? 'moderated'
            : 'provider-failed'
          : status === 'CANCELED'
            ? 'canceled'
            : null,
      completedAt: task?.updatedAt ?? task?.createdAt ?? null,
    };
  }

  async download(outputUrl) {
    if (typeof outputUrl !== 'string' || !outputUrl.startsWith('https://')) {
      throw new VideoProviderError('unavailable', 'Runway output URL is invalid.');
    }
    const response = await this.#request(
      outputUrl,
      {},
      { timeoutMs: this.downloadTimeoutMs },
    );
    if (!response.ok) {
      throw new VideoProviderError('unavailable', `Runway output download failed with status ${response.status}.`);
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 100 * 1024 * 1024) {
      throw new VideoProviderError('unavailable', 'Runway output exceeds the local video limit.');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    let mimeType;
    try {
      mimeType = assertMp4(bytes, 'Runway output');
    } catch (cause) {
      throw new VideoProviderError('unavailable', 'Runway returned an invalid video.', {
        cause,
      });
    }
    return { bytes, mimeType };
  }
}
