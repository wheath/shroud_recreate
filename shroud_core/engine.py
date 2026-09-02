"""Shroud-ify engine — cv2-FREE (NumPy + SciPy only) so it runs identically in
Pyodide/WASM (web app) and native Python (desktop app).

Public API:
    shroudify(Z_skin, valid, ppcm, **params) -> HxWx3 uint8 RGB image
    landmarks_to_depth(pts_xyz, H, W)         -> (Z_skin, valid)   # from face-mesh points
"""
import numpy as np
from scipy.ndimage import gaussian_filter, grey_dilation, map_coordinates

__all__ = ["shroudify", "landmarks_to_depth", "sepia_curve", "DEFAULTS"]


def _n(a):
    return (a - a.mean()) / (a.std() + 1e-6)


def _warp(img, dx, dy):
    H, W = img.shape
    Y, X = np.mgrid[0:H, 0:W].astype(np.float32)
    return map_coordinates(img, [Y + dy, X + dx], order=1, mode="reflect")


DEFAULTS = dict(
    pre_blur=2.0, diffusion=4.0, contrast=0.30, bg_floor=0.10,
    warp_geometry=False, warp_amplitude=7.0,
    max_opacity=0.72, sepia=True, seed=1,
)


def sepia_curve(g):
    """Maillard sepia-scorch colour curve: grayscale [0,1] -> RGB."""
    g = np.clip(g, 0, 1)
    xs = [0.0, 0.5, 1.0]
    R = [0.88, 0.76, 0.48]
    G = [0.83, 0.65, 0.38]
    B = [0.74, 0.48, 0.26]
    return np.dstack([np.interp(g, xs, R), np.interp(g, xs, G), np.interp(g, xs, B)])


