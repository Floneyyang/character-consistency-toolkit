#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CharacterConsistencyService } from './service.mjs';
import { FileCharacterStore } from './store.mjs';
import { ImageProviderError, OpenAIImageProvider } from './openai-image-provider.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function usage() {
  return `Character Consistency Lab

Commands:
  create --name <name> --approved <image> [--supporting-photo <image>]
  vary --character <id> --brief <description>
  show --character <id>
  list
  delete --character <id> --yes

Run provider commands with Node 22 and a local .env file:
  node --env-file=.env src/cli.mjs create --name "Mina" --approved ./mina.png
`;
}

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'yes') {
      options.yes = true;
      continue;
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}.`);
    }
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function requireOption(options, key) {
  if (!options[key]) throw new Error(`--${key} is required.`);
  return options[key];
}

function createService({ needsProvider }) {
  const dataDirectory = resolve(
    PROJECT_ROOT,
    process.env.CHARACTER_LAB_DATA_DIR || 'data',
  );
  const store = new FileCharacterStore(dataDirectory);
  const imageProvider = needsProvider
    ? new OpenAIImageProvider({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_IMAGE_MODEL,
        quality: process.env.OPENAI_IMAGE_QUALITY,
      })
    : null;
  return new CharacterConsistencyService({ store, imageProvider });
}

function summarizeCharacter(character) {
  return {
    id: character.id,
    name: character.name,
    canonicalSheet: character.identity.canonicalSheet.path,
    variations: character.variations.length,
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
  };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (!command || command === 'help' || command === '--help') {
    console.log(usage());
    return;
  }

  if (command === 'create') {
    const service = createService({ needsProvider: true });
    const character = await service.createCharacter({
      name: requireOption(options, 'name'),
      approvedImagePath: requireOption(options, 'approved'),
      supportingPhotoPath: options['supporting-photo'],
    });
    console.log(JSON.stringify(summarizeCharacter(character), null, 2));
    return;
  }

  if (command === 'vary') {
    const service = createService({ needsProvider: true });
    const variation = await service.createVariation({
      characterId: requireOption(options, 'character'),
      brief: requireOption(options, 'brief'),
    });
    console.log(JSON.stringify(variation, null, 2));
    return;
  }

  if (command === 'show') {
    const service = createService({ needsProvider: false });
    const character = await service.getCharacter(requireOption(options, 'character'));
    console.log(JSON.stringify(character, null, 2));
    return;
  }

  if (command === 'list') {
    const service = createService({ needsProvider: false });
    const characters = await service.listCharacters();
    console.log(JSON.stringify(characters.map(summarizeCharacter), null, 2));
    return;
  }

  if (command === 'delete') {
    if (!options.yes) {
      throw new Error('Deletion is permanent. Repeat the command with --yes.');
    }
    const characterId = requireOption(options, 'character');
    const service = createService({ needsProvider: false });
    await service.deleteCharacter(characterId);
    console.log(JSON.stringify({ deleted: characterId }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  const prefix = error instanceof ImageProviderError ? `${error.kind}: ` : '';
  console.error(`${prefix}${error.message}`);
  process.exitCode = 1;
});
