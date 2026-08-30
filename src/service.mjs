import {
  assertCharacterName,
  assertId,
  assertVariationBrief,
  createId,
} from './domain.mjs';
import { renderCanonicalPrompt, renderVariationPrompt } from './prompt.mjs';

function publicAsset(asset) {
  const { bytesContent: _bytesContent, originalName: _originalName, ...metadata } = asset;
  return metadata;
}

export class CharacterConsistencyService {
  constructor({ store, imageProvider, clock = () => new Date() }) {
    this.store = store;
    this.imageProvider = imageProvider;
    this.clock = clock;
  }

  async createCharacter({ name, approvedImagePath, supportingPhotoPath }) {
    const characterName = assertCharacterName(name);
    if (typeof approvedImagePath !== 'string' || approvedImagePath.length === 0) {
      throw new Error('An approved character image path is required.');
    }
    const characterId = createId('character');
    await this.store.createCharacterDirectory(characterId);

    try {
      const approved = await this.store.ingestSourceImage(
        characterId,
        'approved-character',
        approvedImagePath,
      );
      const supporting = supportingPhotoPath
        ? await this.store.ingestSourceImage(
            characterId,
            'supporting-photo',
            supportingPhotoPath,
          )
        : null;
      const prompt = await renderCanonicalPrompt(characterName, Boolean(supporting));
      const references = [
        {
          role: 'approved-character',
          bytes: approved.bytesContent,
          mimeType: approved.mimeType,
          sha256: approved.sha256,
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
          sources: [publicAsset(approved), ...(supporting ? [publicAsset(supporting)] : [])],
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

  listCharacters() {
    return this.store.listCharacters();
  }

  deleteCharacter(characterId) {
    assertId(characterId, 'Character ID');
    return this.store.deleteCharacter(characterId);
  }
}
