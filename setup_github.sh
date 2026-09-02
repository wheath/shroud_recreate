#!/usr/bin/env bash
# ======================================================================
# setup_github.sh — create labels, milestones, and all backlog issues
# for the Shroud-ify project, using the GitHub CLI (gh).
#
# Run AFTER: (1) the code is pushed, (2) `gh auth login` is done.
# Usage:   bash setup_github.sh
# Safe to re-run: labels use --force; milestones/issues are guarded.
# ======================================================================
set -uo pipefail
REPO="wheath/shroud_recreate"

echo "==> Repo: $REPO"
gh repo view "$REPO" >/dev/null || { echo "Can't see $REPO — is gh authed? Run: gh auth login"; exit 1; }

# ---------------------------------------------------------------- labels
echo "==> Creating labels"
mklabel () { gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force >/dev/null; echo "   label: $1"; }
mklabel "epic:setup"        5319e7 "Repo, CI, project scaffolding"
mklabel "epic:engine"       0e8a16 "Shared core rendering engine"
mklabel "epic:geometry"     1d76db "Photo to face geometry (MediaPipe)"
mklabel "epic:web"          fbca04 "Web app (Pyodide/WASM)"
mklabel "epic:desktop"      d93f0b "Desktop app (Python GUI)"
mklabel "epic:validation"   b60205 "FFT / VP-8 / regression tests"
mklabel "epic:docs"         c5def5 "Docs and release"
mklabel "type:feature"      a2eeef "New capability"
mklabel "type:chore"        bfd4f2 "Infra / tooling"
mklabel "type:bug"          d73a4a "Defect"
mklabel "good-first-issue"  7057ff "Small, self-contained"

# ------------------------------------------------------------ milestones
echo "==> Creating milestones"
mkmilestone () { gh api "repos/$REPO/milestones" -f title="$1" -f state=open >/dev/null 2>&1 && echo "   milestone: $1" || echo "   milestone exists: $1"; }
mkmilestone "M1 - Engine parity"
mkmilestone "M2 - Web MVP"
mkmilestone "M3 - Desktop MVP"
mkmilestone "M4 - Polish & v0.1 release"

# ---------------------------------------------------------------- issues
echo "==> Creating issues"
mkissue () { # title, labels, milestone, body
  gh issue create --repo "$REPO" --title "$1" --label "$2" --milestone "$3" --body "$4" >/dev/null \
    && echo "   issue: $1" || echo "   FAILED: $1"
}

mkissue "1.1 Establish repo structure and module layout" "epic:setup,type:chore" "M1 - Engine parity" "$(cat <<'EOF'
**User story**
As a developer, I want a clear repo layout separating the shared engine from the web and desktop front-ends, so that both apps consume one source of truth.

**Acceptance criteria**
- [ ] `shroud_core/` holds the cv2-free engine as an importable package.
- [ ] `web/` and `desktop/` directories exist for the two front-ends.
- [ ] `tests/`, `docs/`, and `assets/` exist with placeholders.
- [ ] Root `README.md` explains the layout and how to run each part.
EOF
)"

mkissue "1.2 Set up the GitHub Project board, labels, and milestones" "epic:setup,type:chore" "M1 - Engine parity" "$(cat <<'EOF'
**User story**
As a maintainer, I want a Kanban board with labels and milestones, so that work is visible and prioritized.

**Acceptance criteria**
- [ ] Project (Kanban) created with columns Backlog / Ready / In Progress / In Review / Done.
- [ ] All labels and four milestones created.
- [ ] Every open issue is on the board and labeled with its epic.
EOF
)"

mkissue "1.3 CI: lint + engine smoke test" "epic:setup,type:chore" "M1 - Engine parity" "$(cat <<'EOF'
**User story**
As a developer, I want CI to lint and run a fast engine smoke test on every push/PR, so that regressions are caught before merge.

**Acceptance criteria**
- [ ] GitHub Actions workflow runs on push and PR.
- [ ] Installs NumPy/SciPy and runs a linter.
- [ ] Smoke test imports `shroud_core` and renders a tiny synthetic input without error.
- [ ] CI badge added to the README.
EOF
)"

mkissue "2.1 Confirm and freeze the public engine API" "epic:engine,type:feature" "M1 - Engine parity" "$(cat <<'EOF'
**User story**
As a front-end developer, I want a stable, documented engine API, so that web and desktop call it identically.

