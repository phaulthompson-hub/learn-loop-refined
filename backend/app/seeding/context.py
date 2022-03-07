from dataclasses import dataclass, field
from datetime import datetime, timedelta
from random import Random

from sqlalchemy.orm import Session

from ..models import Course, User, Workspace

DEMO_PASSWORD = "learnloop123"


@dataclass
class SeedContext:
    """Everything feature seeders need: the session, the anchor time and the rows created so far.

    `users`, `workspaces` and `courses` are keyed by short stable names ("alex", "northwind",
    "ml") so seeders can refer to them without looking up ids.
    """

    db: Session
    now: datetime
    rng: Random
    users: dict[str, User] = field(default_factory=dict)
    workspaces: dict[str, Workspace] = field(default_factory=dict)
    courses: dict[str, Course] = field(default_factory=dict)
    # course key -> workspace key
    course_workspace: dict[str, str] = field(default_factory=dict)
    # workspace key -> member user keys (in a stable order)
    members: dict[str, list[str]] = field(default_factory=dict)

    def at(self, days_ago: float = 0, hour: int = 9, minute: int = 0) -> datetime:
        """A timestamp `days_ago` days before the anchor day, at a fixed time of day."""
        day = self.now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days_ago)
        return day.replace(hour=hour, minute=minute)

    def ahead(self, days: float = 0, hour: int = 9, minute: int = 0) -> datetime:
        return self.at(-days, hour, minute)
