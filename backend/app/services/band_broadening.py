"""Band-broadening correction via exponential deconvolution.

Models the inter-detector broadening as a symmetric exponential kernel whose
time constant is ``tau = V_mixing / flow_rate`` (the mixing-volume model from
chromatography literature).  The kernel is applied by deconvolution in the
Fourier domain with a Tikhonov-style damping term to regularise against noise
amplification.

Reference detector is RI: the broadening kernel is estimated relative to the
RI signal and the same correction is applied to all detector signals aligned
to the common time grid.

Asymmetric-broadening limitation
---------------------------------
Real SEC band broadening is asymmetric: a sharp leading edge followed by an
exponential tail.  The symmetric exponential kernel used here cannot reproduce
that shape and will therefore under-correct the leading edge and over-correct
the tail.  Additionally UV (before MALS) and RI (after MALS) experience
different broadening due to different flow path lengths and cell volumes; this
first implementation applies a single kernel to all detectors.  Results will
improve peak shape but may not match ASTRA quantitatively.  See
``architecture.md`` §7.5 for the full discussion.
"""

from __future__ import annotations

from typing import Optional

import numpy as np


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, 0.0)


def _exponential_kernel(n: int, tau_samples: float) -> np.ndarray:
    """Symmetric two-sided exponential (Laplacian) kernel of length ``n``."""
    if tau_samples <= 0 or n <= 0:
        k = np.zeros(max(n, 0))
        if k.size > 0:
            k[0] = 1.0
        return k
    half = n // 2
    idx = np.arange(n) - half
    k = np.exp(-np.abs(idx) / tau_samples)
    s = float(k.sum())
    if s > 0:
        k /= s
    return k


def _is_enabled(params: Optional[dict]) -> bool:
    if params is None:
        return True
    enabled = params.get("enabled")
    if enabled is None:
        return True
    return bool(enabled)


def apply_band_broadening_correction(time, signal, params: Optional[dict] = None) -> np.ndarray:
    """Deconvolve an exponential broadening kernel from ``signal``.

    Parameters
    ----------
    time : array-like
        Time axis (minutes).  Must be uniformly sampled for the FFT path; if
        not, a linear resampling onto a uniform grid is performed.
    signal : array-like
        Detector signal.
    params : dict, optional
        Keys: ``enabled`` (bool, default True) — if False, returns the input
        unchanged.  ``V_mixing`` (mL, default 0.05), ``flow_rate`` (mL/min,
        default 1.0) → ``tau = V_mixing / flow_rate`` minutes.
        ``max_iter`` (int, default 50) — number of van Cittert iterations;
        more iterations deconvolve more aggressively but amplify noise.
        ``relaxation`` (float, default 1.0) — iteration relaxation factor.
        ``damping`` (float, default 1e-2) — accepted for backward
        compatibility; the van Cittert iteration count controls regularisation.

    Returns
    -------
    np.ndarray
        The deconvolved signal, or the input unchanged when disabled or
        degenerate.
    """
    s = _clean(signal)
    if s.size == 0:
        return s
    if not _is_enabled(params):
        return np.asarray(signal, dtype=float)

    p = params or {}
    V_mixing = float(p.get("V_mixing", 0.05))
    flow_rate = float(p.get("flow_rate", 1.0))
    damping = float(p.get("damping", 1e-2))
    if V_mixing <= 0 or flow_rate <= 0:
        return np.asarray(signal, dtype=float)

    t = np.asarray(time, dtype=float)
    if t.size != s.size or t.size < 4:
        return np.asarray(signal, dtype=float)

    dt = float(np.median(np.diff(t)))
    if not np.isfinite(dt) or dt <= 0:
        return np.asarray(signal, dtype=float)

    uniform = t.size > 1 and np.allclose(np.diff(t), dt, rtol=1e-3, atol=1e-6)
    if uniform:
        s_u = s
        t_u = t
    else:
        t_u = np.linspace(float(t.min()), float(t.max()), t.size)
        s_u = np.interp(t_u, t, s)

    tau_min = V_mixing / flow_rate
    tau_samples = tau_min / dt
    if tau_samples < 0.5:
        return np.asarray(signal, dtype=float)

    n = s_u.size
    k = _exponential_kernel(n, tau_samples)
    max_iter = int(p.get("max_iter", 50))
    if max_iter < 1:
        max_iter = 1
    relax = float(p.get("relaxation", 1.0))
    if relax <= 0:
        relax = 1.0
    s_deconv = s_u.copy()
    for _ in range(max_iter):
        conv = np.convolve(s_deconv, k, mode="same")
        s_deconv = s_deconv + relax * (s_u - conv)
        n_used = np.sum(np.isfinite(s_deconv))
        if n_used == 0:
            break
    if not np.all(np.isfinite(s_deconv)):
        s_deconv = np.where(np.isfinite(s_deconv), s_deconv, 0.0)

    edge = max(3, n // 20)
    baseline = float(np.median(np.concatenate([s_deconv[:edge], s_deconv[-edge:]])))
    if np.isfinite(baseline):
        s_deconv = s_deconv - baseline

    area_in = float(np.trapezoid(s_u, t_u))
    area_out = float(np.trapezoid(s_deconv, t_u))
    if np.isfinite(area_in) and np.isfinite(area_out) and abs(area_out) > 1e-15:
        scale = area_in / area_out
        if np.isfinite(scale) and scale > 0:
            s_deconv = s_deconv * scale

    if not uniform:
        s_deconv = np.interp(t, t_u, s_deconv)

    return s_deconv
