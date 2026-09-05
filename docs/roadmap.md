# Product Roadmap

This roadmap keeps Character Consistency Lab small and evidence-driven. Each milestone must preserve the character sheet as the visual identity authority and record enough provenance to explain every generated asset.

## Completed

### Milestone 0.1 — Provenance-first toolkit foundation

- Immutable source, canonical-sheet, and variation assets
- Versioned prompts and SHA-256 provenance
- Server-side GPT Image provider boundary
- Local file persistence and deletion

### Milestone 0.2 — Local character-sheet workspace

- Photo upload and optional apparel direction
- Canonical three-panel sheet generation
- Safe browser/server credential boundary
- Provider-rejection handling for optional wardrobe text

### Milestone 0.3 — Development design

- System and lineage diagrams
- Security and preservability decisions
- Public-production gates

## Current

### Milestone 0.4 — Bring the character to life

Create a short, downloadable character animation whose identity is derived from the approved canonical sheet.

The intended experience is:

```text
Canonical character sheet
-> Bring this character to life
-> Describe one short scene and movement
-> Identity-locked first frame (GPT Image)
-> Five-second image-to-video task (Runway)
-> Local preview and download
```

Scope:

- Add a dedicated animation workspace linked from a completed character sheet.
- Generate one landscape first frame from the canonical sheet; do not send the three-panel sheet directly to video generation.
- Treat the canonical sheet as the only visual identity authority for the first frame.
- Use Runway behind a server-side video-provider interface.
- Persist the exact motion brief, prompt revisions and hashes, model parameters, provider task ID, first frame, and downloaded MP4.
- Poll asynchronous Runway tasks without exposing the API key or Runway's temporary output URL.
- Use `gen4_turbo`, a five-second duration, and `1280:720` output for the initial cost-controlled experiment.
- Do not silently fall back to another image or video provider.

Acceptance criteria:

- A creator can move from a newly generated sheet to the animation workspace without uploading the photo again.
- The first frame visibly represents the same character as the canonical sheet.
- Refreshing the animation workspace can resume a submitted Runway task.
- A successful video is copied into immutable local storage before it is shown or downloaded.
- Failed, moderated, rate-limited, and unknown provider outcomes produce distinct safe error categories.
- Automated tests make no paid provider calls.

Cost note: Runway currently prices `gen4_turbo` at five credits per second and credits at $0.01 each, so the five-second video portion is approximately $0.25 per attempt, before the separate GPT Image first-frame cost and any applicable tax.

## Later, only after the animation experiment passes

### Milestone 0.5 — Animation quality evaluation

- Define human-review criteria for identity, face stability, body continuity, motion quality, and scene coherence.
- Compare a small set of motion prompts without changing providers silently.
- Decide whether cinematic animation is reliable enough to remain a product feature.

### Future production gates

- Authentication, authorization, quotas, and abuse controls
- Durable database, object storage, and background jobs
- Managed secrets, HTTPS, observability, and billing reconciliation
- Consent, retention, export, and deletion policy for photos and generated media
- Browser end-to-end and accessibility testing
