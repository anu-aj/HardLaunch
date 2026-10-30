"""A local conversation demo using lists, dictionaries and a JSON file.

There are no accounts: the presenter explicitly switches the active profile.
Only two eligible, completed local profiles can start a conversation.
"""

from datetime import datetime, timezone
import uuid

from hardlaunch import connections, storage
from hardlaunch.models import User
from hardlaunch.scoring import eligible, public_profile


class ConversationError(ValueError):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def load_conversations(path):
    data = storage.load_current(path)
    if data is None:
        return []
    if not isinstance(data, list):
        raise ValueError("The conversations file must contain a list.")
    return data


def find_conversation(items, conversation_id, person):
    for item in items:
        if item["id"] == conversation_id:
            if person.id not in item["participants"]:
                raise ConversationError("This conversation belongs to other profiles.", 403)
            return item
    raise ConversationError("That conversation was not found.", 404)


def conversation_details(item, person, users, state=None):
    other_id = next(pid for pid in item["participants"] if pid != person.id)
    other = next((user for user in users if user.id == other_id), None)
    unmatched = bool(state is not None and connections.is_unmatched(state, person.id, other_id))
    active = (connections.active_pair(state, person.id, other_id) if state is not None
              else bool(other and eligible(person, other)))
    both_said_yes = True
    if state is not None:
        both_said_yes = connections.meet_status(state, person.id, other_id) == "mutual"
    can_send = bool(other and active and not unmatched and eligible(person, other) and both_said_yes)
    reason = ""
    if unmatched:
        reason = "This connection has ended. Your saved conversation is read-only."
    elif active and not both_said_yes:
        reason = "Chat opens once you both choose \"I'd like to meet\"."
    elif not can_send:
        reason = "This connection is no longer active. Your saved conversation is read-only."
    return {"id": item["id"], "other": public_profile(other) if other else {"id": other_id, "name": "Unavailable profile"},
            "messages": item["messages"], "can_send": can_send, "unmatched": unmatched,
            "is_active_match": active, "can_unmatch": bool(active and not unmatched), "unavailable_reason": reason}


def start_conversation(items, person, other, state=None):
    if not other or not eligible(person, other):
        raise ConversationError("Choose an eligible, completed local profile to start a conversation.")
    if state is not None and not connections.active_pair(state, person.id, other.id):
        raise ConversationError("Choose one of your active matches. Ended connections cannot be reopened.")
    if state is not None and connections.meet_status(state, person.id, other.id) != "mutual":
        raise ConversationError("Chat opens once you both choose \"I'd like to meet\".")
    participants = sorted([person.id, other.id])
    for item in items:
        if item["participants"] == participants:
            return item
    item = {"id": uuid.uuid4().hex, "participants": participants, "messages": []}
    items.append(item)
    return item


def add_message(item, person, users, text, state=None):
    details = conversation_details(item, person, users, state)
    if not details["can_send"]:
        raise ConversationError(details["unavailable_reason"])
    if not isinstance(text, str) or not text.strip() or len(text.strip()) > 1000:
        raise ConversationError("Write a message between 1 and 1,000 characters.")
    message = {"id": uuid.uuid4().hex, "sender_id": person.id, "text": text.strip(),
               "sent_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    item["messages"].append(message)
    return message


def demo_pair():
    """Two fictional casual profiles, ready for a short classroom demo."""
    common = {"city": "Sydney", "age_min": 23, "age_max": 35, "intention": "Casual dating",
              "interests": ["Coffee", "Films"], "status": "complete", "prompt": "sunday"}
    return [
        User(id="demo-avery", name="Avery", age=26, gender="woman", preferred_genders=["man"],
             avatar="flower", role="Graphic designer", company="Paper Moon Studio (fictional)",
             building_toward="A slow coffee, a new film, and no rushing around.", **common),
        User(id="demo-jordan", name="Jordan", age=28, gender="man", preferred_genders=["woman"],
             avatar="sun", role="Software developer", company="Little Orbit (fictional)",
             building_toward="Finding a new cafe, then catching an afternoon film.", **common),
    ]
