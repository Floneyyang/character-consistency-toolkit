# Character Consistency Toolkit

A small, independent local website and toolkit for testing visual character continuity across generated images and short animations.

It turns one source photo into a canonical three-panel reference sheet, then uses that sheet as the visual authority for identity-consistent variations and animation. Every stored result includes immutable asset hashes and exact generation provenance.

## What this first version includes

- Local character records and image storage
- Canonical character-sheet generation
- Identity-locked variation generation
- Explicit ordered-reference hierarchy
- Exact prompt, prompt hash, provider, model, parameters, request ID, and usage capture
- Permanent character deletion, including locally stored source images and generated assets
- A small command-line interface
- A localhost drag-and-drop website for creating a sheet from one image
- A linked animation workspace for creating and downloading a five-second video
- One real provider adapter: OpenAI GPT Image 2
- One server-side video adapter: Runway Gen-4 Turbo
- Tests that use a fake provider and make no paid API calls

It intentionally does **not** include user accounts, a database, background queues, cloud storage, automatic retries, face recognition, or a dependency on Floney's Doll Factory.

## Requirements

- Node.js 22 or newer
- An OpenAI API key with GPT Image access
- A Runway API key for animation (character-sheet generation still works without it)

The implementation uses the Image API's edits endpoint because the workflow generates new images from ordered image references. See OpenAI's [image generation guide](https://developers.openai.com/api/docs/guides/image-generation), the [GPT Image 2 model page](https://developers.openai.com/api/docs/models/gpt-image-2), and Runway's [API guide](https://docs.dev.runwayml.com/guides/using-the-api/).

## Setup

```bash
cp .env.example .env
```

Add your keys to `.env`:

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_IMAGE_MODEL=gpt-image-2-2026-04-21
OPENAI_IMAGE_QUALITY=medium
RUNWAYML_API_SECRET=your_runway_key_here
RUNWAYML_VIDEO_MODEL=gen4_turbo
CHARACTER_LAB_DATA_DIR=./data
PORT=4173
```

Only `OPENAI_API_KEY` is required for character-sheet generation. `RUNWAYML_API_SECRET` is additionally required for animation. Restart the local server after changing `.env`. The `.env` file and all generated `data/` are ignored by Git.

## Use the local website

Start the localhost server:

```bash
npm run dev
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173). The personal workflow is:

1. Enter an optional character name.
2. Optionally describe how the character should be dressed.
3. Drop in one clear PNG, JPEG, or WebP reference image.
4. Select **Create character sheet**.
5. Keep the page open while GPT Image creates the three coordinated views.
6. Review and download the canonical sheet.
7. Select **Bring this character to life**, describe one short moment, and create a five-second animation.

The photo remains authoritative for identity, hair, apparent age, body profile, and proportions. The optional sheet-generation text controls clothing, footwear, and wearable accessories only.

## How animation works

Animation is a two-provider workflow:

```text
Canonical character sheet
-> GPT Image identity-locked 16:9 first frame
-> Runway Gen-4 Turbo five-second video task
-> Immutable local MP4
```

The canonical sheet is the sole authority for the character's identity **and outfit**. Animation direction may control the setting, lighting, action, expression, environmental movement, and camera composition. It cannot replace, restyle, recolor, add, or remove the approved clothing or wearable accessories.

The Runway task is persisted so reopening the animation workspace can resume status checks without starting another paid attempt. Once complete, the app downloads the MP4 into local immutable storage because Runway's output URLs expire. The default five-second Gen-4 Turbo video costs approximately $0.25 at Runway's current [published API pricing](https://docs.dev.runwayml.com/guides/pricing/), before the separate GPT Image first-frame cost and tax.

The site binds only to `127.0.0.1`. Both API keys stay in the Node process and are never sent to browser code. Source images, generated sheets, first frames, MP4s, manifests, and provenance are stored in the Git-ignored local `data/` folder. Live generation uses paid provider capacity; automated tests never call either provider.

Generated animation assets are stored with their owning character:

```text
data/characters/<character-id>/assets/animations/<animation-id>/
├── first-frame.png
└── animation.mp4
```

## Use the CLI

Create a character from an approved character image:

```bash
node --env-file=.env src/cli.mjs create \
  --name "Mina" \
  --approved "/absolute/path/to/approved-character.png"
```

Optionally add the original photo as secondary facial evidence:

```bash
node --env-file=.env src/cli.mjs create \
  --name "Mina" \
  --approved "/absolute/path/to/approved-character.png" \
  --supporting-photo "/absolute/path/to/source-photo.jpg"
```

The approved character remains the authority for the visual medium, proportions, styling, hair treatment, and overall identity. The supporting photo cannot replace it.

Create another edition:

```bash
node --env-file=.env src/cli.mjs vary \
  --character "character-..." \
  --brief "A winter explorer edition in a red technical coat, standing in snow."
```

Inspect local records:

```bash
node src/cli.mjs list
node src/cli.mjs show --character "character-..."
```

Permanently delete a character and every locally stored source and generated asset:

```bash
node src/cli.mjs delete --character "character-..." --yes
```

## Validate

This project has no third-party runtime or test dependencies.

```bash
npm run check
```

Pull requests and pushes to `main` run the same check on Node.js 22 in GitHub Actions. Tests never call a live image or video provider.

## Current limits

- It assumes one local writer at a time.
- Generation is synchronous and may take several minutes.
- Animation submission waits for its GPT Image first frame; the Runway video task is asynchronous and resumes when its workspace is reopened.
- Closing or refreshing the page does not cancel an in-flight provider request.
- It does not automatically retry billable requests with unknown outcomes.
- Evaluation is currently human review, not an automated identity score.
- Prompt effectiveness still needs testing across varied character styles, ages, body types, and presentation.
- This is visual continuity tooling, not biometric identification.

## Design documentation

- [Architecture](docs/architecture.md) summarizes the current modules, data flow, and persistence model.
- [Development design](docs/dev-design.md) documents the governing invariants, Mermaid diagrams, three primary security decisions, reproducibility strategy, failure semantics, and public-production gates.
- [Product roadmap](docs/roadmap.md) records completed milestones and the approved Runway animation experiment.
