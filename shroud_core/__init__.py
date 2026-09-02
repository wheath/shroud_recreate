"""shroud_core — the shared Shroud-ify image-formation engine (NumPy/SciPy, cv2-free)."""
from .engine import shroudify, landmarks_to_depth, sepia_curve, DEFAULTS

__all__ = ["shroudify", "landmarks_to_depth", "sepia_curve", "DEFAULTS"]
__version__ = "0.1.0"