def shroudify(Z_skin, valid, ppcm, **kw):
    """Turn a face depth map into a Shroud-like image.

    Parameters
    ----------
    Z_skin : (H, W) float array
        Depth toward the cloth at each pixel (larger = nearer the cloth).
    valid : (H, W) bool array
        Where the face exists.
    ppcm : float
        Pixels per centimetre (sets physical scale of the drape/weave).
    **kw : see DEFAULTS.

    Returns
    -------
    (H, W, 3) uint8 RGB image.
    """
    p = dict(DEFAULTS)
    p.update(kw)
    rng = np.random.RandomState(int(p["seed"]))
    Z = Z_skin.astype(np.float32)
    H, W = Z.shape
    valid = valid.astype(bool)
    if p["pre_blur"] > 0:
        Z = gaussian_filter(Z, p["pre_blur"])                      # 1. pre-blur mesh
    gate = gaussian_filter(valid.astype(np.float32), 2.0)

    # 2. smooth-envelope drape -> distance
    Zenv = grey_dilation(Z, size=max(3, int(0.30 * ppcm)))
    C = np.maximum(gaussian_filter(Zenv, 0.55 * ppcm), Z + 0.02)
    dist = gaussian_filter((C - Z).astype(np.float32), 0.8)
    maxd = np.nanpercentile(dist[valid], 99) + 1e-6

    # 3. sigmoid normal de-shade
    Zpx = gaussian_filter(Z * ppcm, 2.0)
    gx, gy = np.gradient(Zpx)
    natt = 1.0 / (1.0 + np.exp(-12.0 * (1.0 / np.sqrt(gx**2 + gy**2 + 1.0) - 0.40)))

    # 4. base intensity + lateral diffusion
    TAU = 1.9 * np.nanpercentile(dist[valid], 80)
    tone = np.exp(-dist / TAU)
    tone = np.clip(tone, 0, np.nanpercentile(np.where(valid, tone, np.nan), 98))
    tone = tone / np.nanmax(np.where(valid, tone, np.nan)) * natt
    inten = np.clip(p["contrast"] * tone, 0, 1) * gate
    if p["diffusion"] > 0:
        inten = gaussian_filter(inten, p["diffusion"]) * gate
    # variable blur (distance-binned)
    sig = (dist / maxd) * 4.0
    bl = np.zeros_like(inten)
    e = np.linspace(0, 4.0, 10)
    for i in range(9):
        m = (sig >= e[i]) & (sig < e[i + 1] + 1e-6)
        if m.any():
            bl[m] = gaussian_filter(inten, (e[i] + e[i + 1]) / 2)[m]
    inten = bl
    # 5. exposure floor
    inten = (p["bg_floor"] + inten * (1.0 - p["bg_floor"])) * gate

    # 6. pirn banding
    def band1d(nn, s, a, sd):
        r = gaussian_filter(np.random.RandomState(sd).standard_normal(nn).astype(np.float32), s)
        return 1.0 + a * r / (r.std() + 1e-6)

    inten = inten * (band1d(H, 22, 0.09, 11)[:, None] * band1d(W, 30, 0.07, 12)[None, :])

    # 7. slub-noise weave
    raw = rng.standard_normal((H, W)).astype(np.float32)
    from scipy.ndimage import rotate
    rib1 = rotate(gaussian_filter(raw, (1.2, 3.5)), 45, reshape=False, mode="nearest")
    rib2 = rotate(gaussian_filter(raw, (1.2, 3.5)), -45, reshape=False, mode="nearest")
    weave = _n(rib1 + rib2)

    # 8. optional geometry warp
    if p["warp_geometry"]:
        dx = _n(gaussian_filter(rng.random((H, W)).astype(np.float32), 20)) * p["warp_amplitude"]
        dy = _n(gaussian_filter(rng.random((H, W)).astype(np.float32), 20)) * p["warp_amplitude"]
        inten = _warp(inten, dx, dy)
        weave = _warp(weave, dx, dy)

    # 9. alpha-transparency blend over mottled linen
    linen = np.clip(
        0.50
        + 0.030 * _n(gaussian_filter(rng.random((H, W)).astype(np.float32), 9))
        + 0.018 * _n(gaussian_filter(rng.random((H, W)).astype(np.float32), 2)),
        0, 1,
    )
    clump = gaussian_filter(rng.random((H, W)).astype(np.float32), 1.0)
    clump = (clump - clump.min()) / (clump.max() - clump.min() + 1e-9)
    wt01 = (weave - weave.min()) / (weave.max() - weave.min() + 1e-9)
    inorm = np.clip(inten / (np.percentile(inten[valid], 99) + 1e-6), 0, 1)
    alpha = (inorm**1.3) * p["max_opacity"] * (0.75 + 0.25 * wt01) * (0.55 + 0.45 * clump)
    alpha = np.clip(alpha, 0, 1) * gate
    face_color = 0.50 + 0.50 * inorm
    gray = np.clip(alpha * face_color + (1 - alpha) * linen, 0, 1)

    # 10. sepia-scorch colour
    rgb = sepia_curve(gray) if p["sepia"] else np.dstack([gray, gray, gray])
    return (np.clip(rgb, 0, 1) * 255).astype(np.uint8)


def landmarks_to_depth(pts, H, W, pad=0.12):
    """Face-mesh landmarks (N x 3; x/y in pixels, z relative) -> (Z_skin, valid)."""
    from scipy.interpolate import griddata
    xy = pts[:, :2]
    z = -pts[:, 2].astype(np.float32)                      # nearer = larger
    z = (z - z.min()) / (z.max() - z.min() + 1e-9)
    gy, gx = np.mgrid[0:H, 0:W]
    Z = griddata(xy, z, (gx, gy), method="linear", fill_value=0.0).astype(np.float32)
    # valid = filled convex hull of the face points
    from scipy.spatial import ConvexHull
    from matplotlib.path import Path
    try:
        hull = ConvexHull(xy)
        poly = Path(xy[hull.vertices])
        pts_grid = np.vstack([gx.ravel(), gy.ravel()]).T
        valid = poly.contains_points(pts_grid).reshape(H, W)
    except Exception:
        valid = Z > 0.02
    Z = gaussian_filter(np.where(valid, Z, 0), 1.5)
    return Z * 3.0, valid                                   # scale to ~3 cm relief