**Acceptance criteria**
- [ ] `shroudify(Z_skin, valid, ppcm, **params) -> HxWx3 uint8 RGB` documented with types.
- [ ] `landmarks_to_depth(pts, H, W) -> (Z_skin, valid)` documented.
- [ ] Depends only on NumPy + SciPy (no OpenCV), verified by an import test.
- [ ] Docstrings list every parameter and its default.
EOF
)"

mkissue "2.2 Move pipeline parameters into a typed config" "epic:engine,type:feature" "M1 - Engine parity" "$(cat <<'EOF'
**User story**
As a developer, I want all tunable knobs in one typed config object, so that the UI and defaults stay in sync.

**Acceptance criteria**
- [ ] A `ShroudParams` dataclass captures pre_blur, diffusion, contrast, bg_floor, warp_geometry, warp_amplitude, max_opacity, sepia, seed.
- [ ] `shroudify` accepts the dataclass (or kwargs) with identical results.
- [ ] Each field has min/max/step metadata usable to auto-generate sliders.
EOF
)"

mkissue "2.3 Deterministic seeding and reproducibility" "epic:engine,type:feature" "M1 - Engine parity" "$(cat <<'EOF'
**User story**
As a user, I want the same photo + settings + seed to always produce the same image, so that results are reproducible and shareable.

**Acceptance criteria**
- [ ] All stochastic steps (weave, mottle, warp, disintegration) derive from a single seed.
- [ ] Two runs with equal inputs are pixel-identical.
- [ ] Seed is exposed as a parameter and surfaced in both UIs.
EOF
)"

mkissue "2.4 Real-time performance for the 500-poly path" "epic:engine,type:chore" "M2 - Web MVP" "$(cat <<'EOF'
**User story**
As a user dragging a slider, I want the preview to update smoothly, so that tuning feels live.

**Acceptance criteria**
- [ ] Small-resolution render is fast enough for interactive sliders (target < ~100 ms; measure and record).
- [ ] A benchmark script reports per-step timings.
- [ ] Hot paths avoid needless array copies.
EOF
)"

mkissue "3.1 Web: MediaPipe FaceMesh to depth map" "epic:geometry,type:feature" "M2 - Web MVP" "$(cat <<'EOF'
**User story**
As a web user, I want my uploaded photo turned into face geometry in the browser, so that the engine has a depth map to work from.

**Acceptance criteria**
- [ ] MediaPipe FaceMesh (JS) returns 468 landmarks from the uploaded image.
- [ ] Landmarks are handed to `landmarks_to_depth` to produce (Z_skin, valid).
- [ ] Runs fully client-side; no image leaves the browser.
EOF
)"

mkissue "3.2 Desktop: MediaPipe FaceMesh (Python) to depth map" "epic:geometry,type:feature" "M3 - Desktop MVP" "$(cat <<'EOF'
**User story**
As a desktop user, I want the same face-to-geometry step natively, so that desktop output matches web.

**Acceptance criteria**
- [ ] MediaPipe FaceMesh (Python) produces 468 landmarks.
- [ ] Same `landmarks_to_depth` path as web, producing equivalent geometry.
- [ ] Documented install steps for the desktop dependency.
EOF
)"

mkissue "3.3 Align, crop, and normalize the face to a canonical pose" "epic:geometry,type:feature" "M2 - Web MVP" "$(cat <<'EOF'
**User story**
As a user, I want off-angle or off-center photos normalized before rendering, so that results are consistent regardless of framing.

**Acceptance criteria**
- [ ] Face is centered, rotated upright, and scaled to a canonical size.
- [ ] Depth scaling yields ~3 cm relief consistently.
- [ ] A before/after alignment preview is available for debugging.
EOF
)"

mkissue "3.4 Graceful handling of no-face / multi-face / low-quality input" "epic:geometry,type:bug" "M2 - Web MVP" "$(cat <<'EOF'
**User story**
As a user, I want a clear message when my photo can't be processed, so that I'm not left with a broken or blank result.

**Acceptance criteria**
- [ ] No detected face gives a friendly error with guidance.
- [ ] Multiple faces: pick the largest/most-central, or prompt to choose.
- [ ] Very low resolution warns that quality may suffer.
EOF
)"

mkissue "4.1 Bootstrap Pyodide with NumPy/SciPy and the engine" "epic:web,type:feature" "M2 - Web MVP" "$(cat <<'EOF'
**User story**
As a web user, I want the exact Python engine running in my browser, so that web output is identical to desktop with zero server cost.

**Acceptance criteria**
- [ ] Pyodide loads NumPy and SciPy in-browser.
- [ ] `shroud_core` is importable in the Pyodide runtime and renders a test input.
- [ ] A visible warmup/loading indicator covers first-load latency.
EOF
)"

