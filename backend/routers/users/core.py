"""Admin user management endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from ...config import SessionLocal
from ...models import User, Campaign
from ...auth import require_admin, CurrentUser, hash_password
from ._schemas import UserCreate, UserUpdate

router = APIRouter()


def list_users(_: CurrentUser = Depends(require_admin)):
    db = SessionLocal()
    try:
        users = db.query(User).order_by(User.username).all()
        return [
            {
                "id": u.id,
                "username": u.username,
                "display_name": u.display_name,
                "email": u.email,
                "role": u.role,
                "allow_explicit": bool(u.allow_explicit) if u.allow_explicit is not None else True,
                "oidc_linked": bool(u.oidc_subject),
                "created_at": u.created_at.isoformat(),
            }
            for u in users
        ]
    finally:
        db.close()


def create_user(data: UserCreate, _: CurrentUser = Depends(require_admin)):
    db = SessionLocal()
    try:
        if db.query(User).filter_by(username=data.username.strip()).first():
            raise HTTPException(400, "Username already exists")
        if data.email and db.query(User).filter_by(email=data.email).first():
            raise HTTPException(400, "Email already in use")
        user = User(
            username=data.username.strip(),
            hashed_password=hash_password(data.password),
            role=data.role,
            email=data.email,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role": user.role,
        }
    finally:
        db.close()


def update_user(user_id: str, data: UserUpdate, _: CurrentUser = Depends(require_admin)):
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            raise HTTPException(404, "User not found")

        if data.role and data.role != "admin" and user.role == "admin":
            admin_count = db.query(User).filter_by(role="admin").count()
            if admin_count <= 1:
                raise HTTPException(400, "Cannot demote the last admin")

        if data.role:
            user.role = data.role
        if data.password:
            user.hashed_password = hash_password(data.password)
        if data.allow_explicit is not None:
            user.allow_explicit = data.allow_explicit
        if data.email is not None:
            new_email = data.email or None  # "" → clear
            if new_email and new_email != user.email:
                conflict = db.query(User).filter_by(email=new_email).first()
                if conflict and conflict.id != user.id:
                    raise HTTPException(400, "Email already in use")
            user.email = new_email

        db.commit()
        return {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "allow_explicit": bool(user.allow_explicit)
            if user.allow_explicit is not None
            else True,
        }
    finally:
        db.close()


def delete_user(user_id: str, current_user: CurrentUser = Depends(require_admin)):
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            raise HTTPException(404, "User not found")
        if user.id == current_user.id:
            raise HTTPException(400, "Cannot delete your own account")

        if user.role == "admin":
            admin_count = db.query(User).filter_by(role="admin").count()
            if admin_count <= 1:
                raise HTTPException(400, "Cannot delete the last admin")

        uid = user.id
        for campaign in db.query(Campaign).filter_by(owner_id=uid).all():
            db.delete(campaign)
        db.execute(text("DELETE FROM campaign_members WHERE user_id = :uid"), {"uid": uid})
        db.execute(text("DELETE FROM player_session_notes WHERE user_id = :uid"), {"uid": uid})
        db.execute(text("DELETE FROM session_availability WHERE user_id = :uid"), {"uid": uid})
        db.execute(text("DELETE FROM bookmarks WHERE user_id = :uid"), {"uid": uid})
        db.execute(text("DELETE FROM favorites WHERE user_id = :uid"), {"uid": uid})
        db.delete(user)
        db.commit()
    finally:
        db.close()
