"""Exercise the real HTTP interface using temporary, isolated JSON files."""

import json
import threading
from http.client import HTTPConnection
from http.server import HTTPServer

import pytest

from hardlaunch.server import Handler
from hardlaunch.storage import load_users, save_users


@pytest.fixture
def server(tmp_path):
    class TestHandler(Handler):
        data_dir = tmp_path
    instance = HTTPServer(("127.0.0.1", 0), TestHandler)
    thread = threading.Thread(target=instance.serve_forever, daemon=True)
    thread.start()
    yield instance.server_port, tmp_path
    instance.shutdown()
    instance.server_close()
    thread.join()


def request(server, path, body=None, headers=None):
    connection = HTTPConnection("127.0.0.1", server[0], timeout=5)
    extra = {"Content-Type": "application/json"} if body is not None else {}
    extra.update(headers or {})
    connection.request("GET" if body is None else "POST", path,
                       json.dumps(body) if body is not None else None, headers=extra)
    response = connection.getresponse()
    raw = response.read()
    result = json.loads(raw) if "json" in response.getheader("Content-Type", "") else raw
    connection.close()
    return response.status, result


def create_profile(server):
    status, session = request(server, "/api/new", {})
    assert status == 201
    data = load_users()[0].to_dict()
    data["id"] = session["profile"]["id"]
    return data


def test_assets_configuration_and_no_data_file_exposure(server):
    assert request(server, "/")[0] == 200
    assert request(server, "/showcase")[0] == 200
    assert request(server, "/assets/icon-192.png")[1].startswith(b"\x89PNG")
    assert request(server, "/manifest.webmanifest")[1]["display"] == "standalone"
    status, config = request(server, "/api/config")
    assert status == 200 and len(config["questions"]) == 15
    assert request(server, "/data/local_users.json")[0] == 404
    assert request(server, "/../data/sample_users.json")[0] == 404


def test_draft_round_trip_completion_edit_and_refresh(server):
    data = create_profile(server)
    data["answers"] = {"1": 2}
    status, session = request(server, "/api/draft", {"profile": data, "step": "quiz", "question_index": 1})
    assert status == 200 and session["profile"]["status"] == "draft"
    assert request(server, "/api/session")[1] == session
    assert request(server, "/api/matches")[0] == 422
    assert request(server, "/api/complete", {"profile": data})[0] == 422
    data["answers"] = load_users()[0].to_dict()["answers"]
    assert request(server, "/api/complete", {"profile": data})[0] == 200
    assert len(request(server, "/api/matches")[1]["matches"]) == 3
    data["city"] = "Darwin"
    assert request(server, "/api/complete", {"profile": data})[0] == 200
    assert request(server, "/api/matches")[1]["matches"] == []
    assert request(server, "/api/session")[1]["profile"]["city"] == "Darwin"
    assert len(load_users(server[1] / "local_users.json")) == 1


def test_demo_never_mutates_real_session_or_pool(server):
    data = create_profile(server)
    request(server, "/api/complete", {"profile": data})
    before = {p.name: p.read_bytes() for p in server[1].iterdir()}
    status, demo = request(server, "/api/demo")
    assert status == 200 and demo["demo"] and len(demo["matches"]) == 3
    assert {p.name: p.read_bytes() for p in server[1].iterdir()} == before


def test_legacy_profile_can_be_selected_and_completed(server):
    from hardlaunch.models import User
    legacy = User(id="legacy", name="Old profile", age=28)
    save_users([legacy], server[1] / "local_users.json")
    assert request(server, "/api/profiles")[1][0]["status"] == "draft"
    session = request(server, "/api/select", {"id": "legacy"})[1]
    assert session["profile"]["gender"] == ""
    data = load_users()[0].to_dict()
    data["id"] = "legacy"
    assert request(server, "/api/complete", {"profile": data})[0] == 200


