# Architecture

## Product boundary

Character Consistency Lab is an independent local research tool. It does not import code, data, or prompts from Floney's Doll Factory. Proven techniques may later be reimplemented in another product, but neither repository depends on the other.

The primary personal-use interface is a local website bound to `127.0.0.1`. The CLI remains available for repeatable experiments and automation.

## Core flow

```text
Approved character image
        +
Optional supporting photo
        |
        v
Canonical-sheet prompt v1
        |
        v
Ordered reference image edit
        |
        v
Immutable canonical sheet
        |
        v
Variation prompt v1 + user brief
        |
        v
Identity-locked variation
```

Reference precedence is deliberate:

1. The approved character controls identity, visual medium, body proportions, age presentation, styling, and hair treatment.
2. An optional source photo supplies secondary facial evidence only.
3. A variation uses only the canonical sheet so the original photo cannot gradually pull the character back toward photorealism.

## Modules

- `src/domain.mjs` validates IDs, names, image inputs, and manifests, and computes hashes.
- `src/prompt.mjs` loads versioned Markdown prompt files and records their exact rendered contents and hashes.
- `src/openai-image-provider.mjs` is the only provider-specific module. It accepts ordered references and returns bytes plus provenance.
- `src/store.mjs` owns local files, immutable asset writes, atomic manifest replacement, and deletion.
- `src/service.mjs` owns the canonical-sheet and variation workflows.
- `src/cli.mjs` is a thin local interface over the service.
- `src/web-app.mjs` serves the static site, validates browser uploads, maps safe API errors, and returns generated sheets.
- `src/server.mjs` constructs the local provider, service, store, and HTTP server without exposing credentials.
- `web/` contains the dependency-free drag-and-drop interface.

## Browser boundary

The browser sends one base64-encoded image to `POST /api/characters` on the same local origin. The server validates the declared and detected image types, enforces upload limits, and passes bytes into the existing character service. The website selects the versioned `photo-character-sheet` prompt and records the source with the `source-photo` provenance role. Browser-delivered files never contain provider credentials.

The generated canonical sheet is served from `GET /api/characters/:id/canonical-sheet`. The route reads the immutable local asset through the service rather than exposing arbitrary filesystem paths.

## Persistence

```text
data/characters/<character-id>/
├── manifest.json
└── assets/
    ├── sources/
    │   ├── approved-character.<ext>
    │   └── supporting-photo.<ext>
    ├── canonical/
    │   └── canonical-sheet.png
    └── variations/
        └── <variation-id>.png
```

Assets are never overwritten. `manifest.json` is replaced atomically after a successful generation. Each asset is addressed by a repository-relative path and SHA-256 hash. Local source filenames are not written into the manifest.

## Deliberate omissions

There is no public server, database, queue, authentication system, cloud object store, provider router, or automatic evaluation system. Add those only after experiments show that multiple users, concurrency, or automation are real requirements.
