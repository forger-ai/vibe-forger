from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AppSetting(SQLModel, table=True):
    """Placeholder model for skeleton projects.

    Keep at least one table so DB init/create_all always has a concrete target.
    """

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    key: str = Field(index=True, unique=True)
    value: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
