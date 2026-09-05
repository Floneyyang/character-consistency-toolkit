import { readFile } from 'node:fs/promises';
import {
  assertCharacterName,
  assertAnimationBrief,
  assertId,
  assertOutfitDirection,
  assertVariationBrief,
  createId,
} from './domain.mjs';
import {
  renderCanonicalPrompt,
  renderAnimationKeyframePrompt,
  renderAnimationMotionPrompt,
  renderPhotoCanonicalPrompt,
  renderVariationPrompt,
} from './prompt.mjs';

function publicAsset(asset) {
  const { bytesContent: _bytesContent, ...metadata } = asset;
  return metadata;
}

export class CharacterConsistencyService {
  constructor({ store, imageProvider, videoProvider = null, clock = () => new Date() }) {
    this.store = store;
    this.imageProvider = imageProvider;
    this.videoProvider = videoProvider;
    this.clock = clock;
  }

  async createCharacter({ name, approvedImagePath, supportingPhotoPath }) {
    if (typeof approvedImagePath !== 'string' || approvedImagePath.length === 0) {
      throw new Error('An approved character image path is required.');
    }
    const approvedImage = await readFile(approvedImagePath);
    const supportingPhoto = supportingPhotoPath
      ? await readFile(supportingPhotoPath)
      : null;
    return this.createCharacterFromImages({
      name,
      approvedImage,
      supportingPhoto,
    });
  }

