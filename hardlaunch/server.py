"""A localhost-only teaching server. Run with `python main.py`."""

import argparse
import json
import mimetypes
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import RLock
from urllib.parse import parse_qs, urlsplit

from hardlaunch import catalog, connections, conversations, storage
from hardlaunch.connections import ConnectionError
from hardlaunch.conversations import ConversationError
from hardlaunch.photos import MAX_PHOTO_BYTES
from hardlaunch.models import User
from hardlaunch.questions import QUESTIONS
from hardlaunch.scoring import (
    MAX_MATCHES, eligible, match_details, preview_introductions, public_profile,
    rank_by_alignment, rank_by_shared_interests, top_matches, wavelength_summary,
)
from hardlaunch.validation import ValidationError, validate_profile

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
DATA_ERROR = "The saved data could not be read. Your files have not been replaced. Check the local data folder."


def configuration():
    return {
        "cities": catalog.CITIES, "genders": catalog.GENDERS, "preferences": catalog.PREFERENCES,
        "intentions": catalog.INTENTIONS, "interests": catalog.INTERESTS, "avatars": catalog.AVATARS,
        "quiz_intention": catalog.QUIZ_INTENTION,
        "photo_max_bytes": MAX_PHOTO_BYTES,
        "prompts": catalog.PROMPTS, "chapters": catalog.CHAPTERS,
        "questions": [{"id": q["id"], "text": q["text"], "options": q["options"],
                       "chapter": catalog.CHAPTERS[i // 3]} for i, q in enumerate(QUESTIONS)],
    }


class Handler(BaseHTTPRequestHandler):
    # Tests provide a temporary directory, never touching personal profiles.
    data_dir = storage.DATA_DIR
    save_lock = RLock()  # All match allocation, quota checks and JSON writes stay serial.

    def log_message(self, format, *args):
        pass  # Profile content and answers never enter console logs.

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        # Spotify's embed player is the one outside origin, framed only after someone
        # pastes a Spotify link for the quiz music. No Spotify script runs on our pages.
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; frame-src https://open.spotify.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        super().end_headers()

    def respond(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def allowed_request(self):
        port = self.server.server_address[1]
        hosts = {f"localhost:{port}", f"127.0.0.1:{port}"}
        if self.headers.get("Host") not in hosts:
            self.respond({"error": "Open this demo through localhost."}, 403)
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in {f"http://{host}" for host in hosts}:
            self.respond({"error": "This local demo accepts requests from its own page only."}, 403)
            return False
        return True

    def current(self):
        session = storage.load_current(self.data_dir / "current_profile.json")
        if session is not None:
            # A session must be an object holding a profile object.
            if not isinstance(session, dict) or not isinstance(session.get("profile"), dict):
                raise ValueError("current_profile.json has the wrong shape")
        # Old drafts may have stopped on a quiz that no longer applies.
        if session and session.get("step") == "quiz" and not catalog.requires_quiz(session["profile"].get("intention")):
            session["step"], session["question_index"] = "review", 0
        return session

    def local_users(self):
        return storage.load_users(self.data_dir / "local_users.json")

    def save(self, user, step, question_index=0, new=False, require_active=False):
        if step == "quiz" and not catalog.requires_quiz(user.intention):
            step, question_index = "review", 0
        user.saved_step, user.saved_question_index = step, question_index
        session = {"profile": user.to_dict(), "step": step, "question_index": question_index}
        with self.save_lock:
            if require_active:
                self.active_person(user.id)
            if not new and not any(person.id == user.id for person in self.local_users()):
                raise ConversationError("That profile no longer exists. Open Profiles to continue.", 404)
            storage.save_local_user(user, self.data_dir / "local_users.json")
            storage.write_json(session, self.data_dir / "current_profile.json")
        return session

    def match_state(self, users):
        """Call under save_lock: retain current connections and fill only free slots."""
        file = self.data_dir / "connections.json"
        try:
            state = connections.load_state(file)
        except (ValueError, KeyError, TypeError) as error:
            raise ConversationError("The saved connections could not be read. Check connections.json; it has not been replaced.", 500) from error
        # On the first run after upgrading, keep eligible existing conversations
        # as connections where both people still have room.
        if not file.exists():
            items = conversations.load_conversations(self.data_dir / "conversations.json")
            people = {person.id: person for person in users}
            counts = {pid: 0 for pid in people}
            for item in items:
                first, second = sorted(item["participants"])
                if (first in people and second in people
                        and counts[first] < MAX_MATCHES and counts[second] < MAX_MATCHES
                        and eligible(people[first], people[second])
                        and not connections.active_pair(state, first, second)):
                    state["pairs"].append([first, second])
                    # They were already chatting, so both count as having said yes.
                    state["meet_requests"].append([first, second])
                    state["meet_requests"].append([second, first])
                    counts[first] += 1
                    counts[second] += 1
        before = json.dumps(state, sort_keys=True)
        connections.reconcile(state, users)
        if not file.exists() or json.dumps(state, sort_keys=True) != before:
            storage.write_json(state, file)
        return state

    def result(self, user, demo=False, state=None, users=None):
        samples = storage.load_users()
        if demo:
            return {"profile": user.to_dict(), "matches": preview_introductions(user, samples)[:MAX_MATCHES],
                    "demo": True, "wavelength": wavelength_summary(user)}
        with self.save_lock:
            users = self.local_users() if users is None else users
            state = self.match_state(users) if state is None else state
            people = [other for other in users if connections.active_pair(state, user.id, other.id)]
            rank = rank_by_alignment if catalog.requires_quiz(user.intention) else rank_by_shared_interests
            people = rank(user, people)
            matches = []
            for other in people:
                details = match_details(user, other)
                status = connections.meet_status(state, user.id, other.id)
                details.update(can_chat=status == "mutual", auto_matched=True, can_unmatch=True, meet_status=status)
                matches.append(details)
            # Existing fictional previews remain labelled and cannot occupy a
            # real connection or consume an unmatch allowance.
            local_ids = {person.id for person in users}
            previews = top_matches(user, [sample for sample in samples if sample.id not in local_ids],
                                   limit=MAX_MATCHES - len(matches))
            for other in previews:
                details = match_details(user, other)
                details.update(can_chat=False, auto_matched=False, can_unmatch=False, meet_status="preview")
                matches.append(details)
            return {"profile": user.to_dict(), "matches": matches, "demo": False,
                    "unmatch_policy": connections.quota(state, user.id), "active_match_count": len(people),
                    "wavelength": wavelength_summary(user)}

    def match_status(self):
        profile_id = parse_qs(urlsplit(self.path).query).get("profile_id", [None])[0]
        with self.save_lock:
            person = self.active_person(profile_id)
            state = self.match_state(self.local_users())
            result = connections.quota(state, person.id)
            result["active_match_count"] = sum(person.id in pair for pair in state["pairs"])
        return self.respond(result)

    def unmatch(self, body):
        if body.get("confirm") is not True:
            raise ConversationError("Confirm that you want to end this connection first.")
        if not isinstance(body.get("other_id"), str) or not body["other_id"]:
            raise ConversationError("Choose an active match to unmatch.")
        with self.save_lock:
            person = self.active_person(body.get("profile_id"))
            users = self.local_users()
            state = self.match_state(users)
            connections.unmatch(state, users, person.id, body["other_id"], body.get("reason", "did_not_vibe"))
            storage.write_json(state, self.data_dir / "connections.json")
            result = self.result(person, state=state, users=users)
            result["unmatched_id"] = body["other_id"]
        return self.respond(result)

    def block(self, body):
        """Block (and optionally report) an active match. Free, and always available."""
        if body.get("confirm") is not True:
            raise ConversationError("Confirm that you want to block this person first.")
        if not isinstance(body.get("other_id"), str) or not body["other_id"]:
            raise ConversationError("Choose an active match to block.")
        report = body.get("report") is True
        with self.save_lock:
            person = self.active_person(body.get("profile_id"))
            users = self.local_users()
            state = self.match_state(users)
            connections.block(state, users, person.id, body["other_id"], report)
            storage.write_json(state, self.data_dir / "connections.json")
            result = self.result(person, state=state, users=users)
            result["blocked_id"] = body["other_id"]
            result["reported"] = report
        return self.respond(result)

    def meet(self, body):
        """Record "I'd like to meet". Chat opens only when both people have said it."""
        if not isinstance(body.get("other_id"), str) or not body["other_id"]:
            raise ConversationError("Choose an active match first.")
        with self.save_lock:
            person = self.active_person(body.get("profile_id"))
            users = self.local_users()
            state = self.match_state(users)
            connections.want_to_meet(state, person.id, body["other_id"])
            storage.write_json(state, self.data_dir / "connections.json")
            result = self.result(person, state=state, users=users)
        return self.respond(result)

    def check_edit(self, data, user, confirmed=False):
        """Editing a profile must not quietly end active matches.

        Without this, changing a preference would be a free unmatch that skips
        the two-per-seven-hours rule. Changing relationship type is the one
        exception: it refreshes every match, because the old ones no longer fit.
        It is allowed once every 30 days, and only after the person confirms,
        because HardLaunch is for people who know what they are looking for.
        Returns the profile to save and how many matches are being refreshed.
        """
        with self.save_lock:
            users = self.local_users()
            stored = None
            for person in users:
                if person.id == user.id:
                    stored = person
            if stored is None:
                return user, 0
            changing_type = stored.intention != "" and data.get("intention") != stored.intention
            if not changing_type and stored.status != "complete":
                return user, 0
            state = self.match_state(users)
            partners = []
            for person in users:
                if person.id != user.id and connections.active_pair(state, user.id, person.id):
                    partners.append(person)
            if changing_type:
                allowed_from = connections.next_type_change_at(state, user.id)
                if allowed_from is not None:
                    seconds_left = (allowed_from - connections.utc_now()).total_seconds()
                    days_left = int(seconds_left // 86400)
                    if seconds_left % 86400 > 0:
                        days_left = days_left + 1   # Round up, so "about 1 day" never means 2.
                    raise ConversationError(
                        "You changed your relationship type recently. HardLaunch is for finding a genuine match, "
                        "so you can change it once a month. "
                        f"Try again in about {days_left} day{'s' if days_left != 1 else ''}.", 409)
                # Only completed profiles are counted. People still setting up can change freely.
                if stored.status == "complete":
                    if not confirmed:
                        raise ConversationError(
                            "Please confirm the change first. Your relationship type will then stay "
                            "the same for a month.", 409)
                    connections.record_type_change(state, user.id)
                    storage.write_json(state, self.data_dir / "connections.json")
                return user, len(partners)
            if not partners:
                return user, 0
            # Each editing step is saved as a draft. While matches are active,
            # the profile stays complete, so it must still pass every check.
            edited = validate_profile(data, complete=True)
            ended = []
            for partner in partners:
                if not eligible(edited, partner):
                    ended.append(partner.name)
            if not ended:
                return edited, 0
            raise ConversationError(
                "This change would end your match with " + " and ".join(ended) + ". "
                "If you want to move on, unmatch first. You can unmatch two people every seven hours.", 409)

    def active_person(self, profile_id):
        """Reject stale tabs so messages cannot accidentally use another sender."""
        session = self.current()
        if not session or session["profile"]["id"] != profile_id:
            raise ConversationError("Another profile is active. Open Profiles and select who you want to use.", 409)
        return User.from_dict(session["profile"])

    def read_conversations(self, path):
        profile_id = parse_qs(urlsplit(self.path).query).get("profile_id", [None])[0]
        with self.save_lock:
            person = self.active_person(profile_id)
            items = conversations.load_conversations(self.data_dir / "conversations.json")
            users = self.local_users()
            state = self.match_state(users)
            if path == "/api/conversations":
                result = [conversations.conversation_details(item, person, users, state)
                          for item in items if person.id in item["participants"]]
            else:
                item = conversations.find_conversation(items, path.rsplit("/", 1)[-1], person)
                result = conversations.conversation_details(item, person, users, state)
        return self.respond(result)

    def write_conversation(self, path, body):
        # One lock covers read/change/write, so simultaneous messages are retained.
        with self.save_lock:
            person = self.active_person(body.get("profile_id"))
            users = self.local_users()
            file = self.data_dir / "conversations.json"
            items = conversations.load_conversations(file)
            state = self.match_state(users)
            if path == "/api/conversations":
                other = next((u for u in users if u.id == body.get("other_id")), None)
                item = conversations.start_conversation(items, person, other, state)
            elif path.endswith("/messages") and len(path.split("/")) == 5:
                item = conversations.find_conversation(items, path.split("/")[3], person)
                conversations.add_message(item, person, users, body.get("text"), state)
            else:
                raise ConversationError("That endpoint does not exist.", 404)
            storage.write_json(items, file)
            result = conversations.conversation_details(item, person, users, state)
        return self.respond(result)

    def delete_profile(self, body):
        """Delete one local person and their conversations after UI confirmation."""
        if body.get("confirm") is not True:
            raise ConversationError("Confirm deletion of the selected profile first.")
        with self.save_lock:
            users = self.local_users()
            person = next((user for user in users if user.id == body.get("id")), None)
            if person is None:
                raise ConversationError("That local profile was not found. Sample previews cannot be deleted.", 404)
            # Read everything before writing, so unreadable data is not replaced.
            session = self.current()
            file = self.data_dir / "conversations.json"
            items = conversations.load_conversations(file)
            remaining = [item for item in items if person.id not in item["participants"]]
            match_file = self.data_dir / "connections.json"
            state = self.match_state(users)
            connections.remove_profile(state, person.id)
            remaining_users = [user for user in users if user.id != person.id]
            connections.reconcile(state, remaining_users)
            storage.save_users(remaining_users, self.data_dir / "local_users.json")
            storage.write_json(state, match_file)
            if len(remaining) != len(items):
                storage.write_json(remaining, file)
            if session and session["profile"]["id"] == person.id:
                session = None
                storage.write_json(None, self.data_dir / "current_profile.json")
        return self.respond({"deleted_id": person.id, "deleted_name": person.name,
                             "deleted_conversations": len(items) - len(remaining), "session": session})

    def do_GET(self):
        if not self.allowed_request():
            return
        path = urlsplit(self.path).path
        try:
            if path == "/api/config":
                return self.respond(configuration())
            if path == "/api/session":
                return self.respond(self.current())
            if path == "/api/profiles":
                return self.respond([{**public_profile(u), "status": u.status} for u in self.local_users()])
            if path == "/api/match-status":
                return self.match_status()
            if path == "/api/conversations" or path.startswith("/api/conversations/"):
                return self.read_conversations(path)
            if path == "/api/demo":
                return self.respond(self.result(storage.load_users()[0], demo=True))
            if path == "/api/matches":
                with self.save_lock:
                    session = self.current()
                    if not session or session["profile"].get("status") != "complete":
                        return self.respond({"error": "Complete your profile first."}, 422)
                    user = validate_profile(session["profile"], complete=True)
                    return self.respond(self.result(user))
            if path.startswith("/api/"):
                return self.respond({"error": "That endpoint does not exist."}, 404)
            filename = "index.html" if path == "/" else "showcase.html" if path == "/showcase" else path.lstrip("/")
            target = (WEB_DIR / filename).resolve()
            if not target.is_relative_to(WEB_DIR) or not target.is_file():
                return self.respond({"error": "Page not found."}, 404)
            body = target.read_bytes()
            content_type = "application/manifest+json" if target.suffix == ".webmanifest" else mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except ConnectionError as error:
            self.respond(error.payload, error.status)
        except ConversationError as error:
            self.respond({"error": str(error)}, error.status)
        except ValidationError as error:
            self.respond({"error": str(error), "fields": error.errors}, 422)
        except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError):
            self.respond({"error": DATA_ERROR}, 500)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 3 * 1024 * 1024:
                return self.respond({"error": "The request is empty or too large."}, 413)
            # Read the bounded request before responding, avoiding a Windows TCP
            # reset when rejecting a POST with an unread body.
            raw = self.rfile.read(length)
            if not self.allowed_request():
                return
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                return self.respond({"error": "Use JSON for this request."}, 415)
            try:
                body = json.loads(raw)
            except (ValueError, UnicodeError):
                return self.respond({"error": "The request is not valid JSON."}, 400)
            if not isinstance(body, dict):
                return self.respond({"error": "Send a JSON object."}, 400)
            path = urlsplit(self.path).path
            if path == "/api/unmatch":
                return self.unmatch(body)
            if path == "/api/block":
                return self.block(body)
            if path == "/api/meet":
                return self.meet(body)
            if path == "/api/delete-profile":
                return self.delete_profile(body)
            if path == "/api/conversations" or path.startswith("/api/conversations/"):
                return self.write_conversation(path, body)
            if path == "/api/demo-pair":
                with self.save_lock:
                    users = self.local_users()
                    ids = {u.id for u in users}
                    users.extend(u for u in conversations.demo_pair() if u.id not in ids)
                    storage.save_users(users, self.data_dir / "local_users.json")
                    # The prepared pair is ready to chat: both have already said
                    # "I'd like to meet". An ended connection is never reopened.
                    state = self.match_state(users)
                    if connections.active_pair(state, "demo-avery", "demo-jordan"):
                        connections.want_to_meet(state, "demo-avery", "demo-jordan")
                        connections.want_to_meet(state, "demo-jordan", "demo-avery")
                        storage.write_json(state, self.data_dir / "connections.json")
                first = next(u for u in users if u.id == "demo-avery")
                return self.respond(self.save(first, "matches" if first.status == "complete" else "about"))
            if path == "/api/new":
                user = User(id=f"local-{uuid.uuid4().hex}", name="", age=0)
                return self.respond(self.save(user, "about", new=True), 201)
            if path == "/api/select":
                user = next((u for u in self.local_users() if u.id == body.get("id")), None)
                if not user:
                    return self.respond({"error": "That saved profile was not found."}, 404)
                return self.respond(self.save(user, "matches" if user.status == "complete" else user.saved_step, user.saved_question_index))
            if path == "/api/logout":
                # A proof of concept: no passwords, so logging out just clears the
                # active profile. Saved profiles, progress and chats all stay.
                with self.save_lock:
                    storage.write_json(None, self.data_dir / "current_profile.json")
                return self.respond({"session": None})
            if path not in ("/api/draft", "/api/complete"):
                return self.respond({"error": "That endpoint does not exist."}, 404)
            session = self.current()
            if not session:
                return self.respond({"error": "Start a profile first."}, 409)
            data = body.get("profile")
            if not isinstance(data, dict):
                return self.respond({"error": "Send your profile."}, 400)
            if data.get("id") != session["profile"]["id"]:
                return self.respond({"error": "Another profile is active. Reload to continue with it."}, 409)
            complete = path == "/api/complete"
            user = validate_profile(data, complete=complete)
            step = "matches" if complete else body.get("step", "about")
            question_index = body.get("question_index", 0)
            if step not in ("about", "preferences", "personality", "quiz", "review", "matches"):
                return self.respond({"error": "Unknown profile step."}, 400)
            if type(question_index) is not int or not 0 <= question_index < len(QUESTIONS):
                return self.respond({"error": "Unknown question."}, 400)
            with self.save_lock:
                user, refreshed = self.check_edit(data, user, body.get("confirm_type_change") is True)
                session = self.save(user, step, question_index, require_active=True)
                if refreshed:
                    # End the old matches now, so everyone's free places refill straight away.
                    self.match_state(self.local_users())
                    session["matches_refreshed"] = refreshed
                return self.respond(session)
        except ConnectionError as error:
            self.respond(error.payload, error.status)
        except ConversationError as error:
            self.respond({"error": str(error)}, error.status)
        except ValidationError as error:
            self.respond({"error": str(error), "fields": error.errors}, 422)
        except (ValueError, KeyError, TypeError, AttributeError, IndexError):
            # A saved file has the wrong shape, for example after a manual edit.
            self.respond({"error": DATA_ERROR}, 500)
        except OSError:
            self.respond({"error": "Your change could not be saved. Keep this page open and try again."}, 500)


def run():
    parser = argparse.ArgumentParser(description="HardLaunch local PWA")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--data-dir", type=Path, default=storage.DATA_DIR, help="Optional separate demo/test storage")
    options = parser.parse_args()
    Handler.data_dir = options.data_dir
    server = ThreadingHTTPServer(("127.0.0.1", options.port), Handler)
    print(f"HardLaunch is ready: http://localhost:{server.server_port}", flush=True)
    print("Keep this terminal running. Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
