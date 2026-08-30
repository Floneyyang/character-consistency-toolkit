# Character Consistency Lab operating rules

- Keep the toolkit independent from product repositories.
- Never put provider credentials in client-side code, manifests, logs, or commits.
- Treat source images, canonical sheets, and generated variations as immutable assets.
- Record the exact prompt, prompt hash, provider, model, parameters, references, and request ID for every generated asset.
- Preserve reference order. The approved character is the primary authority; an optional supporting photo is secondary facial evidence only.
- Do not silently fall back to another provider, model, prompt, or reference strategy.
- Do not infer or label sensitive traits from images. Identity consistency here means visual continuity, not biometric identification.
- Keep changes small. Do not add accounts, queues, databases, or a web UI without a demonstrated need.
- Run `npm run check` after every change.
