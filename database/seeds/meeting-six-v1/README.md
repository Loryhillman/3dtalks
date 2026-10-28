# Built-in meeting room, bundle v1

Source: the user's published `meeting-six` template, version 8, exported from
their 3DTalks installation on 16 October 2026. Its layout matched the created
sample room `123`. Only the published layout and its three referenced GLBs were
exported; no accounts, passwords, session data or database dump are included.

`manifest.json` preserves the authored transforms, floor/bounds and all six rigid
seat attachments. Server-specific model IDs have been replaced with asset keys.
The source model paths are retained as provenance; runtime paths contain the
bundle key and full SHA-256. GLB bytes and their embedded metadata are unchanged.
The manifest lists exact byte sizes and checksums for all three files.

The canonical files live outside `public/models` because a persistent Docker
volume masks that directory. Startup copies missing models into that volume,
registers local model IDs and publishes version 4 only on an untouched
installation. Existing publications, drafts and room snapshots take precedence.
The installation receipt and model references are committed in one transaction.
If a transaction fails after copying files, unreferenced complete files may
remain; a retry verifies and reuses them. Corrupt/conflicting files are never
silently replaced. Old geometry-only versions 1–3 remain readable.

Do not edit this bundle in place after release. A different default requires
a separately versioned bundle and an explicit installation/upgrade policy.

Validation: the bundle and the existing template editor SQL checks passed on
an isolated local PostgreSQL 14 cluster. Full database initialization ran twice
with the canonical base schema and registered migrations. Chromium loaded the
real office, table and six chairs with textures and applied the authored seat
pose through the production meeting client. PostgreSQL 18 in Docker was not run.