def test_reject_foreign_requests_and_stale_profile_updates(server):
    data = create_profile(server)
    assert request(server, "/api/session", headers={"Host": "evil.example"})[0] == 403
    assert request(server, "/api/new", {}, {"Origin": "https://evil.example"})[0] == 403
    assert request(server, "/api/new", {}, {"Content-Type": "text/plain"})[0] == 415
    request(server, "/api/new", {})
    assert request(server, "/api/draft", {"profile": data})[0] == 409


def test_corrupt_storage_is_not_overwritten(server):
    path = server[1] / "local_users.json"
    path.write_text("not json", encoding="utf-8")
    assert request(server, "/api/profiles")[0] == 500
    assert request(server, "/api/new", {})[0] == 500
    assert path.read_text(encoding="utf-8") == "not json"


def test_frontend_callbacks_against_real_server(server):
    import shutil
    import subprocess
    from pathlib import Path
    node = shutil.which("node")
    if not node:
        pytest.skip("Optional JavaScript integration check needs Node; the app does not.")
    script = Path(__file__).with_name("frontend_flow.cjs")
    result = subprocess.run([node, str(script), f"http://127.0.0.1:{server[0]}"],
                            capture_output=True, text=True, timeout=40)
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize("intention", ["Exploring connections", "Casual dating"])
def test_quiz_optional_api_and_switch_to_long_term(server, intention):
    other = create_profile(server)
    other.update(intention=intention, answers={})
    assert request(server, "/api/complete", {"profile": other})[0] == 200
    me = create_profile(server)
    me.update(intention=intention, answers={})
    assert request(server, "/api/complete", {"profile": me})[0] == 200
    matches = request(server, "/api/matches")[1]["matches"]
    assert any(m["profile"]["id"] == other["id"] for m in matches)
    assert all(m["score"] is None and "yours" not in m["explore"] for m in matches)
    me["intention"] = "Long-term relationship"
    status, error = request(server, "/api/complete", {"profile": me})
    assert status == 422 and "answers" in error["fields"]
    assert request(server, "/api/session")[1]["profile"]["intention"] == intention


def test_legacy_quiz_step_is_skipped_for_other_intentions(server):
    from hardlaunch.storage import write_json
    data = create_profile(server)
    data.update(intention="Casual dating", answers={})
    write_json({"profile": data, "step": "quiz", "question_index": 8}, server[1] / "current_profile.json")
    session = request(server, "/api/session")[1]
    assert session["step"] == "review" and session["question_index"] == 0
    status, saved = request(server, "/api/draft", {"profile": data, "step": "quiz", "question_index": 8})
    assert status == 200 and saved["step"] == "review"


def both_say_yes(server, first_id, second_id):
    """Both people choose "I'd like to meet". Leaves first_id as the active profile."""
    for me, other in ((second_id, first_id), (first_id, second_id)):
        assert request(server, "/api/select", {"id": me})[0] == 200
        assert request(server, "/api/meet", {"profile_id": me, "other_id": other})[0] == 200


def create_demo_conversation(server):
    assert request(server, "/api/demo-pair", {})[0] == 200
    both_say_yes(server, "demo-avery", "demo-jordan")
    status, chat = request(server, "/api/conversations", {"profile_id": "demo-avery", "other_id": "demo-jordan"})
    assert status == 200 and chat["can_send"]
    return chat


def test_logout_clears_only_the_active_profile(server):
    assert request(server, "/api/demo-pair", {})[0] == 200
    chat = request(server, "/api/conversations", {"profile_id": "demo-avery", "other_id": "demo-jordan"})[1]
    request(server, f'/api/conversations/{chat["id"]}/messages', {"profile_id": "demo-avery", "text": "Hi!"})
    assert request(server, "/api/logout", {}) == (200, {"session": None})
    assert request(server, "/api/session")[1] is None
    # Nothing else is lost, and the logged-out tab cannot send as Avery.
    assert len(request(server, "/api/profiles")[1]) == 2
    status, _ = request(server, f'/api/conversations/{chat["id"]}/messages', {"profile_id": "demo-avery", "text": "Still me?"})
    assert status == 409
    # One click logs back in, with the conversation intact.
    assert request(server, "/api/select", {"id": "demo-avery"})[0] == 200
    assert request(server, f'/api/conversations/{chat["id"]}?profile_id=demo-avery')[1]["messages"][0]["text"] == "Hi!"


