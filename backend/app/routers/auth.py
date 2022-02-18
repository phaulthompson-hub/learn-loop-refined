"""Sign up, sign in, sign out and the current-user payload."""

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import access_for, current_session, current_user
from ..models import AuthSession, User
from ..schemas.auth import LoginIn, MeOut, RegisterIn, TokenOut
from ..security import password_problems, verify_password
from ..services.accounts import (
    accept_invitation,
    create_user,
    create_workspace,
    find_user_by_email,
    me_payload,
    start_session,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, db: Session = Depends(get_db), user_agent: str = Header(default="")):
    user = find_user_by_email(db, data.email)
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Email or password is incorrect")
    if not user.is_active:
        raise HTTPException(403, "This account has been deactivated")
    token = start_session(db, user, user_agent)
    return {**me_payload(db, user), "token": token}


@router.post("/register", response_model=TokenOut, status_code=201)
def register(data: RegisterIn, db: Session = Depends(get_db), user_agent: str = Header(default="")):
    problems = password_problems(data.password)
    if problems:
        raise HTTPException(422, f"Password {' and '.join(problems)}")
    user = create_user(db, name=data.name, email=data.email, password=data.password)
    if data.invitation_token:
        accept_invitation(db, user, data.invitation_token)
    else:
        create_workspace(db, owner=user, name=data.workspace_name or f"{user.name.split()[0]}'s workspace")
    db.commit()
    token = start_session(db, user, user_agent)
    return {**me_payload(db, user), "token": token}


@router.post("/logout", status_code=204)
def logout(session: AuthSession = Depends(current_session), db: Session = Depends(get_db)):
    db.delete(db.merge(session))
    db.commit()
    return Response(status_code=204)


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return me_payload(db, user)


@router.put("/me/workspace/{workspace_id}", response_model=MeOut)
def switch_workspace(workspace_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Remember the workspace the user is looking at, so the next sign-in opens it again."""
    access_for(db, user, workspace_id)
    user.last_workspace_id = workspace_id
    db.commit()
    return me_payload(db, user)
