import { createHash, randomUUID } from 'node:crypto';

const ID_PATTERN = /^[a-z][a-z0-9-]{7,80}$/;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export function assertId(value, label = 'ID') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function assertCharacterName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 1 || name.length > 100) {
    throw new Error('Character name must contain 1 to 100 characters.');
  }
  return name;
}

export function assertVariationBrief(value) {
  const brief = typeof value === 'string' ? value.trim() : '';
  if (brief.length < 3 || brief.length > 2_000) {
    throw new Error('Variation brief must contain 3 to 2,000 characters.');
  }
  return brief;
}

export function assertOutfitDirection(value) {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw new Error('Outfit direction must be text.');
  }
  const direction = value.trim();
  if (direction.length > 500) {
    throw new Error('Outfit direction must contain no more than 500 characters.');
  }
  return direction;
}

export function sha256(bytesOrText) {
  return createHash('sha256').update(bytesOrText).digest('hex');
}

export function decodeBase64Image(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const normalized = value.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    return null;
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const bytes = Buffer.from(padded, 'base64');
  return bytes.length > 0 ? bytes : null;
}

export function detectImageMimeType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (
    bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function assertImage(bytes, label = 'Image') {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error(`${label} is empty.`);
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`${label} exceeds the 25 MB limit.`);
  }
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType) {
    throw new Error(`${label} must be a PNG, JPEG, or WebP image.`);
  }
  return mimeType;
}

export function extensionForMimeType(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/png') return 'png';
  throw new Error(`Unsupported image MIME type: ${mimeType}`);
}

export function assertCharacterManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Character manifest is invalid.');
  }
  if (value.schemaVersion !== 1) {
    throw new Error('Character manifest schema is unsupported.');
  }
  assertId(value.id, 'Character ID');
  assertCharacterName(value.name);
  if (!value.identity || typeof value.identity !== 'object') {
    throw new Error('Character identity is missing.');
  }
  if (!Array.isArray(value.variations)) {
    throw new Error('Character variations are invalid.');
  }
  return value;
}