def test_demo_pair_arrives_ready_to_chat_but_never_reopens_an_ended_match(server):
    assert request(server, "/api/demo-pair", {})[0] == 200
    match = next(m for m in request(server, "/api/matches")[1]["matches"] if m["profile"]["id"] == "demo-jordan")
    assert match["meet_status"] == "mutual" and match["can_chat"]
    status, _ = request(server, "/api/unmatch", {"profile_id": "demo-avery", "other_id": "demo-jordan",
                                                 "reason": "did_not_vibe", "confirm": True})
    assert status == 200
    request(server, "/api/demo-pair", {})
    matches = request(server, "/api/matches")[1]["matches"]
    assert not any(m["profile"]["id"] == "demo-jordan" and m["can_chat"] for m in matches)


def test_two_profiles_match_and_converse_in_both_directions(server):
    chat = create_demo_conversation(server)
    match = next(m for m in request(server, "/api/matches")[1]["matches"] if m["profile"]["id"] == "demo-jordan")
    assert match["can_chat"] and match["score"] is None
    assert match["profile"]["role"] == "Software developer"
    path = f'/api/conversations/{chat["id"]}'
    status, sent = request(server, path + "/messages", {"profile_id": "demo-avery", "text": "Hello Jordan!"})
    assert status == 200 and sent["messages"][0]["sender_id"] == "demo-avery"
    request(server, "/api/select", {"id": "demo-jordan"})
    assert any(m["profile"]["id"] == "demo-avery" for m in request(server, "/api/matches")[1]["matches"])
    incoming = request(server, path + "?profile_id=demo-jordan")[1]
    assert incoming["messages"][0]["text"] == "Hello Jordan!"
    status, reply = request(server, path + "/messages", {"profile_id": "demo-jordan", "text": "Coffee sounds good!", "sender_id": "demo-avery"})
    assert status == 200 and reply["messages"][-1]["sender_id"] == "demo-jordan"
    reused = request(server, "/api/conversations", {"profile_id": "demo-jordan", "other_id": "demo-avery"})[1]
    assert reused["id"] == chat["id"] and len(reused["messages"]) == 2
    # Read actual disk content, then repeat setup: it must preserve existing history.
    stored = json.loads((server[1] / "conversations.json").read_text(encoding="utf-8"))
    assert len(stored) == 1 and stored[0]["messages"] == reused["messages"]
    request(server, "/api/demo-pair", {})
    assert len(request(server, path + "?profile_id=demo-avery")[1]["messages"]) == 2
    assert len(request(server, "/api/profiles")[1]) == 2
    assert len(request(server, "/api/conversations?profile_id=demo-avery")[1]) == 1


def test_chat_rejects_stale_senders_other_people_and_bad_messages(server):
    chat = create_demo_conversation(server)
    path = f'/api/conversations/{chat["id"]}'
    for text in (" ", "a" * 1001, None, 123):
        assert request(server, path + "/messages", {"profile_id": "demo-avery", "text": text})[0] == 422
    request(server, "/api/select", {"id": "demo-jordan"})
    assert request(server, path + "/messages", {"profile_id": "demo-avery", "text": "Wrong sender"})[0] == 409
    assert request(server, path + "?profile_id=demo-avery")[0] == 409
    third = create_profile(server)
    assert request(server, path + "?profile_id=" + third["id"])[0] == 403
    assert request(server, path + "/messages", {"profile_id": third["id"], "text": "Not my conversation"})[0] == 403
    assert request(server, "/api/conversations?profile_id=" + third["id"])[1] == []


