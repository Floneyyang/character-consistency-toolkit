import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import {
  assertCharacterManifest,
  assertId,
  assertImage,
  assertMp4,
  extensionForMimeType,
  sha256,
} from './domain.mjs';

function assertSafeRelativePath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    isAbsolute(value) ||
    normalize(value) !== value ||
    value.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error('Asset path is invalid.');
  }
  return value;
}

export class FileCharacterStore {
  constructor(rootDirectory) {
    this.rootDirectory = resolve(rootDirectory);
    this.charactersDirectory = join(this.rootDirectory, 'characters');
  }

  async initialize() {
    await mkdir(this.charactersDirectory, { recursive: true });
  }

  characterDirectory(characterId) {
    return join(this.charactersDirectory, assertId(characterId, 'Character ID'));
  }

  async createCharacterDirectory(characterId) {
    await this.initialize();
    await mkdir(this.characterDirectory(characterId), { recursive: false });
  }

  async deleteCharacter(characterId) {
    await rm(this.characterDirectory(characterId), {
      recursive: true,
      force: false,
    });
  }

  async writeImage(characterId, relativePath, bytes) {
    const mimeType = assertImage(bytes);
    const safePath = assertSafeRelativePath(relativePath);
    const absolutePath = join(this.characterDirectory(characterId), safePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes, { flag: 'wx' });
    return {
      path: safePath,
      mimeType,
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
  }

  async ingestSourceImageBytes(characterId, role, bytes) {
    const mimeType = assertImage(bytes, `${role} image`);
    const extension = extensionForMimeType(mimeType);
    const asset = await this.writeImage(
      characterId,
      `assets/sources/${role}.${extension}`,
      bytes,
    );
    return { ...asset, role, bytesContent: bytes };
  }

  async readImage(characterId, relativePath) {
    const safePath = assertSafeRelativePath(relativePath);
    const bytes = await readFile(join(this.characterDirectory(characterId), safePath));
    const mimeType = assertImage(bytes);
    return { bytes, mimeType };
  }

  async deleteImage(characterId, relativePath) {
    const safePath = assertSafeRelativePath(relativePath);
    await rm(join(this.characterDirectory(characterId), safePath), { force: false });
  }

  async writeVideo(characterId, relativePath, bytes) {
    const mimeType = assertMp4(bytes);
    const safePath = assertSafeRelativePath(relativePath);
    const absolutePath = join(this.characterDirectory(characterId), safePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes, { flag: 'wx' });
    return {
      path: safePath,
      mimeType,
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
  }

  async readVideo(characterId, relativePath) {
    const safePath = assertSafeRelativePath(relativePath);
    const bytes = await readFile(join(this.characterDirectory(characterId), safePath));
    const mimeType = assertMp4(bytes);
    return { bytes, mimeType };
  }

  async deleteAnimation(characterId, animationId) {
    assertId(animationId, 'Animation ID');
    await rm(join(this.characterDirectory(characterId), 'assets', 'animations', animationId), {
      recursive: true,
      force: true,
    });
  }

  async writeManifest(manifest) {
    assertCharacterManifest(manifest);
    const directory = this.characterDirectory(manifest.id);
    const target = join(directory, 'manifest.json');
    const temporary = join(directory, `.manifest-${process.pid}-${Date.now()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporary, target);
  }

  async getCharacter(characterId) {
    const raw = await readFile(
      join(this.characterDirectory(characterId), 'manifest.json'),
      'utf8',
    );
    return assertCharacterManifest(JSON.parse(raw));
  }

  async listCharacters() {
    await this.initialize();
    const entries = await readdir(this.charactersDirectory, {
      withFileTypes: true,
    });
    const manifests = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        manifests.push(await this.getCharacter(entry.name));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return manifests.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }
}