mkissue "4.2 Photo upload and input canvas" "epic:web,type:feature" "M2 - Web MVP" "$(cat <<'EOF'
**User story**
As a web user, I want to upload (or drag-drop) a photo and see it, so that I can shroud-ify it.

**Acceptance criteria**
- [ ] Accepts common image formats via file picker and drag-drop.
- [ ] Input image renders on a canvas.
- [ ] Oversized images are downscaled sensibly before processing.
EOF
)"

mkissue "4.3 Three-panel UI (input / output / controls)" "epic:web,type:feature" "M2 - Web MVP" "$(cat <<'EOF'
**User story**
As a web user, I want input, output, and a control panel side by side, so that I can compare and adjust easily.

**Acceptance criteria**
- [ ] Layout matches the spec's 3-panel design.
- [ ] Responsive down to a tablet width.
- [ ] Output panel shows the current render.
EOF
)"

mkissue "4.4 Live slider controls mapped to engine parameters" "epic:web,type:feature" "M2 - Web MVP" "$(cat <<'EOF'
**User story**
As a web user, I want sliders/toggles for the key settings that re-render live, so that I can dial in the look.

**Acceptance criteria**
- [ ] Controls for contrast, diffusion, max_opacity, bg_floor, sepia (toggle), warp_geometry (toggle), seed.
- [ ] Slider ranges come from the parameter metadata (2.2).
- [ ] Adjusting a control re-renders within the interactive budget.
EOF
)"

mkissue "4.5 Selective transparency brush (paint worn / faded regions)" "epic:web,type:feature" "M4 - Polish & v0.1 release" "$(cat <<'EOF'
**User story**
As a web user, I want to paint areas to fade or wear away, so that I can add creases and localized aging by hand.

**Acceptance criteria**
- [ ] A brush pane captures mouse/touch strokes into a user_mask array.
- [ ] The mask multiplies into the Step-9 alpha map on each render.
- [ ] Brush size and strength are adjustable; mask is clearable.
EOF
)"

mkissue "4.6 Client-side export of the result" "epic:web,type:feature" "M2 - Web MVP" "$(cat <<'EOF'
**User story**
As a web user, I want to download my result, so that I can keep or share it.

**Acceptance criteria**
- [ ] "Download PNG" saves the current output at full resolution.
- [ ] Export happens entirely client-side.
- [ ] Optional: choose grayscale/negative vs sepia on export.
EOF
)"

mkissue "4.7 Privacy guarantee: fully client-side" "epic:web,type:chore" "M2 - Web MVP" "$(cat <<'EOF'
**User story**
As a privacy-conscious user, I want assurance my photo never leaves my device, so that I can use it with personal images.

**Acceptance criteria**
- [ ] No network request carries image data (verified in the network tab).
- [ ] A visible note states processing is 100% local.
- [ ] No analytics capture image content.
EOF
)"

mkissue "5.1 Desktop GUI shell reusing the shared engine" "epic:desktop,type:feature" "M3 - Desktop MVP" "$(cat <<'EOF'
**User story**
As a desktop user, I want a native window with the same engine, so that I can shroud-ify photos offline.

**Acceptance criteria**
- [ ] A GUI framework is chosen and documented (trade-offs noted).
- [ ] The app imports `shroud_core` unchanged.
- [ ] A window opens with input, output, and controls.
EOF
)"

mkissue "5.2 Open / drag-drop a photo" "epic:desktop,type:feature" "M3 - Desktop MVP" "$(cat <<'EOF'
**User story**
As a desktop user, I want to open or drag in a photo, so that I can start quickly.

**Acceptance criteria**
- [ ] File-open dialog and drag-drop both work.
- [ ] Selected image displays in the input panel.
EOF
)"

mkissue "5.3 Sliders with live preview" "epic:desktop,type:feature" "M3 - Desktop MVP" "$(cat <<'EOF'
**User story**
As a desktop user, I want live sliders like the web app, so that the two feel consistent.

**Acceptance criteria**
- [ ] Same parameter set as web (4.4).
- [ ] Preview updates as controls change.
EOF
)"

mkissue "5.4 Save result (including high-resolution)" "epic:desktop,type:feature" "M3 - Desktop MVP" "$(cat <<'EOF'
**User story**
As a desktop user, I want to save my result, optionally at higher resolution than the live preview, so that I get print-quality output.

**Acceptance criteria**
- [ ] Save dialog writes PNG.
- [ ] Optional high-res re-render at save time.
- [ ] Grayscale/negative and sepia options.
EOF
)"

