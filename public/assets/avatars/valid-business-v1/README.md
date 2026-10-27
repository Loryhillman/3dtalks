# VALID business avatar v1

Prepared 2026-10-27 from the user's supplied `asian-man-valid-m1-busi.glb`.
The supplied file matched the pinned upstream byte for byte:

- Repository: https://github.com/c-frame/valid-avatars-glb
- Commit: `c4719df7a2b60a96cc7f56d67e247674b68c4ea7`
- File: `avatars/Asian/Asian_M_1_Busi.glb`
- Original library: https://github.com/xrtlab/Validated-Avatar-Library-for-Inclusion-and-Diversity---VALID
- License: MIT, Copyright (c) 2022 Tiffany Do. The complete notice is in LICENSE.txt.
- Source SHA-256: `6ddf21c0951b4b6c031ef885e6deaaaf9f91b3de339029a64072e86d26b5b14b`
- Prepared SHA-256: `e8be321c6c0684299582547509ccb5975aaf5ca752b96fa6ef5281468c4a7aad`

The prepared GLB is 6,745,816 bytes and 58,724 triangles. It retains the suit,
textures and humanoid skeleton. Meshopt is decoded, attributes dequantized,
accessors made dense, and WebP converted to PNG with identical decoded RGBA
pixels. No runtime decoder or relaxed application validator is required.
Only `h_expressions.MouthOpen_h` (face) and `h_teeth.t_MouthOpen_h` (lower teeth)
are retained and renamed `viseme_aa`. Other facial expressions are removed.
This is sound-energy-driven mouth opening, not phonetic articulation.

Reproduce offline from the pinned source, from the repository root:

```bash
npm ci --prefix tools/valid-avatar-conversion
node scripts/prepare-valid-avatar.cjs /absolute/source.glb /absolute/new-output.glb "$PWD/tools/valid-avatar-conversion"
```

Authoring dependencies are pinned in that directory, separate from application
dependencies. The script rejects a different source hash or an existing output.
It compares texture pixels and decoded geometry/skin/mouth arrays, validates the
output with the unchanged application inspector, and prints its hash.
Canonical metadata is in catalog.json. Do not change this released bundle in place.

The separately supplied `asian-male-head.glb` is not shipped: 146,823 triangles,
no skeleton/mouth targets, and no redistribution license confirmed in its source
repository. It cannot provide speaking animation without additional modeling.