def test_chat_requires_local_eligible_profiles_and_keeps_history_after_preference_change(server):
    chat = create_demo_conversation(server)
    path = f'/api/conversations/{chat["id"]}'
    assert request(server, "/api/conversations", {"profile_id": "demo-avery", "other_id": "sample-01"})[0] == 422
    assert request(server, "/api/conversations", {"profile_id": "demo-avery", "other_id": "demo-avery"})[0] == 422
    request(server, path + "/messages", {"profile_id": "demo-avery", "text": "A saved hello"})
    data = request(server, "/api/session")[1]["profile"]
    data["city"] = "Melbourne"
    status, error = request(server, "/api/complete", {"profile": data})
    assert status == 409 and "end your match with Jordan" in error["error"]
    assert request(server, "/api/session")[1]["profile"]["city"] == "Sydney"
    request(server, "/api/unmatch", {"profile_id": "demo-avery", "other_id": "demo-jordan",
                                     "reason": "did_not_vibe", "confirm": True})
    assert request(server, "/api/complete", {"profile": data})[0] == 200
    history = request(server, path + "?profile_id=demo-avery")[1]
    assert not history["can_send"] and history["messages"][0]["text"] == "A saved hello"
    assert request(server, path + "/messages", {"profile_id": "demo-avery", "text": "Blocked now"})[0] == 422
    assert request(server, "/api/conversations", {"profile_id": "demo-avery", "other_id": "demo-jordan"})[0] == 422
    # Reopening the prepared pair does not reset edited profiles.
    assert request(server, "/api/demo-pair", {})[1]["profile"]["city"] == "Melbourne"


def test_switch_profiles_preserves_each_drafts_progress(server):
    first = create_profile(server)
    request(server, "/api/draft", {"profile": first, "step": "quiz", "question_index": 7})
    create_profile(server)
    reopened = request(server, "/api/select", {"id": first["id"]})[1]
    assert reopened["step"] == "quiz" and reopened["question_index"] == 7


def test_photo_and_professional_details_round_trip_and_avatar_fallback(server):
    import base64
    from pathlib import Path
    image = (Path(__file__).resolve().parent.parent / "web/assets/icon-192.png").read_bytes()
    photo = "data:image/png;base64," + base64.b64encode(image).decode("ascii")
    data = request(server, "/api/demo-pair", {})[1]["profile"]
    data.update(photo=photo, role=" Designer ", company=" A studio ")
    assert request(server, "/api/complete", {"profile": data})[0] == 200
    saved = request(server, "/api/session")[1]["profile"]
    assert saved["photo"] == photo and saved["role"] == "Designer" and saved["company"] == "A studio"
    request(server, "/api/select", {"id": "demo-jordan"})
    card = next(m["profile"] for m in request(server, "/api/matches")[1]["matches"] if m["profile"]["id"] == data["id"])
    assert card["photo"] == photo and card["company"] == "A studio"
    request(server, "/api/select", {"id": "demo-avery"})
    data.update(photo="", avatar="planet")
    assert request(server, "/api/complete", {"profile": data})[1]["profile"]["photo"] == ""
    for invalid in ("https://example.com/face.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,YmFk", "data:image/png;base64,!!!", 123):
        data["photo"] = invalid
        status, error = request(server, "/api/complete", {"profile": data})
        assert status == 422 and "photo" in error["fields"]
    data["photo"] = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"a" * (2 * 1024 * 1024)).decode("ascii")
    assert request(server, "/api/complete", {"profile": data})[0] == 422
    data.update(photo="", role="a" * 81)
    assert request(server, "/api/complete", {"profile": data})[0] == 422


def test_casual_discovery_keeps_three_active_local_profiles(server):
    from dataclasses import replace
    from hardlaunch.conversations import demo_pair
    a, b = demo_pair()
    save_users([a] + [replace(b, id=f"person-{i}") for i in range(5)], server[1] / "local_users.json")
    request(server, "/api/select", {"id": a.id})
    matches = request(server, "/api/matches")[1]["matches"]
    assert len([m for m in matches if m["auto_matched"]]) == 3
    # Nobody can chat until both people say "I'd like to meet".
    assert all(m["meet_status"] == "not_yet" and not m["can_chat"] for m in matches)
    assert all(m["score"] is None for m in matches)


