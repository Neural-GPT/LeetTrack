from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.models.enums import Role
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

# Only write last_seen_at if it's this stale — avoids a DB write on
# literally every request just to track presence.
PRESENCE_UPDATE_THROTTLE = timedelta(seconds=60)


def get_current_user(
    token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_error

    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise credentials_error

    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise credentials_error

    now = datetime.now(timezone.utc)
    last_seen = user.last_seen_at.replace(tzinfo=timezone.utc) if user.last_seen_at else None
    if not last_seen or now - last_seen > PRESENCE_UPDATE_THROTTLE:
        user.last_seen_at = now.replace(tzinfo=None)
        db.commit()

    return user


def require_role(*roles: Role):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to do that.",
            )
        return user

    return checker
