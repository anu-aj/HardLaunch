"""Load and save users as JSON files in data/."""

import json
from pathlib import Path

from hardlaunch.models import User

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SAMPLE_USERS = DATA_DIR / "sample_users.json"
LOCAL_USERS = DATA_DIR / "local_users.json"  # people who took the quiz here; gitignored
CURRENT_PROFILE = DATA_DIR / "current_profile.json"


def load_users(path=SAMPLE_USERS):
    path = Path(path)
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return [User.from_dict(item) for item in json.load(f)]


def save_users(users, path):
    write_json([u.to_dict() for u in users], path)


def write_json(data, path):
    """Write a complete replacement before replacing the previous JSON file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    temporary.replace(path)


def load_current(path=CURRENT_PROFILE):
    path = Path(path)
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save_local_user(user, path=LOCAL_USERS):
    """Add or replace `user` (matched by id) in the local users file."""
    users = [u for u in load_users(path) if u.id != user.id]
    users.append(user)
    save_users(users, path)


def load_pool():
    """Everyone who can be matched: the sample users plus anyone saved locally."""
    return load_users(SAMPLE_USERS) + load_users(LOCAL_USERS)
