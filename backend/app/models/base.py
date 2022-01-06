from datetime import datetime

from .. import clock


def utcnow() -> datetime:
    """Column default for timestamps; honours FROZEN_NOW via `app.clock`."""
    return clock.now()