def test_invalid_conversation_file_is_not_replaced(server):
    request(server, "/api/demo-pair", {})
    path = server[1] / "conversations.json"
    for contents in ("not json", '{}'):
        path.write_text(contents, encoding="utf-8")
        assert request(server, "/api/conversations?profile_id=demo-avery")[0] == 500
        assert request(server, "/api/conversations", {"profile_id": "demo-avery", "other_id": "demo-jordan"})[0] == 500
        assert path.read_text(encoding="utf-8") == contents


def test_long_term_auto_match_after_quiz_is_mutual_and_can_chat(server):
    first = create_profile(server)
    first.update(name="First", city="Darwin")  # No fictional previews in this city.
    request(server, "/api/complete", {"profile": first})
    second = create_profile(server)
    second.update(name="Second", city="Darwin")
    incomplete = dict(second, answers={"1": 2})
    assert request(server, "/api/complete", {"profile": incomplete})[0] == 422
    request(server, "/api/select", {"id": first["id"]})
    assert request(server, "/api/matches")[1]["matches"] == []
    request(server, "/api/select", {"id": second["id"]})
    assert request(server, "/api/complete", {"profile": second})[0] == 200
    match = request(server, "/api/matches")[1]["matches"][0]
    assert match["profile"]["id"] == first["id"]
    assert match["auto_matched"] and not match["can_chat"] and match["score"] == 100
    assert match["score_label"] == "Strong common ground"
    assert request(server, "/api/matches")[1]["wavelength"]["name"] == "Secure"
    request(server, "/api/select", {"id": first["id"]})
    reciprocal = request(server, "/api/matches")[1]["matches"][0]
    assert reciprocal["profile"]["id"] == second["id"] and reciprocal["auto_matched"]
    assert reciprocal["score"] == match["score"]
    # Chat opens only once both people have said "I'd like to meet".
    status, error = request(server, "/api/conversations", {"profile_id": first["id"], "other_id": second["id"]})
    assert status == 422 and "both choose" in error["error"]
    assert request(server, "/api/meet", {"profile_id": first["id"], "other_id": second["id"]})[0] == 200
    assert request(server, "/api/matches")[1]["matches"][0]["meet_status"] == "waiting"
    request(server, "/api/select", {"id": second["id"]})
    assert request(server, "/api/matches")[1]["matches"][0]["meet_status"] == "not_yet"  # Still private.
    request(server, "/api/meet", {"profile_id": second["id"], "other_id": first["id"]})
    assert request(server, "/api/matches")[1]["matches"][0]["can_chat"]
    request(server, "/api/select", {"id": first["id"]})
    chat = request(server, "/api/conversations", {"profile_id": first["id"], "other_id": second["id"]})[1]
    path = f'/api/conversations/{chat["id"]}'
    assert request(server, path + "/messages", {"profile_id": first["id"], "text": "Hello, we matched!"})[0] == 200
    request(server, "/api/select", {"id": second["id"]})
    assert request(server, path + "/messages", {"profile_id": second["id"], "text": "Hi!"})[0] == 200
    second["answers"]["14"] = 1
    request(server, "/api/complete", {"profile": second})
    changed = request(server, "/api/matches")[1]["matches"][0]
    assert changed["auto_matched"] and changed["score"] == 90
    assert "A shared picture" not in [reason["title"] for reason in changed["reasons"]]
    # A preference edit cannot quietly end the match. Unmatching ends it for both people.
    second["city"] = "Perth"
    assert request(server, "/api/complete", {"profile": second})[0] == 409
    assert request(server, "/api/draft", {"profile": second, "step": "about"})[0] == 409
    assert request(server, "/api/unmatch", {"profile_id": second["id"], "other_id": first["id"],
                                            "reason": "did_not_vibe", "confirm": True})[0] == 200
    assert request(server, "/api/complete", {"profile": second})[0] == 200
    assert not any(m["auto_matched"] for m in request(server, "/api/matches")[1]["matches"])
    request(server, "/api/select", {"id": first["id"]})
    assert request(server, "/api/matches")[1]["matches"] == []
    history = request(server, path + "?profile_id=" + first["id"])[1]
    assert len(history["messages"]) == 2 and not history["can_send"]


