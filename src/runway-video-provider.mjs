import { assertId, assertImage, assertMp4 } from './domain.mjs';

const DEFAULT_BASE_URL = 'https://api.dev.runwayml.com/v1';
const API_VERSION = '2024-11-06';

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
  }) {
    if (!apiKey) throw new VideoProviderError('configuration', 'Runway API key is missing.');
    if (model !== 'gen4_turbo') {
      throw new VideoProviderError('configuration', 'RUNWAYML_VIDEO_MODEL must be gen4_turbo.');
    }
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
    this.apiKey = apiKey;
    this.model = model;
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async #api(path, options = {}) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'x-runway-version': API_VERSION,
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
      });
    } catch (cause) {
      throw new VideoProviderError('outcome-unknown', 'Runway request outcome is unknown.', {
        cause,
      });
    }
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
    let response;
    try {
      response = await this.fetch(upload.uploadUrl, { method: 'POST', body: form });
    } catch (cause) {
      throw new VideoProviderError('outcome-unknown', 'Runway upload outcome is unknown.', {
        cause,
      });
    }
    if (!response.ok) {
      throw new VideoProviderError('unavailable', `Runway upload failed with status ${response.status}.`);
    }
    return upload.runwayUri;
  }

  async create({ firstFrame, prompt, ratio = '1280:720', duration = 5 }) {
    const mimeType = assertImage(firstFrame, 'Animation first frame');
    const promptImage = await this.#uploadImage(firstFrame, mimeType);
    const startedAt = new Date().toISOString();
    const task = await this.#api('/image_to_video', {
      method: 'POST',
      body: JSON.stringify({
        model: this.model,
        promptImage,
        promptText: prompt,
        ratio,
        duration,
      }),
    });
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
      failure: status === 'FAILED' ? task?.failure ?? task?.failureCode ?? null : null,
      completedAt: task?.updatedAt ?? task?.createdAt ?? null,
    };
  }

  async download(outputUrl) {
    if (typeof outputUrl !== 'string' || !outputUrl.startsWith('https://')) {
      throw new VideoProviderError('unavailable', 'Runway output URL is invalid.');
    }
    let response;
    try {
      response = await this.fetch(outputUrl);
    } catch (cause) {
      throw new VideoProviderError('unavailable', 'Runway output could not be downloaded.', {
        cause,
      });
    }
    if (!response.ok) {
      throw new VideoProviderError('unavailable', `Runway output download failed with status ${response.status}.`);
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 100 * 1024 * 1024) {
      throw new VideoProviderError('unavailable', 'Runway output exceeds the local video limit.');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const mimeType = assertMp4(bytes, 'Runway output');
    return { bytes, mimeType };
  }
}
