"""Persist reciprocal connections and the server's rolling unmatch allowance.

Existing eligible pairs stay together. A private persisted seed gives equally
ranked new pairs a stable lottery order without favouring smaller profile IDs.

The rule: everyone has up to three active matches. Each person may unmatch two
people in any seven hours, and each unmatch is replaced straight away, so at
most five people are introduced in seven hours. Chat opens only after both
people choose "I'd like to meet". Blocking or reporting is always free.
Changing relationship type refreshes a person's matches without using an unmatch,
and can happen once every 30 days. HardLaunch is for people looking for a genuine
match, so they choose carefully, and switching away and back cannot be used to
get a new set of introductions.
"""

from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import secrets

from hardlaunch import scoring
from hardlaunch.catalog import requires_quiz

MAX_CONNECTIONS = 3
UNMATCH_LIMIT = 2
WINDOW_HOURS = 7
TYPE_CHANGE_DAYS = 30   # Relationship type is a real decision: it can change once a month.
UNMATCH_REASON = "did_not_vibe"
BLOCK_REASONS = ["blocked", "reported"]   # Safety actions never use the unmatch allowance.


class ConnectionError(ValueError):
    """An expected action failure, ready for the server's JSON response."""

    def __init__(self, status, payload=None):
        self.status = status
        self.payload = payload or {"error": "The connection could not be changed."}
        super().__init__(self.payload.get("error", "The connection could not be changed."))


def utc_now():
    """Kept separate so tests can control the server clock."""
    return datetime.now(timezone.utc)


def _utc(value=None):
    value = utc_now() if value is None else value
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Connection timestamps must include a timezone.")
    return value.astimezone(timezone.utc)


def _timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Connection timestamps must be ISO strings.")
    try:
        return _utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except (ValueError, TypeError) as error:
        raise ValueError("Connection timestamps must be valid timezone-aware ISO strings.") from error


def _pair(first, second):
    return tuple(sorted((first, second)))


def _valid_id(value):
    return isinstance(value, str) and bool(value.strip())


def _validate_state(state):
    """Reject malformed stored data rather than silently resetting history."""
    if not isinstance(state, dict) or not {"pairs", "unmatches", "tie_seed", "meet_requests", "type_changes"} <= state.keys():
        raise ValueError("Connection data is missing required fields.")
    if not isinstance(state["tie_seed"], str) or not state["tie_seed"].strip():
        raise ValueError("Connection data has an invalid lottery seed.")
    if not isinstance(state["pairs"], list) or not isinstance(state["unmatches"], list):
        raise ValueError("Connection pairs and unmatch history must be lists.")

    def checked_pair(value):
        if (not isinstance(value, list) or len(value) != 2
                or not all(_valid_id(pid) for pid in value) or value[0] == value[1]):
            raise ValueError("Connection data has invalid pair participants.")
        return _pair(*value)

    excluded = set()
    for event in state["unmatches"]:
        if not isinstance(event, dict) or not {"participants", "actor_id", "at", "reason"} <= event.keys():
            raise ValueError("Connection data has an incomplete unmatch event.")
        pair = checked_pair(event["participants"])
        if event["actor_id"] not in pair:
            raise ValueError("Connection data has an invalid unmatch event.")
        if event["reason"] != UNMATCH_REASON and event["reason"] not in BLOCK_REASONS:
            raise ValueError("Connection data has an invalid unmatch event.")
        _timestamp(event["at"])
        if pair in excluded:
            raise ValueError("Connection data repeats an unmatched pair.")
        excluded.add(pair)

    active = set()
    counts = {}
    for participants in state["pairs"]:
        pair = checked_pair(participants)
        if pair in active or pair in excluded:
            raise ValueError("Connection data repeats an active pair or restores an unmatched pair.")
        active.add(pair)
        for pid in pair:
            counts[pid] = counts.get(pid, 0) + 1
            if counts[pid] > MAX_CONNECTIONS:
                raise ValueError("Connection data exceeds the three-connection limit.")

    # Each request is [person who said yes, person they would like to meet].
    if not isinstance(state["meet_requests"], list):
        raise ValueError("Connection meet requests must be a list.")
    seen = []
    for request in state["meet_requests"]:
        checked_pair(request)
        if request in seen:
            raise ValueError("Connection data repeats a meet request.")
        seen.append(request)

    # Each change is {"profile_id": ..., "at": ...}: when someone changed relationship type.
    if not isinstance(state["type_changes"], list):
        raise ValueError("Connection relationship-type changes must be a list.")
    for change in state["type_changes"]:
        if not isinstance(change, dict) or not _valid_id(change.get("profile_id")):
            raise ValueError("Connection data has an invalid relationship-type change.")
        _timestamp(change.get("at"))
    return state