def test_long_term_auto_matches_stay_mutual_with_more_than_three_candidates(server):
    from dataclasses import replace
    template = load_users()[0]
    people = [replace(template, id=pid, city="Darwin") for pid in "abcdez"]
    save_users(people, server[1] / "local_users.json")
    results = {}
    for person in people:
        request(server, "/api/select", {"id": person.id})
        matches = request(server, "/api/matches")[1]["matches"]
        assert len(matches) <= 3
        assert all(m["auto_matched"] and m["can_unmatch"] for m in matches)
        results[person.id] = [m["profile"]["id"] for m in matches]
    for person_id, matched_ids in results.items():
        assert all(person_id in results[other_id] for other_id in matched_ids)


def test_changing_relationship_type_changes_matching_and_chat_conditions(server):
    first = create_profile(server)
    first["city"] = "Darwin"
    request(server, "/api/complete", {"profile": first})
    second = create_profile(server)
    second["city"] = "Darwin"
    request(server, "/api/complete", {"profile": second})
    assert request(server, "/api/matches")[1]["matches"][0]["auto_matched"]
    both_say_yes(server, second["id"], first["id"])
    chat = request(server, "/api/conversations", {"profile_id": second["id"], "other_id": first["id"]})[1]
    path = f'/api/conversations/{chat["id"]}'
    # Changing intention refreshes matches automatically and says so. No unmatch is used.
    second.update(intention="Casual dating", answers={})
    # A completed profile must confirm first, because the type then stays locked for a month.
    status, error = request(server, "/api/complete", {"profile": second})
    assert status == 409 and "confirm the change" in error["error"]
    assert request(server, "/api/matches")[1]["matches"][0]["profile"]["id"] == first["id"]
    status, saved = request(server, "/api/complete", {"profile": second, "confirm_type_change": True})
    assert status == 200 and saved["matches_refreshed"] == 1
    assert request(server, "/api/matches")[1]["matches"] == []
    assert request(server, f"/api/match-status?profile_id={second['id']}")[1]["used"] == 0
    assert not request(server, path + "?profile_id=" + second["id"])[1]["can_send"]
    request(server, "/api/select", {"id": first["id"]})
    assert request(server, "/api/matches")[1]["matches"] == []
    first.update(intention="Casual dating", answers={})
    status, saved = request(server, "/api/complete", {"profile": first, "confirm_type_change": True})
    assert status == 200 and "matches_refreshed" not in saved
    # A refresh is not an unmatch, so the same two people can match again under the new intention.
    match = request(server, "/api/matches")[1]["matches"][0]
    assert match["profile"]["id"] == second["id"] and match["meet_status"] == "not_yet"
    # Switching back to long-term cannot bypass the quiz requirement.
    first["intention"] = "Long-term relationship"
    status, error = request(server, "/api/complete", {"profile": first})
    assert status == 422 and "answers" in error["fields"]


def test_delete_profile_requires_confirmation_and_cannot_delete_samples(server):
    create_demo_conversation(server)
    before = {path.name: path.read_bytes() for path in server[1].iterdir()}
    for confirmation in (None, False, "true"):
        assert request(server, "/api/delete-profile", {"id": "demo-avery", "confirm": confirmation})[0] == 422
    assert request(server, "/api/delete-profile", {"id": "sample-01", "confirm": True})[0] == 404
    assert request(server, "/api/delete-profile", {"id": "missing", "confirm": True})[0] == 404
    assert request(server, "/api/delete-profile", {"id": "demo-avery", "confirm": True}, {"Origin": "https://evil.example"})[0] == 403
    assert {path.name: path.read_bytes() for path in server[1].iterdir()} == before


