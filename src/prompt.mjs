import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './domain.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const PROMPTS = {
  photoCanonical: {
    id: 'photo-character-sheet',
    version: 'v1',
    path: resolve(PROJECT_ROOT, 'prompts/photo-character-sheet-v1.md'),
  },
  canonical: {
    id: 'canonical-sheet',
    version: 'v1',
    path: resolve(PROJECT_ROOT, 'prompts/canonical-sheet-v1.md'),
  },
  variation: {
    id: 'identity-locked-variation',
    version: 'v1',
    path: resolve(PROJECT_ROOT, 'prompts/variation-v1.md'),
  },
};

export function renderPhotoCanonicalPrompt(characterName) {
  return renderPrompt(PROMPTS.photoCanonical, {
    CHARACTER_NAME: characterName,
  });
}

async function renderPrompt(definition, variables) {
  let text = await readFile(definition.path, 'utf8');
  for (const [key, value] of Object.entries(variables)) {
    text = text.replaceAll(`{{${key}}}`, value);
  }
  const unresolved = text.match(/{{[A-Z0-9_]+}}/g);
  if (unresolved) {
    throw new Error(`Prompt variables are unresolved: ${unresolved.join(', ')}`);
  }
  const normalized = text.trim();
  return {
    id: definition.id,
    version: definition.version,
    text: normalized,
    sha256: sha256(normalized),
  };
}

export function renderCanonicalPrompt(characterName, hasSupportingPhoto) {
  const supportingRule = hasSupportingPhoto
    ? 'Reference image 2 is a supporting source photo. Use it only as secondary evidence for recognizable facial characteristics that may be obscured in image 1. Never replace the approved character’s visual medium, styling, body, proportions, outfit, or hair treatment with the photo.'
    : 'There is no supporting source photo. Do not invent identity details that are not visible in the approved character.';
  return renderPrompt(PROMPTS.canonical, {
    CHARACTER_NAME: characterName,
    SUPPORTING_REFERENCE_RULE: supportingRule,
  });
}

export function renderVariationPrompt(characterName, brief) {
  return renderPrompt(PROMPTS.variation, {
    CHARACTER_NAME: characterName,
    VARIATION_BRIEF: brief,
  });
}
