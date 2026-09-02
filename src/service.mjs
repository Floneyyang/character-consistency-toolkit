import { readFile } from 'node:fs/promises';
import {
  assertCharacterName,
  assertId,
  assertOutfitDirection,
  assertVariationBrief,
  createId,
} from './domain.mjs';
import {
  renderCanonicalPrompt,
  renderPhotoCanonicalPrompt,
  renderVariationPrompt,
} from './prompt.mjs';

function publicAsset(asset) {
  const { bytesContent: _bytesContent, ...metadata } = asset;
  return metadata;
}

export class CharacterConsistencyService {
  constructor({ store, imageProvider, clock = () => new Date() }) {
    this.store = store;
    this.imageProvider = imageProvider;
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

  listCharacters() {
    return this.store.listCharacters();
  }

  deleteCharacter(characterId) {
    assertId(characterId, 'Character ID');
    return this.store.deleteCharacter(characterId);
  }
}