def test_delete_active_profile_removes_its_data_and_chats_and_blocks_stale_saves(server):
    chat = create_demo_conversation(server)
    previous = request(server, "/api/session")[1]["profile"]
    path = f'/api/conversations/{chat["id"]}'
    request(server, path + "/messages", {"profile_id": "demo-avery", "text": "Remove this with my profile."})
    status, deleted = request(server, "/api/delete-profile", {"id": "demo-avery", "confirm": True})
    assert status == 200 and deleted["deleted_conversations"] == 1 and deleted["session"] is None
    assert request(server, "/api/session")[1] is None
    assert [person["id"] for person in request(server, "/api/profiles")[1]] == ["demo-jordan"]
    assert request(server, "/api/select", {"id": "demo-avery"})[0] == 404
    assert request(server, "/api/complete", {"profile": previous})[0] == 409
    request(server, "/api/select", {"id": "demo-jordan"})
    assert request(server, "/api/conversations?profile_id=demo-jordan")[1] == []
    assert request(server, path + "?profile_id=demo-jordan")[0] == 404
    assert not any(m["profile"]["id"] == "demo-avery" for m in request(server, "/api/matches")[1]["matches"])
    assert not any(user.id == "demo-avery" for user in load_users(server[1] / "local_users.json"))


def test_delete_inactive_profile_preserves_other_people_session_and_conversations(server):
    create_demo_conversation(server)
    third = create_profile(server)
    third.update(intention="Casual dating", answers={}, gender="woman", preferred_genders=["man"])
    request(server, "/api/complete", {"profile": third})
    both_say_yes(server, third["id"], "demo-jordan")
    kept_chat = request(server, "/api/conversations", {"profile_id": third["id"], "other_id": "demo-jordan"})[1]
    kept_chat = request(server, f'/api/conversations/{kept_chat["id"]}/messages', {"profile_id": third["id"], "text": "Keep this conversation."})[1]
    session = request(server, "/api/session")[1]
    status, deleted = request(server, "/api/delete-profile", {"id": "demo-avery", "confirm": True})
    assert status == 200 and deleted["session"] == session
    assert request(server, "/api/session")[1] == session
    assert request(server, "/api/conversations?profile_id=" + third["id"])[1] == [kept_chat]
    assert request(server, "/api/delete-profile", {"id": "demo-avery", "confirm": True})[0] == 404


def test_delete_last_unfinished_profile_leaves_a_clean_empty_session(server):
    person = request(server, "/api/new", {})[1]["profile"]
    assert request(server, "/api/delete-profile", {"id": person["id"], "confirm": True})[0] == 200
    assert request(server, "/api/profiles")[1] == []
    assert request(server, "/api/session")[1] is None
    assert request(server, "/api/matches")[0] == 422
    assert request(server, "/api/new", {})[0] == 201


def test_delete_does_not_replace_unreadable_conversation_data(server):
    create_demo_conversation(server)
    (server[1] / "conversations.json").write_text("not JSON", encoding="utf-8")
    before = {path.name: path.read_bytes() for path in server[1].iterdir()}
    assert request(server, "/api/delete-profile", {"id": "demo-avery", "confirm": True})[0] == 500
    assert {path.name: path.read_bytes() for path in server[1].iterdir()} == before


@pytest.mark.parametrize("filename, content, path, body", [
    ("local_users.json", "not json", "/api/profiles", None),
    ("local_users.json", '[{"name": "No id"}]', "/api/profiles", None),
    ("local_users.json", '{"not": "a list"}', "/api/select", {"id": "x"}),
    ("current_profile.json", '{"no_profile": true}', "/api/session", None),
    ("current_profile.json", '["wrong"]', "/api/draft", {"profile": {}}),
])
def test_malformed_saved_data_gets_a_clear_error_not_a_dropped_connection(server, filename, content, path, body):
    request(server, "/api/new", {})
    file = server[1] / filename
    file.write_text(content, encoding="utf-8")
    status, result = request(server, path, body)
    assert status == 500 and "saved data could not be read" in result["error"]
    assert file.read_text(encoding="utf-8") == content
