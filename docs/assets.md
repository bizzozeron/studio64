# Assets: models, textures, materials, skies and Mario

The **Assets** button (left rail / top bar) opens the asset drawer next to the game. Everything in it
is stored in the project and comes back on every load, for everyone on the project link.

## 3D models

**Import:** drop `.glb`, `.gltf` (+ `.bin` + textures), `.obj` (+ `.mtl` + textures), binary `.fbx`
(embedded or dropped textures) or a `.zip` of any of these anywhere on the page, or use *Import a 3D
model* in the drawer or in build mode's **Models** library tab. The import dialog shows the model
as the game will draw it (converted textures, vertex colours, the game's shading) with a grid and
a red Mario-sized box for scale:

- **Use as**: *Prop* (placed many times, optional collision and animation) or *Level geometry*
  (full-mesh collision, any size, not clickable in build mode so you can't drag the level by
  accident).
- **Size**: scale factor, or type a height in game units (Mario is 160 tall; buttons for Mario,
  house and hill sizes). glTF is read as meters (×100), FBX in its own unit scale, OBJ guessed.
- **Orientation**: Y-up / Z-up (Blender, 3ds Max), 90° turns per axis, origin at the bottom center
  (stands on the ground), center or as in the file.
- **Textures**: maximum size (32–512; 64 is N64-like) and format (RGBA16, RGBA32, CI8, CI4, IA8,
  I4: the image is quantized to that look). Sizes become powers of two.
- **Light**: shaded like the game (baked from the normals) or flat (vertex colours only).
- **Materials**: per material the **surface** (normal, grippy, slippery, ice, lava, death floor,
  hangable ceiling, hard, noisy, quicksand, shallow sand, vanish-cap wall, *water*: swimmable, no
  collision, or *no collision*), **transparency** (solid, cut-out for leaves and fences,
  see-through), **2-sided**, and texture **wrap** (repeat, mirror, clamp) per direction. Surfaces are
  guessed from material names ("lava", "water", "ice", "leaves" ...).

*Save to My models* stores it; *Save & place* starts placing right away. In build mode's **Models**
tab click a model, then click in the level as often as you like (R turns it). The **⋯** menu:
place as prop, place as level geometry, **new level from this model** (a custom level made of it,
Mario dropping in above its middle, an invisible death floor below), settings, rename, delete
(also removes its placements).

Placed models are ordinary edits: move, rotate (also tilt/roll), scale, duplicate, delete and undo
work like for any object. The inspector shows the model with **Use** (prop / level geometry),
**Solid**, **Animation** (still, spin, float up and down, spin and float, sway, pulse) and **Speed**.
Mario rides spinning and floating props.

Limits: 120,000 triangles per model (warning above 20,000), 64 materials, coordinates within
±32,000 units; collision only works within ±16,384 units of the level center (the collision grid: Studio 64's
engine doubles the original game's ±8,192) and imported collision shares the level's surface pool (about 57,000 triangles; a toast says
when some triangles are left without collision). Moving (animated) props collide with their mesh if
it has at most 200 distinct vertices, otherwise with their bounding box. Skinned meshes import in
their rest pose; Draco/meshopt-compressed glTF and ASCII FBX are not supported.

Changing a model's settings rebuilds it in the engine; the old buffers are freed as soon as nothing
draws them any more (deleting a model frees it and its slot), so importing and re-importing does not
grow the memory (`studio_assets_mem()` counts it). The area's light (World tab → Light: sun
direction, colour, ambient) shades imported models and blocks as well as the terrain; models set
to *flat* light keep their colours.

### Blended materials (two textures by vertex alpha)

Like Ocarina of Time's terrain: a material can carry **two textures** that blend by the **vertex
colours' alpha**, with the vertex colours then multiplying the result as usual. In Blender:

- **Base Color**: an Image Texture plugged straight into the Principled BSDF's Base Color (as usual).
- **Emission Color**: the second Image Texture plugged straight into Emission Color, with Emission
  Strength 0 so it does not glow in Blender. (Straight in: through a Mix node the FBX exporter drops it.)
- **Paint the Color Attribute's alpha**: 1 (unpainted) shows the Base Color, 0 shows the Emission
  texture, in between mixes them.

Studio 64 turns every material with an Emission Color texture (FBX `EmissiveColor`, glTF
`emissiveTexture`, OBJ `map_Ke`) into a blended one; its row in the model's Settings shows a **Blend**
switch with the second texture's swatch (off: the Base Color only). The second texture is made the
same size and format as the first (they share the uvs). The import preview shows the first texture only.

How: the engine draws it with the N64's 2-cycle combine `(TEXEL1 - TEXEL0) * SHADE_ALPHA + TEXEL0`,
then `COMBINED * SHADE` (`assets.c` emit_material: the emission texture in TMEM's first half, the base
in the second), and the PC renderer recognises that combine and draws it with a shader of its own
(`gfx_pc.c` / `gfx_opengl.c`, `SHADER_OPT_STUDIO_BLEND`, patched by engine-upstream/changes.json).
**ROM exports**: both textures RGBA16, at most 1024 texels each (32×32, or 64×16 ...: together the
N64's 4 KB of texture memory).

**Fog in ROMs**: on the N64 the fog writes its amount into the vertex alpha, the blend's input. So in
an area with fog, the export draws opaque and cut-out blended materials **twice**: first the blend
itself with the fog turned off (the vertex alpha reaches the blend), then the same triangles again in
1-cycle mode with the fog on, painting only the fog colour over them by the fog amount (render mode
`FOG_COLOR × SHADE_ALPHA + MEMORY × (1 − SHADE_ALPHA)`, z compared without writing, `ZMODE_OPA` so the
redraw at equal depth always lands). Cut-outs also alpha-test the base texture there, so their holes
aren't fogged twice. A pixel the second draw misses just stays unfogged, never black. The cost: those
triangles draw twice (the vertices are stored once). See-through blended materials can't be redrawn
and draw without fog (the export says how many).

## Game textures

The **Textures** tab lists all ~1,200 textures of the game (levels, objects, Mario, HUD, effects),
searchable, by group, and "In this level" (what the renderer drew since the level loaded). Pick one
to:

- **Replace with image**: scaled to the texture's size and N64 colours, or kept up to 4× sharper.
- **Edit pixels**: the pixel editor (pencil, eraser, fill, line, picker, mirror drawing, an N64
  palette, recent colours, undo/redo, flips, 90° turn, N64 sizes 8–128, N64 format quantization,
  a tiled preview).
- **Recolour**: hue, saturation, brightness, contrast, tint.
- **Use on blocks**: copies it into a custom material.
- **Original** puts the game's texture back.

A replacement shows everywhere the game uses that texture (all levels).

## Materials for blocks and terrain

The **Materials** tab holds up to 16 custom materials (material numbers 48–63): from an image, drawn
in the pixel editor, from a pattern (bricks, tiles, wood, grass, stone, noise, checker, stripes,
dots, gradient, solid; two colours, scale) or from any game texture. They appear at the end of
the material lists of blocks, the inspector and the terrain paint brush. 64×64 materials can be
drawn *sharp* (the block keeps a 32×32 N64 copy).

## Skies

The **Sky** tab sets this level's sky or one for all levels (a level's own wins): from a 360°
panorama (2:1 equirectangular) or any picture (mirrored around, horizon slider), in N64 quality
(32-pixel tiles) or sharp (64-pixel tiles), or **made** from colours: a top/horizon/bottom gradient,
clouds, stars, sun and mountain silhouettes, with presets (sunny day, sunset, night, storm, lava,
candy, space). Skies show in levels with a skybox (outdoor levels and custom levels).

## Mario

The **Mario** tab colours overalls, shirt & arms, gloves, shoes, skin, hair and cap (the cap is
split from the shirt), with presets (Luigi, Wario, Waluigi, Fire, Ice, Classic NES, Gold, Shadow,
Builder, Doctor, Pink). *Look at Mario* turns the camera around him while you choose.

**Colours for**: *All stages* edits the colours every stage uses; *This stage* gives the stage Mario
is in a set of its own (Give this stage its own colours copies the default to start from; Use the
default here removes it). A stage is a level with all its areas. Stored as `assets.mario.colors` and
`assets.mario.levels["<level number>" | "c:<custom level id>"] = { colors, preset }`.

**In exported ROMs** (`n64/s64_mario.c`): the info block holds set 0 (every stage) and up to 15 stage
sets, plus each level number's set. Whenever an area loads, the ROM finds Mario's light groups through
his display lists (as the studio does, the cap and the gloves split off) and sets that stage's colours;
parts a set leaves alone go back to the game's.

## Live reload (the assets folder)

Studio 64 has an **`assets/`** folder next to it (made on the first start; `STUDIO_LIVE_ASSETS=<path>`
moves it). Work on your files there in Blender, Photoshop or anything else and the game takes every
save right away:

1. **Assets → Live**: turn on **Live reload** (per project; a green dot on the Assets button shows it).
2. **Check** the files or whole folders to watch, **uncheck** what you don't need (a folder's box
   checks or unchecks everything inside; a file can be unchecked inside a checked folder). Only
   checked files are looked at, so fewer checked files means quicker checks.