  async createCharacterFromImages({ name, approvedImage, supportingPhoto }) {
    return this.#createCanonicalCharacter({
      name,
      primaryImage: approvedImage,
      primaryRole: 'approved-character',
      supportingPhoto,
      renderPrompt: (characterName) =>
        renderCanonicalPrompt(characterName, Boolean(supportingPhoto)),
    });
  }

  async createCharacterSheetFromPhoto({ name, photo, outfitDirection }) {
    const normalizedOutfitDirection = assertOutfitDirection(outfitDirection);
    return this.#createCanonicalCharacter({
      name,
      primaryImage: photo,
      primaryRole: 'source-photo',
      supportingPhoto: null,
      renderPrompt: (characterName) =>
        renderPhotoCanonicalPrompt(characterName, normalizedOutfitDirection),
      creationInputs: {
        outfitDirection: normalizedOutfitDirection || null,
      },
    });
  }

  async #createCanonicalCharacter({
    name,
    primaryImage,
    primaryRole,
    supportingPhoto,
    renderPrompt,
    creationInputs = null,
  }) {
    const characterName = assertCharacterName(name);
    if (!Buffer.isBuffer(primaryImage)) {
      throw new Error('A primary character image is required.');
    }
    const characterId = createId('character');
    await this.store.createCharacterDirectory(characterId);

    try {
      const primary = await this.store.ingestSourceImageBytes(
        characterId,
        primaryRole,
        primaryImage,
      );
      const supporting = supportingPhoto
        ? await this.store.ingestSourceImageBytes(
            characterId,
            'supporting-photo',
            supportingPhoto,
          )
        : null;
      const prompt = await renderPrompt(characterName);
      const references = [
        {
          role: primaryRole,
          bytes: primary.bytesContent,
          mimeType: primary.mimeType,
          sha256: primary.sha256,
        },
        ...(supporting
          ? [
              {
                role: 'supporting-photo',
                bytes: supporting.bytesContent,
                mimeType: supporting.mimeType,
                sha256: supporting.sha256,
              },
            ]
          : []),
      ];
      const result = await this.imageProvider.generate({
        prompt: prompt.text,
        references,
        size: '1536x1024',
      });
      const canonicalSheet = await this.store.writeImage(
        characterId,
        'assets/canonical/canonical-sheet.png',
        result.bytes,
      );
      const now = this.clock().toISOString();
      const manifest = {
        schemaVersion: 1,
        id: characterId,
        name: characterName,
        createdAt: now,
        updatedAt: now,
        identity: {
          ...(creationInputs ? { creationInputs } : {}),
          sources: [
            publicAsset(primary),
            ...(supporting ? [publicAsset(supporting)] : []),
          ],
          canonicalSheet,
          generation: {
            prompt,
            references: references.map(({ role, mimeType, sha256 }) => ({
              role,
              mimeType,
              sha256,
            })),
            ...result.provenance,
          },
        },
        variations: [],
        animations: [],
      };
      await this.store.writeManifest(manifest);
      return manifest;
    } catch (error) {
      await this.store.deleteCharacter(characterId).catch(() => {});
      throw error;
    }
  }

  async createVariation({ characterId, brief }) {
    assertId(characterId, 'Character ID');
    const variationBrief = assertVariationBrief(brief);
    const manifest = await this.store.getCharacter(characterId);
    const prompt = await renderVariationPrompt(manifest.name, variationBrief);
    const canonical = await this.store.readImage(
      characterId,
      manifest.identity.canonicalSheet.path,
    );
    const result = await this.imageProvider.generate({
      prompt: prompt.text,
      references: [
        {
          role: 'canonical-sheet',
          bytes: canonical.bytes,
          mimeType: canonical.mimeType,
          sha256: manifest.identity.canonicalSheet.sha256,
        },
      ],
      size: '1024x1536',
    });
    const variationId = createId('variation');
    const asset = await this.store.writeImage(
      characterId,
      `assets/variations/${variationId}.png`,
      result.bytes,
    );
    const now = this.clock().toISOString();
    const variation = {
      id: variationId,
      brief: variationBrief,
      createdAt: now,
      asset,
      generation: {
        prompt,
        references: [
          {
            role: 'canonical-sheet',
            mimeType: canonical.mimeType,
            sha256: manifest.identity.canonicalSheet.sha256,
          },
        ],
        ...result.provenance,
      },
    };
    manifest.variations.push(variation);
    manifest.updatedAt = now;
    try {
      await this.store.writeManifest(manifest);
    } catch (error) {
      // Do not leave a generated asset without its provenance record.
      await this.store.deleteImage(characterId, asset.path).catch(() => {});
      throw error;
    }
    return variation;
  }

  async startAnimation({ characterId, brief }) {
    assertId(characterId, 'Character ID');
    const animationBrief = assertAnimationBrief(brief);
    if (!this.imageProvider || !this.videoProvider) {
      throw new Error('Animation providers are not configured.');
    }
    const manifest = await this.store.getCharacter(characterId);
    const canonical = await this.store.readImage(
      characterId,
      manifest.identity.canonicalSheet.path,
    );
    const animationId = createId('animation');
    try {
      const keyframePrompt = await renderAnimationKeyframePrompt(
        manifest.name,
        animationBrief,
      );
      const keyframeResult = await this.imageProvider.generate({
        prompt: keyframePrompt.text,
        references: [
          {
            role: 'canonical-sheet',
            bytes: canonical.bytes,
            mimeType: canonical.mimeType,
            sha256: manifest.identity.canonicalSheet.sha256,
          },
        ],
        size: '1536x1024',
      });
      const keyframe = await this.store.writeImage(
        characterId,
        `assets/animations/${animationId}/first-frame.png`,
        keyframeResult.bytes,
      );
      const motionPrompt = await renderAnimationMotionPrompt(animationBrief);
      const videoTask = await this.videoProvider.create({
        firstFrame: keyframeResult.bytes,
        prompt: motionPrompt.text,
        ratio: '1280:720',
        duration: 5,
      });
      const now = this.clock().toISOString();
      const animation = {
        id: animationId,
        brief: animationBrief,
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
        firstFrame: {
          asset: keyframe,
          generation: {
            prompt: keyframePrompt,
            references: [
              {
                role: 'canonical-sheet',
                mimeType: canonical.mimeType,
                sha256: manifest.identity.canonicalSheet.sha256,
              },
            ],
            ...keyframeResult.provenance,
          },
        },
        video: {
          taskId: videoTask.taskId,
          generation: {
            prompt: motionPrompt,
            references: [
              {
                role: 'animation-first-frame',
                mimeType: keyframe.mimeType,
                sha256: keyframe.sha256,
              },
            ],
            ...videoTask.provenance,
          },
          asset: null,
          failure: null,
        },
      };
      manifest.animations ??= [];
      manifest.animations.push(animation);
      manifest.updatedAt = now;
      await this.store.writeManifest(manifest);
      return animation;
    } catch (error) {
      await this.store.deleteAnimation(characterId, animationId).catch(() => {});
      throw error;
    }
  }

  async refreshAnimation({ characterId, animationId }) {
    assertId(characterId, 'Character ID');
    assertId(animationId, 'Animation ID');
    const manifest = await this.store.getCharacter(characterId);
    const animation = manifest.animations?.find((item) => item.id === animationId);
    if (!animation) {
      const error = new Error('Animation was not found.');
      error.code = 'ENOENT';
      throw error;
    }
    if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(animation.status)) return animation;
    if (!this.videoProvider) throw new Error('Animation providers are not configured.');

    const task = await this.videoProvider.retrieve(animation.video.taskId);
    const now = this.clock().toISOString();
    animation.status = task.status;
    animation.updatedAt = now;
    if (task.status === 'SUCCEEDED') {
      if (!task.outputUrl) throw new Error('Completed animation output is missing.');
      const result = await this.videoProvider.download(task.outputUrl);
      const asset = await this.store.writeVideo(
        characterId,
        `assets/animations/${animationId}/animation.mp4`,
        result.bytes,
      );
      animation.video.asset = asset;
      animation.video.generation.completedAt = task.completedAt ?? now;
    } else if (task.status === 'FAILED' || task.status === 'CANCELED') {
      animation.video.failure = task.failure ? String(task.failure).slice(0, 500) : null;
    }
    manifest.updatedAt = now;
    try {
      await this.store.writeManifest(manifest);
    } catch (error) {
      if (animation.video.asset) {
        await this.store.deleteImage(characterId, animation.video.asset.path).catch(() => {});
      }
      throw error;
    }
    return animation;
  }

  getCharacter(characterId) {
    return this.store.getCharacter(characterId);
  }

  async getCanonicalSheet(characterId) {
    const manifest = await this.store.getCharacter(characterId);
    const image = await this.store.readImage(
      characterId,
      manifest.identity.canonicalSheet.path,
    );
    return {
      bytes: image.bytes,
      mimeType: image.mimeType,
      sha256: manifest.identity.canonicalSheet.sha256,
    };
  }

  async getAnimationFirstFrame({ characterId, animationId }) {
    const animation = await this.#getAnimation(characterId, animationId);
    const image = await this.store.readImage(characterId, animation.firstFrame.asset.path);
    return { ...image, sha256: animation.firstFrame.asset.sha256 };
  }

  async getAnimationVideo({ characterId, animationId }) {
    const animation = await this.#getAnimation(characterId, animationId);
    if (animation.status !== 'SUCCEEDED' || !animation.video.asset) {
      const error = new Error('Animation video was not found.');
      error.code = 'ENOENT';
      throw error;
    }
    const video = await this.store.readVideo(characterId, animation.video.asset.path);
    return { ...video, sha256: animation.video.asset.sha256 };
  }

  async #getAnimation(characterId, animationId) {
    assertId(characterId, 'Character ID');
    assertId(animationId, 'Animation ID');
    const manifest = await this.store.getCharacter(characterId);
    const animation = manifest.animations?.find((item) => item.id === animationId);
    if (!animation) {
      const error = new Error('Animation was not found.');
      error.code = 'ENOENT';
      throw error;
    }
    return animation;
  }

  listCharacters() {
    return this.store.listCharacters();
  }

  deleteCharacter(characterId) {
    assertId(characterId, 'Character ID');
    return this.store.deleteCharacter(characterId);
  }
}
