"""Pytest configuration for the Astra Reader backend tests."""

import os
import sys

import pytest

_backend_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)


@pytest.fixture(autouse=True)
def _reset_upload_rate_limiter():
    """Clear the in-process upload rate limiter before each test.

    The upload route uses a module-level ``RateLimiter`` with a 60-second
    window.  When the full suite runs in a few seconds the budget is
    exhausted and later upload tests spuriously receive 429.  Resetting it
    per test keeps the suite deterministic without altering production
    rate-limiting behaviour.
    """
    try:
        from app.api.routes import files
        files._rate_limiter._requests.clear()
    except Exception:
        pass
    yield
