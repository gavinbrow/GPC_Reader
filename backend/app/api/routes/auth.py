"""Authentication routes — simple token-based auth for Phase 1."""

import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.config import settings
from app.db.session import get_db
from app.models import SessionRecord, User
from app.schemas import LoginRequest, LoginResponse, LogoutResponse, UserResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def get_current_user(
    authorization: str | None = Header(None),
    token: str | None = Query(None),
    db: Session = Depends(get_db),
) -> User | None:
    """Dependency that resolves the current user from a bearer token.

    For Phase 1 auth is optional — if no token is provided, returns None.
    """
    raw_token: str | None = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization[7:]
    elif token:
        raw_token = token

    if not raw_token:
        return None

    token_hash = _hash_token(raw_token)
    session = db.query(SessionRecord).filter(
        SessionRecord.token_hash == token_hash,
        SessionRecord.revoked == False,
    ).first()

    if session is None:
        return None

    # Check expiry
    if session.expires_at and session.expires_at < datetime.utcnow():
        return None

    user = db.query(User).filter(User.id == session.user_id).first()
    if user is None:
        return None

    # Update last_active
    user.last_active = datetime.utcnow()
    db.commit()

    return user


def require_user(user: User | None = Depends(get_current_user)) -> User:
    """Strict dependency — raises 401 if no user is authenticated."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return user


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """Log in (or create) a user by display name and return a session token."""
    # Find or create user
    user = db.query(User).filter(User.display_name == body.display_name).first()
    if user is None:
        user = User(display_name=body.display_name)
        db.add(user)
        db.flush()

    # Generate token
    token = secrets.token_hex(32)
    token_hash = _hash_token(token)
    expires_at = datetime.utcnow() + timedelta(days=settings.SESSION_EXPIRY_DAYS)

    session = SessionRecord(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    db.add(session)

    # Update user session token for convenience
    user.session_token = token_hash
    user.last_active = datetime.utcnow()
    db.commit()

    return LoginResponse(
        user_id=user.id,
        display_name=user.display_name,
        token=token,
        expires_at=expires_at,
    )


@router.post("/logout", response_model=LogoutResponse)
def logout(
    authorization: str | None = Header(None),
    token: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Revoke the current session."""
    raw_token: str | None = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization[7:]
    elif token:
        raw_token = token

    if not raw_token:
        return LogoutResponse(message="No active session")

    token_hash = _hash_token(raw_token)
    session = db.query(SessionRecord).filter(
        SessionRecord.token_hash == token_hash,
        SessionRecord.revoked == False,
    ).first()

    if session:
        session.revoked = True
        db.commit()

    return LogoutResponse(message="Logged out")


@router.get("/me", response_model=UserResponse)
def me(user: User | None = Depends(get_current_user)):
    """Return the current authenticated user."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return UserResponse.model_validate(user)