3. Bring files into the project from the folder: **Use…** in the Live tab, or, while live reload
   is on, any file picker (Models → Choose files, Textures → Replace with image, Materials → From an
   image, Sky → Choose a picture) offers **From the live assets folder**. Files picked from there are
   linked and checked. Models and pictures imported earlier by drag & drop are linked **by file
   name** when a file of the same name is in the folder.

When a checked file's contents change (SHA-1 of the file, once it stopped growing; just touching it
does nothing), what uses it is re-imported with the settings it was imported with and replaced in
place:

| File | Replaces |
|---|---|
| `.fbx` `.glb` `.gltf` `.obj` `.zip` | the model, under the same id: scale, orientation, origin, texture size/format and per-material surfaces (matched by material name) stay; every placement is rebuilt where it stands, collision included, while Mario keeps playing |
| a texture next to a model (`.png` `.jpg` `.tga` `.mtl` `.bin` ...) | that model (check the texture too) |
| a picture linked to a game texture | the texture replacement (same size choice: game size or sharp) |
| a picture linked to a material | the material (same number) |
| a picture linked to a sky | the sky (same level, or all levels) |

A reloaded model always uses **the file's own origin** (the model's 0,0,0 in Blender / the FBX), so it
stays exactly where the file puts it however its size changes; models picked from the live folder are
imported that way too. (A model imported earlier with *Bottom center* or *Center* switches to the
file's origin on its first live reload, so it can shift once.) When a model placed in the current
level reloads, Mario is put back where he was, about 60 units higher (above the new ground if it
rose there), and falls back down.

**Respawn at level start on death** (also in the Live tab): while it is on, dying or falling out
of the level starts the current level over at its start (area 1, its entry; no star screen), and
lives never run out. Falling into an area set as "falling leads to" still goes there. (Keeping
the lives topped up needs an engine built with this change: `studio_set_lives_min`, debug.c.)

Each reload is one undo step ("Live reload: castle.fbx"). Files that changed while Studio 64 was
closed are brought in when the project opens (or with **Check now**). With several tabs open on a
project, one of them does the re-import and the others follow. Keep each model and its textures in
its own sub-folder: a model re-reads the textures in its folder.

How it works: `server/routes/livereload.js` (the folder, polling once a second, hashes, routes
`GET/PUT /api/projects/:id/livereload`, `GET /api/livereload/file?path=`, websocket
`livereload_hello` / `livereload_state` / `livereload_tree` / `livereload_changed`; the settings are
`project.livereload = { on, rules: { path: true | false } }`, nearest rule wins) and
`web/js/livereload.js` (links, re-import, the queue). A linked asset entry carries
`live: { path, hash }`.

## Claude

Claude's tools (server/tools/assets.js): `list_assets`, `place_model` (where like `spawn`, prop or
level, scale, animation), `search_textures`, `edit_textures` (recolour, generated patterns, reset;
by paths or a query, optionally only what is drawn in this level), `set_skybox` (generated from
colours, clouds, sun, stars, mountains), `clear_skybox`, `set_mario_colors` (preset and/or parts).
"Put five of my crates around me", "make Mario look like Wario", "give this level a night sky",
"make all the grass in this level blue".

