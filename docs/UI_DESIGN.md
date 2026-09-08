# Desktop / Web UI design

Status: **design proposal** (from mockup iteration). Not yet built. This document
captures the interaction model the desktop and web apps should implement. It is the
source of truth for the front-end; where it references the engine, note that the
current `shroud_core/engine.py` is a **proof of concept**, not a constraint — the
engine is expected to grow to serve this interface, not the reverse.

The physics and failure modes referenced here come from the field-notes book
(*An Image Made of Distance*) and the `lessons_learned/` notes. Those findings are
binding; the UI may let the user deliberately violate them (to learn), but must flag
when it does.

---

## 1. Window layout

Three regions:

- **Top-left — Reference face.** The user's own reference Shroud image (user-supplied;
  the repo ships no relic photographs). Fixed. Never manipulated. It is the visual
  target the user matches against by eye.
- **Top-right — Projected face.** The rendered result. This window **holds the real
  pose** — what it shows is what renders.
- **Right dock — Layers** (see §3), with the selected layer's controls beneath it.
- **Bottom strip — Body view.** A 3D view of the whole model with the cloth and
  clipping planes passing through it, plus the 2D capture frame drawn onto the body.

The reference and projected faces are the two things compared side by side. All other
chrome serves that comparison.

---

## 2. Manipulation model (pose)

There is **one model**. The top-right window and the bottom strip are two views of it.

- **Top-right (2D) is the authority.** Move / rotate / scale performed here transform
  the real model. Up 2 in the 2D window → the model moves 2. This is what renders.
- **Bottom strip reflects the real pose** (top drives bottom). You can additionally
  **orbit the bottom view freely to inspect** the geometry — that is a camera move
  only; it never changes the pose and never feeds back to the top.
- **The bottom never automatically affects the top.** There is exactly one exception,
  and it is explicit and warned: a **"Match bottom view"** button adopts the current
  inspection angle as the real pose. It raises a confirm dialog ("Re-orient the shot?
  Your 2D orientation will be replaced and can't be recovered. Usually not what you
  want."), with Cancel as the safe default.

Orientation is judged **by eye** against the reference — no onion-skin, no
auto-alignment, no attempt to analyze the relic's pose (the only relic imagery is a
degraded negative with no clean extractable geometry — this is a data wall, see the
v11 dead-end in the book). A help link states the required orientation as a fallback.

---

## 3. Layers

Everything is a layer. Reading the layer list top-to-bottom **is** reading the
image-formation pipeline. Two groups, visually distinct:

### Effect layers (pipeline order; top = applied last)

These are **processing steps**, not objects. Order is physical: reordering changes the
result, and some orders are wrong. Order is **fixed-but-reorderable via up/down
arrows** (no free drag — free drag would imply a compositing model that doesn't exist).

Top to bottom:

1. **Sepia colour** — final Maillard sepia-scorch tone curve.
2. **Transparency** — face bleeds into the linen (alpha composite, capped opacity).
3. **Weave** — slub-noise herringbone sampling. Wrong version available: *sinusoid*.
4. **Scattering** — lateral bleed/diffusion through the air gap.
5. **Blur** — pre-blur so hard anatomical edges never form.

(Additional formation steps from the book — half-tone, banding, distance cutoff,
grazing de-shade, warp/disintegration — belong in this group too; the five above are
the representative set drawn in the mockup. De-shade carries wrong versions *linear*
and *phong-shading*.)

### Scene layers (the physical setup)

- **Blood map** — binary white mask, on the cloth. Paint / erase / import / clear.
- **Cloth** — the plane the image forms on. Its height is the imaging distance (the
  single most consequential parameter).
- **3D model** — the body/head being imaged.
- **Clipping plane** — a floor that cuts off the back/far geometry so only the near
  front shell images.

Every layer has a **visibility eye**. The selected layer shows its own controls beneath
the list.

---

## 4. Operations per layer

Operations are a property of the layer's **type**. Selecting a layer surfaces only the
operations that layer allows; where a layer allows several (the model's move/rotate/
scale), they are an **exclusive mode switch** (one active at a time, Blender G/R/S
style), not a crowded toolbar.

| Layer | Move | Rotate | Scale | Height | Tilt | Paint | Import | Clear | Show |
|---|---|---|---|---|---|---|---|---|---|
| 3D model (solid) | ✓ | ✓ | ⚠ | — | — | — | — | — | ✓ |
| Cloth plane | — | — | — | ✓ (imaging dist.) | ○ | — | — | — | ✓ |
| Clipping plane | — | — | — | ✓ (cut level) | ○ | — | — | — | ✓ |
| Blood map (mask) | — | — | — | — | — | ✓ | ✓ | ✓ | ✓ |
| Effect layers | — | — | — | — | — | — | — | — | ✓ (+ amount, + wrong-version switch) |

Legend: ✓ allowed · ⚠ allowed but changes the physics (scale rescales the body against
fixed planes, shifting the imaging distance everywhere) · ○ optional · — not meaningful.

---

## 5. Making mistakes (pedagogy) and validation

The tool is meant to let the user experiment and make wrong choices to learn. The design
supports this and keeps it honest:

- **Flag but allow.** A layer turned off, reordered wrongly, or set to a known-bad
  version (sinusoid weave, linear/phong de-shade) is permitted, but the layer goes
  **amber** and states why ("set to sinusoid (wrong)", "hidden — edges will be hard").
- **Validation disagrees.** A readout shows the two objective checks from the book and
  turns red when off-target:
  - **2D FFT** high-frequency tail — target ~0.007 (real relic 0.004); a smooth diffuse
    diamond with no needles.
  - **VP-8 self-consistency** — the render, read as height, must rebuild a coherent face
    (no crater eyes, knife nose, hairline wall).
- **Reference configuration.** Validation targets the canonical "all faithful, defaults"
  state. Everything else is understood as exploration.

Binding lessons the UI must not silently encourage away from: the image must **whisper**
(low contrast, never approach white/black); it lives **on cloth, never on black**;
texture **modulates, never adds**; periodic/sinusoidal generators betray themselves as
FFT needles; morphological/membrane drapes stamp false edges; clean relief leads,
texture is a whisper.

---

## 6. Notes on the current engine (POC)

`shroud_core/engine.py` currently exposes nine scalar params
(`pre_blur, diffusion, contrast, bg_floor, warp_geometry, warp_amplitude, max_opacity,
sepia, seed`) via `shroudify(Z_skin, valid, ppcm, **params)`. It does **not** yet
support: per-layer image-map overrides, a blood layer, a clipping plane, or the
effect-layers-as-objects model above. These are the engine work implied by this design
(and relate to the epic:engine / epic:web / epic:desktop backlog stories). The POC
established *which operations produce the effect*; this document specifies *how the user
should drive them*.
