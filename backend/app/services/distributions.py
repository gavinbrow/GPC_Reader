"""Molar-mass distributions via KDE or binned estimation.

Phase 3b replaces the Phase 3a binned histogram with a kernel density
estimate (``scipy.stats.gaussian_kde``) for the differential distribution,
integrated for the cumulative form.  For datasets with more than 5,000 slices
KDE becomes expensive (O(N^2)), so a binned estimator
(:func:`binned_distribution`) is used as a fallback.  See ``architecture.md``
§7.6.

The Phase 3a :func:`binned_distribution` is retained verbatim as the fallback
path and for backwards compatibility with existing callers.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
from scipy.stats import gaussian_kde

KDE_FALLBACK_THRESHOLD = 5000


def _clean(arr) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    return np.where(np.isfinite(a), a, np.nan)


def binned_distribution(molar_mass, concentration, n_bins: int = 50,
                        log_scale: bool = True):
    """Compute a simple binned molar-mass distribution.

    Parameters
    ----------
    molar_mass : array-like
        Per-slice molar mass (g/mol).
    concentration : array-like
        Per-slice concentration (g/mL).
    n_bins : int
        Number of histogram bins.
    log_scale : bool
        If True, bins are log-spaced; otherwise linear.

    Returns
    -------
    dict
        ``{"bin_centers": ndarray, "weights": ndarray, "bin_edges": ndarray}``
    """
    m = _clean(molar_mass)
    c = _clean(concentration)
    n = min(m.size, c.size)
    if n == 0:
        return {"bin_centers": np.array([]), "weights": np.array([]),
                "bin_edges": np.array([])}
    m = m[:n]
    c = c[:n]
    valid = np.isfinite(m) & np.isfinite(c) & (m > 0) & (c > 0)
    if valid.sum() < 2:
        return {"bin_centers": np.array([]), "weights": np.array([]),
                "bin_edges": np.array([])}
    mv = m[valid]
    cv = c[valid]

    if log_scale:
        lo = np.log10(mv.min())
        hi = np.log10(mv.max())
    else:
        lo = float(mv.min())
        hi = float(mv.max())
    if hi <= lo:
        return {"bin_centers": np.array([]), "weights": np.array([]),
                "bin_edges": np.array([])}
    edges = np.linspace(lo, hi, n_bins + 1)
    if log_scale:
        bin_edges = 10.0 ** edges
        centers = 10.0 ** (0.5 * (edges[:-1] + edges[1:]))
        bin_idx = np.digitize(np.log10(mv), edges) - 1
    else:
        bin_edges = edges
        centers = 0.5 * (edges[:-1] + edges[1:])
        bin_idx = np.digitize(mv, edges) - 1

    weights = np.zeros(n_bins)
    for i, idx in enumerate(bin_idx):
        if 0 <= idx < n_bins:
            weights[idx] += cv[i]

    return {"bin_centers": centers, "weights": weights, "bin_edges": bin_edges}


def _kde_distribution(molar_mass, concentration, n_bins: int = 50,
                      bandwidth: Optional[float] = None,
                      kernel: str = "gaussian",
                      log_scale: bool = True,
                      range_min: Optional[float] = None,
                      range_max: Optional[float] = None):
    """KDE-based differential distribution.

    The KDE is built on the molar-mass values weighted by concentration.  The
    resulting density is evaluated on a grid of ``n_bins`` points and then
    multiplied by the total concentration so that the returned ``weights``
    are directly comparable to :func:`binned_distribution` (i.e. summing them
    approximates the total concentration).
    """
    m = _clean(molar_mass)
    c = _clean(concentration)
    n = min(m.size, c.size)
    if n == 0:
        return {"bin_centers": np.array([]), "weights": np.array([]),
                "bin_edges": np.array([]), "cumulative": np.array([]),
                "bandwidth": None, "kernel": kernel, "method": "kde"}
    m = m[:n]
    c = c[:n]
    valid = np.isfinite(m) & np.isfinite(c) & (m > 0) & (c > 0)
    if range_min is not None:
        valid &= (m >= range_min)
    if range_max is not None:
        valid &= (m <= range_max)
    if valid.sum() < 2:
        return {"bin_centers": np.array([]), "weights": np.array([]),
                "bin_edges": np.array([]), "cumulative": np.array([]),
                "bandwidth": None, "kernel": kernel, "method": "kde"}
    mv = m[valid]
    cv = c[valid]

    if log_scale:
        lo = float(np.log10(mv.min()))
        hi = float(np.log10(mv.max()))
    else:
        lo = float(mv.min())
        hi = float(mv.max())
    if hi <= lo:
        return {"bin_centers": np.array([]), "weights": np.array([]),
                "bin_edges": np.array([]), "cumulative": np.array([]),
                "bandwidth": None, "kernel": kernel, "method": "kde"}

    edges = np.linspace(lo, hi, n_bins + 1)
    centers_log = 0.5 * (edges[:-1] + edges[1:])
    if log_scale:
        centers = 10.0 ** centers_log
        bin_edges = 10.0 ** edges
        sample_coords = np.log10(mv)
        grid = centers_log
    else:
        centers = centers_log
        bin_edges = edges
        sample_coords = mv
        grid = centers

    total_c = float(np.sum(cv))
    weights_arr = cv / total_c if total_c > 0 else cv

    try:
        kde = gaussian_kde(sample_coords, weights=weights_arr, bw_method=bandwidth)
    except Exception:
        return {"bin_centers": np.array([]), "weights": np.array([]),
                "bin_edges": np.array([]), "cumulative": np.array([]),
                "bandwidth": None, "kernel": kernel, "method": "kde"}

    try:
        bw_used = float(kde.factor)
    except Exception:
        bw_used = None

    density = kde(grid)
    dx = np.diff(edges)
    diff_weights = density * dx * total_c

    cum = np.concatenate([[0.0], np.cumsum(diff_weights)])
    if cum[-1] > 0:
        cumulative = cum / cum[-1]
    else:
        cumulative = cum

    return {"bin_centers": centers, "weights": diff_weights,
            "bin_edges": bin_edges, "cumulative": cumulative,
            "bandwidth": bw_used, "kernel": kernel, "method": "kde"}


def compute_distribution(molar_mass, concentration, n_bins: int = 50,
                        bandwidth: Optional[float] = None,
                        kernel: str = "gaussian",
                        log_scale: bool = True,
                        range_min: Optional[float] = None,
                        range_max: Optional[float] = None):
    """Compute a molar-mass distribution, choosing KDE or binned fallback.

    For datasets with more than ``KDE_FALLBACK_THRESHOLD`` (5,000) slices the
    binned estimator is used for performance; otherwise a weighted Gaussian
    KDE is built on the molar-mass values.  See ``architecture.md`` §7.6.

    Parameters
    ----------
    molar_mass : array-like
        Per-slice molar mass (g/mol).
    concentration : array-like
        Per-slice concentration (g/mL).
    n_bins : int
        Number of grid points / bins.
    bandwidth : float, optional
        KDE bandwidth override.  ``None`` uses Scott's rule.
    kernel : str
        Kernel name (only ``"gaussian"`` is supported by ``scipy.stats``).
    log_scale : bool
        If True (default), work in log10(molar mass) space.
    range_min, range_max : float, optional
        Optional molar-mass filter window applied before fitting.

    Returns
    -------
    dict
        ``{"bin_centers", "weights", "bin_edges", "cumulative",
           "bandwidth", "kernel", "method"}`` where ``method`` is ``"kde"``
        or ``"binned"``.
    """
    m = _clean(molar_mass)
    c = _clean(concentration)
    n = min(m.size, c.size)
    if n == 0:
        return {"bin_centers": np.array([]), "weights": np.array([]),
                "bin_edges": np.array([]), "cumulative": np.array([]),
                "bandwidth": None, "kernel": kernel, "method": "kde"}
    m = m[:n]
    c = c[:n]
    valid = np.isfinite(m) & np.isfinite(c) & (m > 0) & (c > 0)
    if range_min is not None:
        valid &= (m >= range_min)
    if range_max is not None:
        valid &= (m <= range_max)
    mv = m[valid]
    cv = c[valid]

    if mv.size > KDE_FALLBACK_THRESHOLD:
        binned = binned_distribution(mv, cv, n_bins=n_bins, log_scale=log_scale)
        weights = binned["weights"]
        total = float(np.sum(weights))
        if total > 0:
            cumulative = np.cumsum(weights) / total
        else:
            cumulative = np.zeros_like(weights)
        return {"bin_centers": binned["bin_centers"], "weights": weights,
                "bin_edges": binned["bin_edges"], "cumulative": cumulative,
                "bandwidth": None, "kernel": kernel, "method": "binned"}

    return _kde_distribution(mv, cv, n_bins=n_bins, bandwidth=bandwidth,
                             kernel=kernel, log_scale=log_scale)