## How it works

- **Store** (server/assets.js, routes/assets.js): files in `projects.assetDir(id)/files/` (32 MB per
  file, 400 MB per project): `GET/PATCH /api/projects/:id/assets` (metadata in `project.assets`:
  `models`, `textures`, `materials`, `skies`, `mario`, `files`), `POST/GET/DELETE
  /api/projects/:id/assets/files[/:file]`. A PATCH is broadcast as `{ type: 'assets' }`.
- **Import** (web/js/asset_import.js): OBJ/MTL, glTF/GLB (accessors, node hierarchy, samplers,
  vertex colours, embedded or external images), binary FBX (zlib arrays via DecompressionStream,
  layer elements, materials, textures and embedded videos, model hierarchy, up axis and unit), zip
  archives, TGA. **Package** (web/js/asset_mesh.js): game-unit triangles with uvs, colours and
  normals plus converted PNG textures in one `.s64m` file.
- **Engine** (engine/src/studio/assets.c, studio_assets.h): `studio_model_begin/material/tris/
  collision/end` build per-model display lists in three layers (opaque, cut-out, translucent; vertex
  batches of 30 with per-triangle uv shifting for the s10.5 range), a culling node and the moving-
  prop collision. `bhvStudioModel` objects are the placements; `studio_assets_add_surfaces` adds
  placed models to the static collision in every rebuild (world.c), tagging prop surfaces with
  their object so editor clicks select them. Water materials become environment-region boxes.
- **Texture overrides**: gfx_pc.c asks `studio_texture_override(addr)` for every texture it
  imports; a hit uploads that RGBA32 image (any size) instead. Imported models, sharp materials and
  skies use the same path. `gfx_texture_cache_flush` makes changes visible. Game textures are found
  in memory by fingerprints from `tools/gen_textures.py` (web/data/textures.json: format, size, two
  probe windows, FNV hash of the raw bytes from the engine build); rerun it after rebuilding the
  engine from a different ROM.
- **Skies**: the 8×8 tiles of 32×32 RGBA16 replace the pointer lists of every skybox while a custom
  sky is on (`studio_sky_buffer/apply`).
- **Mario**: the light groups of his display lists are found by walking them; the cap's head and
  hand lists are re-pointed to the cap object's own red, the hands to a glove copy of white
  (`studio_mario_color(part, rgb, shade)`).
- **For other features**: `studio64.assets.ensureModel(id)` loads a model and gives its engine
  model number; in C `studio_asset_model_node(n)` is its graph node and
  `studio_asset_model_collision(n)` its object collision, e.g. for custom enemies.

Tests: `tests/suite/assets.test.mjs` (`node tests/run.mjs assets`; fixtures in tests/fixtures, made by make_fixtures.py: an OBJ platform
with a lava pool, a GLB crate, a Z-up FBX house, a panorama).
