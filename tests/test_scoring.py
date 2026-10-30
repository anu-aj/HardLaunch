import itertools
import random

import pytest

from hardlaunch.models import User
from hardlaunch.catalog import requires_quiz
from hardlaunch.questions import QUESTIONS
from hardlaunch.scoring import (
    DIMENSIONS,
    MAX_MATCHES,
    commitment_compatible,
    compatible,
    score,
    top_matches,
)
from hardlaunch.storage import SAMPLE_USERS, load_users, save_users


@pytest.fixture(scope="module")
def users():
    return load_users(SAMPLE_USERS)


def others(user, users):
    return [u for u in users if u is not user]


def random_answers(rng):
    return {q["id"]: rng.randint(1, 4) for q in QUESTIONS}


# --- the three required properties -----------------------------------------

def test_sample_data_has_twelve_users_with_a_commitment_mismatch(users):
    assert len(users) == 12
    assert any(
        not commitment_compatible(a.profile, b.profile)
        for a, b in itertools.combinations(users, 2)
    ), "sample data should include at least one mismatched pair to test against"


def test_mismatched_commitment_is_never_matched_for_long_term(users):
    for me in [u for u in users if requires_quiz(u.intention)]:
        matches = top_matches(me, others(me, users))
        for other in others(me, users):
            gap = abs(me.profile["commitment"] - other.profile["commitment"])
            if gap > 1:
                assert other not in matches, f"{me.name} matched {other.name} (gap {gap:.2f})"


def test_scores_stay_between_1_and_4(users):
    rng = random.Random(9001)
    answer_sets = [u.answers for u in users]
    answer_sets += [random_answers(rng) for _ in range(500)]
    for extreme in (1, 4):
        answer_sets.append({q["id"]: extreme for q in QUESTIONS})
    for answers in answer_sets:
        for dimension, value in score(answers).items():
            assert 1 <= value <= 4, f"{dimension} = {value}"


def test_long_term_gets_no_more_than_three_matches(users):
    for me in [u for u in users if requires_quiz(u.intention)]:
        for limit in (1, 3, 5, 100):
            matches = top_matches(me, others(me, users), limit=limit)
            assert len(matches) <= MAX_MATCHES


def test_cap_holds_with_a_large_pool():
    from dataclasses import replace
    rng = random.Random(42)
    me = load_users(SAMPLE_USERS)[0]
    pool = [replace(me, id=f"pool-{i}", answers=random_answers(rng)) for i in range(200)]
    assert len(top_matches(me, pool, limit=50)) <= MAX_MATCHES


# --- supporting checks ------------------------------------------------------

def test_fifteen_questions_three_per_section_with_four_options_each():
    assert len(QUESTIONS) == 15
    assert len({q["id"] for q in QUESTIONS}) == 15
    sections = {}
    for q in QUESTIONS:
        sections.setdefault(q["section"], []).append(q["id"])
        assert set(q) >= {"id", "text", "options", "dimension", "reverse", "kind"}
        assert len(q["options"]) == 4
    assert len(sections) == 5
    assert all(len(ids) == 3 for ids in sections.values()), sections


def test_every_question_feeds_the_score_or_is_a_tagged_value():
    scored = {q for ids in DIMENSIONS.values() for q in ids}
    for q in QUESTIONS:
        if q["kind"] == "value":
            assert q["id"] not in scored
        else:
            assert q["id"] in scored, f"question {q['id']} is not in any dimension"


def test_answers_saved_with_the_old_twenty_questions_still_score():
    old = {i: 2 for i in range(1, 21)}
    old[16] = [1, 2, 3, 4]  # the held-back ranking question
    assert set(score(old)) == set(DIMENSIONS)


def test_dimensions_agree_with_question_tags():
    for dimension, ids in DIMENSIONS.items():
        tagged = [q["id"] for q in QUESTIONS if q["dimension"] == dimension]
        assert tagged == ids


def test_conflict_is_reversed_so_option_a_is_healthiest():
    best = {q["id"]: 1 for q in QUESTIONS}  # everyone picks option A
    assert score(best)["conflict"] == 4


def test_matches_ranked_best_first(users):
    me = users[0]
    matches = top_matches(me, others(me, users))
    scores = [compatible(me, m) for m in matches]
    assert scores == sorted(scores, reverse=True)


def test_invalid_choice_rejected():
    answers = {q["id"]: 1 for q in QUESTIONS}
    answers[1] = 5
    with pytest.raises(ValueError):
        score(answers)


def test_storage_round_trip(tmp_path, users):
    path = tmp_path / "users.json"
    save_users(users, path)
    assert load_users(path) == users


def test_user_from_dict_converts_answer_keys():
    user = User.from_dict({"id": "x", "name": "X", "age": 30, "answers": {"1": 2}})
    assert user.answers == {1: 2}
