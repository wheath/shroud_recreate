"""Smoke test: the engine imports and renders a synthetic face without error."""
import numpy as np

from shroud_core import shroudify, DEFAULTS


def _synthetic_face(H=96, W=80):
    yy, xx = np.mgrid[0:H, 0:W]
    # a smooth Gaussian bump standing in for a face's relief
    Z = np.exp(-(((xx - W / 2) / 18) ** 2 + ((yy - H / 2) / 22) ** 2)).astype(np.float32) * 3.0
    valid = Z > 0.05
    return Z, valid


def test_shroudify_shape_and_dtype():
    Z, valid = _synthetic_face()
    img = shroudify(Z, valid, ppcm=10.0, seed=1)
    assert img.shape == (Z.shape[0], Z.shape[1], 3)
    assert img.dtype == np.uint8


def test_deterministic_seed():
    Z, valid = _synthetic_face()
    a = shroudify(Z, valid, ppcm=10.0, seed=7)
    b = shroudify(Z, valid, ppcm=10.0, seed=7)
    assert np.array_equal(a, b), "same seed must be pixel-identical"


def test_grayscale_toggle():
    Z, valid = _synthetic_face()
    gray = shroudify(Z, valid, ppcm=10.0, sepia=False, seed=1)
    # grayscale => the three channels are equal
    assert np.array_equal(gray[..., 0], gray[..., 1])
    assert np.array_equal(gray[..., 1], gray[..., 2])


def test_defaults_present():
    for k in ("pre_blur", "diffusion", "contrast", "max_opacity", "sepia", "seed"):
        assert k in DEFAULTS
