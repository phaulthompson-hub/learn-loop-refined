"""Users, login sessions, workspaces, memberships and invitations."""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from ..database import Base
from .base import utcnow

ROLES = ("learner", "instructor", "admin", "owner")
THEMES = ("light", "dark", "system")


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(254), unique=True, index=True, nullable=False)
    name = Column(String(80), nullable=False)
    password_hash = Column(String(200), nullable=False)
    avatar_color = Column(String(16), default="#1d6d45", nullable=False)
    headline = Column(String(120), default="", nullable=False)
    bio = Column(Text, default="", nullable=False)
    timezone = Column(String(64), default="UTC", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    # Preferences
    theme = Column(String(12), default="light", nullable=False)
    daily_goal_minutes = Column(Integer, default=30, nullable=False)
    quiz_length = Column(Integer, default=4, nullable=False)
    week_starts_on = Column(Integer, default=0, nullable=False)  # 0 = Monday, 6 = Sunday
    email_digest = Column(Boolean, default=True, nullable=False)
    reduced_motion = Column(Boolean, default=False, nullable=False)
    last_workspace_id = Column(Integer, nullable=True)

    memberships = relationship("Membership", back_populates="user", cascade="all, delete-orphan")


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id = Column(Integer, primary_key=True)
    user_id = Column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    token_hash = Column(String(64), unique=True, index=True, nullable=False)
    user_agent = Column(String(255), default="", nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    last_seen_at = Column(DateTime, default=utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    user = relationship("User")


class Workspace(Base):
    __tablename__ = "workspaces"
    id = Column(Integer, primary_key=True)
    name = Column(String(80), nullable=False)
    slug = Column(String(80), unique=True, index=True, nullable=False)
    description = Column(Text, default="", nullable=False)
    color = Column(String(16), default="#1d6d45", nullable=False)
    owner_id = Column(ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    memberships = relationship(
        "Membership", back_populates="workspace", cascade="all, delete-orphan", order_by="Membership.id"
    )


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id"),)
    id = Column(Integer, primary_key=True)
    workspace_id = Column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id = Column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    role = Column(String(16), default="learner", nullable=False)
    joined_at = Column(DateTime, default=utcnow, nullable=False)
    workspace = relationship("Workspace", back_populates="memberships")
    user = relationship("User", back_populates="memberships")


class Invitation(Base):
    __tablename__ = "invitations"
    id = Column(Integer, primary_key=True)
    workspace_id = Column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    email = Column(String(254), nullable=False)
    role = Column(String(16), default="learner", nullable=False)
    status = Column(String(16), default="pending", nullable=False)  # pending | accepted | revoked
    token = Column(String(64), unique=True, nullable=False)
    message = Column(Text, default="", nullable=False)
    invited_by_id = Column(ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    invited_by = relationship("User")