def load_state(path):
    """Load server-owned state; only a genuinely absent file starts fresh."""
    path = Path(path)
    if not path.exists():
        return {"pairs": [], "unmatches": [], "tie_seed": secrets.token_hex(32), "meet_requests": [],
                "type_changes": []}
    with path.open(encoding="utf-8") as source:
        state = json.load(source)
    if isinstance(state, dict) and "pairs" in state:
        # Files saved before these features existed start with empty lists.
        if "meet_requests" not in state:
            state["meet_requests"] = []
        if "type_changes" not in state:
            state["type_changes"] = []
        # Older files had a Premium list. Everyone now follows the same rule.
        if "premium_ids" in state:
            del state["premium_ids"]
    return _validate_state(state)


def active_pair(state, first, second):
    target = _pair(first, second)
    return any(_pair(*participants) == target for participants in state["pairs"])


def is_unmatched(state, first, second):
    target = _pair(first, second)
    return any(_pair(*event["participants"]) == target for event in state["unmatches"])


def _people(users):
    return {person.id: person for person in (users.values() if isinstance(users, dict) else users)}


def _lottery_key(seed, pair):
    # JSON makes IDs unambiguous even when they contain delimiter characters.
    value = json.dumps([seed, *pair], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(value.encode("utf-8")).digest()


def reconcile(state, users):
    """Retain eligible active pairs and fill only free slots for all intentions.

    New pairs are added best score first, in three rounds so nobody is left out:
      round 1: pairs that give both people their first match
      round 2: pairs that give one person their first match
      round 3: any remaining pair, while both people have a free place
    Random tie ordering removes profile-ID priority.
    """
    _validate_state(state)
    people = _people(users)
    counts = {pid: 0 for pid in people}
    retained = []
    for participants in state["pairs"]:
        first, second = participants
        if first in people and second in people and scoring.eligible(people[first], people[second]):
            retained.append(list(_pair(first, second)))
            counts[first] += 1
            counts[second] += 1
    active = {tuple(pair) for pair in retained}
    excluded = {_pair(*event["participants"]) for event in state["unmatches"]}
    available = sorted(pid for pid in people if counts[pid] < MAX_CONNECTIONS)
    candidates = []
    for index, first in enumerate(available):
        person = people[first]
        for second in available[index + 1:]:
            pair = (first, second)
            other = people[second]
            if pair in active or pair in excluded or not scoring.eligible(person, other):
                continue
            alignment = (scoring.compatible(person, other) if requires_quiz(person.intention)
                         else len(set(person.interests) & set(other.interests)))
            candidates.append((-alignment, _lottery_key(state["tie_seed"], pair), pair))
    candidates.sort()
    for needed in (2, 1, 0):   # How many of the two people must still have no match.
        for _, _, pair in candidates:
            first, second = pair
            if list(pair) in retained:
                continue
            if counts[first] >= MAX_CONNECTIONS or counts[second] >= MAX_CONNECTIONS:
                continue
            without_match = 0
            if counts[first] == 0:
                without_match = without_match + 1
            if counts[second] == 0:
                without_match = without_match + 1
            if without_match < needed:
                continue
            retained.append(list(pair))
            counts[first] += 1
            counts[second] += 1
    state["pairs"] = retained
    # A "yes" only counts while the match is still active.
    kept_requests = []
    for request in state["meet_requests"]:
        if active_pair(state, request[0], request[1]):
            kept_requests.append(request)
    state["meet_requests"] = kept_requests
    return state


def quota(state, profile_id, now=None):
    """Only the actor spends an allowance; events expire exactly seven hours later."""
    current = _utc(now)
    cutoff = current - timedelta(hours=WINDOW_HOURS)
    recent = []
    for event in state["unmatches"]:
        if event["actor_id"] != profile_id or event["reason"] != UNMATCH_REASON:
            continue   # Other people's unmatches and safety blocks never count.
        at = _timestamp(event["at"])
        if cutoff < at <= current:
            recent.append(at)
    recent.sort()
    used = len(recent)
    next_available = None
    if used >= UNMATCH_LIMIT:
        # The oldest unmatch that still counts decides when the next one returns.
        next_available = (recent[used - UNMATCH_LIMIT] + timedelta(hours=WINDOW_HOURS)).isoformat()
    return {"limit": UNMATCH_LIMIT, "remaining": max(0, UNMATCH_LIMIT - used),
            "used": used, "window_hours": WINDOW_HOURS, "next_available_at": next_available,
            "server_now": current.isoformat()}


def _end_connection(state, people, person_id, other_id, reason, current):
    """Remove the pair, remember that it ended, then refill free places."""
    pair = _pair(person_id, other_id)
    remaining = []
    for participants in state["pairs"]:
        if _pair(*participants) != pair:
            remaining.append(participants)
    state["pairs"] = remaining
    state["unmatches"].append({"participants": list(pair), "actor_id": person_id,
                              "at": current.isoformat(), "reason": reason})
    reconcile(state, people)


def _check_active(state, people, person_id, other_id):
    if person_id not in people or other_id not in people:
        raise ConnectionError(404, {"error": "That profile is no longer available."})
    if not active_pair(state, person_id, other_id):
        raise ConnectionError(409, {"error": "This connection is no longer active."})


def unmatch(state, users, person_id, other_id, reason=UNMATCH_REASON, now=None):
    """Remove a mutual connection, record its permanent exclusion, then refill."""
    _validate_state(state)
    if reason != UNMATCH_REASON:
        raise ConnectionError(400, {"error": "Choose the available unmatch reason."})
    people = _people(users)
    _check_active(state, people, person_id, other_id)
    current = _utc(now)
    allowance = quota(state, person_id, current)
    if allowance["remaining"] == 0:
        raise ConnectionError(429, {"error": "You have used your two unmatches for now. "
                                             "Real connections take time, so new introductions arrive after seven hours.",
                                    "unmatch_policy": allowance})
    _end_connection(state, people, person_id, other_id, reason, current)
    return quota(state, person_id, current)


def block(state, users, person_id, other_id, report=False, now=None):
    """End a connection for safety. Always allowed, and never uses the unmatch allowance."""
    _validate_state(state)
    people = _people(users)
    _check_active(state, people, person_id, other_id)
    current = _utc(now)
    if report:
        reason = "reported"
    else:
        reason = "blocked"
    _end_connection(state, people, person_id, other_id, reason, current)
    return quota(state, person_id, current)


def want_to_meet(state, person_id, other_id):
    """Record this person's "I'd like to meet". Chat opens when both have said it."""
    _validate_state(state)
    if not active_pair(state, person_id, other_id):
        raise ConnectionError(409, {"error": "This connection is no longer active."})
    if [person_id, other_id] not in state["meet_requests"]:
        state["meet_requests"].append([person_id, other_id])


def meet_status(state, person_id, other_id):
    """'mutual', 'waiting' (you said yes) or 'not_yet'. Their answer stays private until it's mutual."""
    i_said_yes = [person_id, other_id] in state["meet_requests"]
    they_said_yes = [other_id, person_id] in state["meet_requests"]
    if i_said_yes and they_said_yes:
        return "mutual"
    if i_said_yes:
        return "waiting"
    return "not_yet"


def next_type_change_at(state, profile_id, now=None):
    """None if this person may change relationship type now, otherwise the time they can."""
    current = _utc(now)
    latest = None
    for change in state["type_changes"]:
        if change["profile_id"] == profile_id:
            at = _timestamp(change["at"])
            if latest is None or at > latest:
                latest = at
    if latest is None:
        return None
    allowed_from = latest + timedelta(days=TYPE_CHANGE_DAYS)
    if current >= allowed_from:
        return None
    return allowed_from


def record_type_change(state, profile_id, now=None):
    """Remember this change, and forget changes too old to matter."""
    current = _utc(now)
    cutoff = current - timedelta(days=TYPE_CHANGE_DAYS)
    kept = []
    for change in state["type_changes"]:
        if _timestamp(change["at"]) > cutoff:
            kept.append(change)
    kept.append({"profile_id": profile_id, "at": current.isoformat()})
    state["type_changes"] = kept


def remove_profile(state, profile_id):
    """Erase this profile, preserving other actors' unmatch allowance usage.

    A deleted counterpart becomes an unrelated opaque marker in an actor's
    event. That keeps the seven-hour spend without retaining the deleted ID.
    The caller refills the remaining pool after removing the actual user.
    """
    _validate_state(state)
    state["pairs"] = [pair for pair in state["pairs"] if profile_id not in pair]
    remaining_events = []
    for event in state["unmatches"]:
        if event["actor_id"] == profile_id:
            continue
        if profile_id in event["participants"]:
            participants = [f"deleted-{secrets.token_hex(16)}" if pid == profile_id else pid
                            for pid in event["participants"]]
            event = {**event, "participants": sorted(participants)}
        remaining_events.append(event)
    state["unmatches"] = remaining_events
    kept_requests = []
    for request in state["meet_requests"]:
        if profile_id not in request:
            kept_requests.append(request)
    state["meet_requests"] = kept_requests
    kept_changes = []
    for change in state["type_changes"]:
        if change["profile_id"] != profile_id:
            kept_changes.append(change)
    state["type_changes"] = kept_changes
    return state
