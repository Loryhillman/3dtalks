# Meeting human avatars v1

The two GLB models in this directory were prepared from MakeHuman Community
core assets and Meta/Oculus-style viseme assets. Asset license: **CC0-1.0**.

- Core assets and derivatives: https://static.makehumancommunity.org/about/license.html
- System asset components: https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html
- Functional assets (CC0), including visemes: https://static.makehumancommunity.org/assets/assetpacks.html
- Visemes 02 by Mika Suominen: https://static.makehumancommunity.org/assets/assetpacks/visemes02.html
- CC0 legal text: https://creativecommons.org/publicdomain/zero/1.0/legalcode

The original system asset notices identify Data Collection AB, Joel Palmius
and Jonas Hauquier. `catalog.json` records individual component authors,
licenses, archive URLs, archive/model checksums and the MPFB source revision.
`recipe.json` records phenotype settings, skin, clothing and body parts.

Preparation by 3DTalks: fitted body parts/clothes; a Mixamo-compatible skeleton;
one mouth-opening shape and corresponding teeth/tongue shapes; hidden geometry
removed; no subdivision; textures reduced to 1024px; opaque skin/clothes and
masked hair/brows; dense glTF accessors. These are derivative assets, not an
unmodified upstream model. No externally hosted textures or decoder extension.

MPFB's program source is GPL; it is a separate offline authoring dependency,
not included here and not required by the application runtime. Its program
license must not be confused with the CC0 license of these graphic assets.
The Blender and MPFB installations and source asset archives are not bundled.

This version is a candidate package pending user visual acceptance and account
catalog/default integration. Do not silently change its GLBs after shipping;
publish a new version with new checksums.