mkissue "5.5 Batch mode over a folder of photos" "epic:desktop,type:feature" "M4 - Polish & v0.1 release" "$(cat <<'EOF'
**User story**
As a power user, I want to process a whole folder with one settings profile, so that I can convert many images at once.

**Acceptance criteria**
- [ ] Select an input folder and an output folder.
- [ ] Current settings apply to every image; progress is shown.
- [ ] Failures are reported per file without aborting the batch.
EOF
)"

mkissue "5.6 Package the desktop app for macOS and Windows" "epic:desktop,type:chore" "M4 - Polish & v0.1 release" "$(cat <<'EOF'
**User story**
As a non-technical user, I want an installable app, so that I don't need Python set up.

**Acceptance criteria**
- [ ] PyInstaller (or equivalent) bundles a runnable app for macOS and Windows.
- [ ] MediaPipe and SciPy load correctly inside the bundle.
- [ ] Build steps documented.
EOF
)"

mkissue "6.1 Automated 2D FFT diffuse-diamond check" "epic:validation,type:feature" "M1 - Engine parity" "$(cat <<'EOF'
**User story**
As a maintainer, I want an automated FFT test, so that outputs stay free of digital-grid artifacts.

**Acceptance criteria**
- [ ] Computes the shifted 2D FFT of an output image.
- [ ] Asserts an isotropic diamond with no needle-spikes / neon bars.
- [ ] Reports the high-frequency radial tail (target ~0.007; real relic ~0.004).
EOF
)"

mkissue "6.2 VP-8 self-consistency check" "epic:validation,type:feature" "M1 - Engine parity" "$(cat <<'EOF'
**User story**
As a maintainer, I want the naive intensity-to-height inversion tested, so that the image encodes coherent geometry.

**Acceptance criteria**
- [ ] Inverts brightness to height and inspects the surface.
- [ ] Flags crater eyes, knife-edge nose, or hairline step-walls.
- [ ] Passes on the canonical render.
EOF
)"

mkissue "6.3 Golden-image regression tests" "epic:validation,type:chore" "M2 - Web MVP" "$(cat <<'EOF'
**User story**
As a developer, I want golden-image tests, so that unintended visual changes are caught.

**Acceptance criteria**
- [ ] Fixed seed + fixed input produce a checked-in reference image.
- [ ] CI compares new renders against the reference within tolerance.
- [ ] A documented command updates the golden when a change is intentional.
EOF
)"

mkissue "7.1 User guide and README polish" "epic:docs,type:chore" "M4 - Polish & v0.1 release" "$(cat <<'EOF'
**User story**
As a new user, I want clear run/use instructions for both apps, so that I can get started without help.

**Acceptance criteria**
- [ ] README covers web and desktop quick-starts.
- [ ] Screenshots/GIFs of the UI.
- [ ] Parameter reference (what each slider does).
EOF
)"

mkissue "7.2 Architecture document" "epic:docs,type:chore" "M4 - Polish & v0.1 release" "$(cat <<'EOF'
**User story**
As a contributor, I want an architecture overview, so that I understand how the shared engine serves both front-ends.

**Acceptance criteria**
- [ ] Diagram of engine to web (Pyodide) and engine to desktop.
- [ ] Notes on the 10-step pipeline and where parameters plug in.
- [ ] Links to the book (An Image Made of Distance) for the deep math.
EOF
)"

mkissue "7.3 Cut the v0.1 release with a demo" "epic:docs,type:feature" "M4 - Polish & v0.1 release" "$(cat <<'EOF'
**User story**
As a stakeholder, I want a tagged v0.1 with a live demo, so that the project has a shareable milestone.

**Acceptance criteria**
- [ ] Web app deployed to a static host (e.g. GitHub Pages).
- [ ] v0.1.0 tagged with release notes.
- [ ] A short demo GIF/video linked from the README.
EOF
)"

echo ""
echo "==> Done. Review at: https://github.com/$REPO/issues"
echo ""
echo "OPTIONAL — create a Projects (v2) board and add every issue to it:"
echo "  (needs the project scope once:  gh auth refresh -s project )"
cat <<'EOF'
  gh project create --owner wheath --title "Shroud-ify Roadmap"
  # note the project number it prints, then:
  PNUM=<that number>
  for url in $(gh issue list --repo wheath/shroud_recreate --state open --limit 100 --json url -q '.[].url'); do
    gh project item-add "$PNUM" --owner wheath --url "$url"
  done
  # Set the board columns (Backlog/Ready/In Progress/In Review/Done) once in the UI,
  # or via `gh project field-list` + `gh project item-edit`.
EOF
