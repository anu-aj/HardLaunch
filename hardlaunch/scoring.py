"""Transparent answer alignment: filter people first, then compare responses.

A long-term score out of 100 has three parts:
    60  similarity in six areas (10 each)
    20  the two values questions (10 each when you chose the same answer)
    20  care fit: is each person's need for reassurance likely to be met?
"""

from hardlaunch.questions import QUESTIONS_BY_ID, VALUE_TYPES
from hardlaunch.catalog import QUIZ_FREE_INTENTIONS, requires_quiz

DIMENSIONS = {
    "anxiety": [1, 5],
    "avoidance": [3],
    "conflict": [6, 7, 9],          # reversed in questions.py: 4 = healthiest
    "stability": [10],
    "agreeable": [11],
    "organised": [12],
    "novelty": [17],
    "commitment": [18, 19, 20],
}

# Areas where being alike helps. Anxiety and helping others are used by care fit instead.
SIMILAR_AREAS = ["avoidance", "conflict", "stability", "organised", "novelty", "commitment"]

MAX_MATCHES = 3           # Long-term introductions only.
MAX_COMMITMENT_GAP = 1.0
MAX_COMPATIBILITY = 100
ANXIOUS_FROM = 2.5        # An anxiety score from here up means "looks for reassurance".
AVOIDANT_FROM = 2.5       # An avoidance score from here up means "prefers to cope alone".
GIVER_FROM = 3            # A helping-others score from here up means "a giver".


def answer_value(question_id, choice):
    """Score one answer 1..4, flipping it if the question is reversed."""
    if type(choice) is not int or choice not in (1, 2, 3, 4):
        raise ValueError(f"Question {question_id}: choice must be 1-4, got {choice!r}")
    if QUESTIONS_BY_ID[question_id]["reverse"]:
        return 5 - choice
    return choice


def score(answers):  # answers: {question_number: chosen option 1..4}
    return {
        d: sum(answer_value(q, answers[q]) for q in qs) / len(qs)
        for d, qs in DIMENSIONS.items()
    }


def value_types(answers):
    """The tagged value types from questions 14 (core) and 15 (non-negotiable)."""
    return {
        "core": VALUE_TYPES[answers[14] - 1],
        "non_negotiable": VALUE_TYPES[answers[15] - 1],
    }


def commitment_compatible(a, b):
    return abs(a["commitment"] - b["commitment"]) <= MAX_COMMITMENT_GAP


def is_anxious(profile):
    return profile["anxiety"] >= ANXIOUS_FROM


def is_giver(profile):
    return profile["agreeable"] >= GIVER_FROM


def reassurance_points(profile, partner):
    """10 points when this person's need for reassurance is likely to be met."""
    if not is_anxious(profile):
        return 10
    if is_giver(partner):
        return 10
    return 5


def care_fit(a, b):
    """Up to 20 points, checked in both directions, so gender never changes it."""
    return reassurance_points(a, b) + reassurance_points(b, a)


def compatible(a, b):
    """Long-term answer alignment, or None when a quiz score does not apply."""
    if not (requires_quiz(a.intention) and requires_quiz(b.intention)):
        return None
    mine = a.profile
    theirs = b.profile
    total = 0
    for area in SIMILAR_AREAS:
        gap = abs(mine[area] - theirs[area])   # 0 (same) to 3 (opposite ends)
        total = total + 10 * (1 - gap / 3)
    for question in (14, 15):
        if a.answers[question] == b.answers[question]:
            total = total + 10
    total = total + care_fit(mine, theirs)
    return round(total)


def score_label(alignment):
    """A friendly label, so people read the number as a guide, not a grade."""
    if alignment is None:
        return ""
    if alignment >= 80:
        return "Strong common ground"
    if alignment >= 65:
        return "Good common ground"
    return "Worth exploring"


def eligible(me, other):
    from hardlaunch.validation import is_complete

    common_rules_pass = (
        me.id != other.id and is_complete(me) and is_complete(other)
        and me.city == other.city
        and other.gender in me.preferred_genders and me.gender in other.preferred_genders
        and me.age_min <= other.age <= me.age_max
        and other.age_min <= me.age <= other.age_max
        and me.intention == other.intention
    )
    if not common_rules_pass:
        return False
    if requires_quiz(me.intention):
        return commitment_compatible(me.profile, other.profile)
    return me.intention in QUIZ_FREE_INTENTIONS


def shared_interest_count(me, other):
    count = 0
    for interest in me.interests:
        if interest in other.interests:
            count = count + 1
    return count


def rank_by_alignment(me, candidates):
    """Called only for completed long-term profiles. Highest score first, then by id."""
    people = list(candidates)
    rows = []
    for index, person in enumerate(people):
        rows.append((-compatible(me, person), person.id, index))
    rows.sort()
    ranked = []
    for row in rows:
        ranked.append(people[row[2]])
    return ranked


def rank_by_shared_interests(me, candidates):
    """Casual and exploring profiles need no quiz answers."""
    people = list(candidates)
    rows = []
    for index, person in enumerate(people):
        rows.append((-shared_interest_count(me, person), person.id, index))
    rows.sort()
    ranked = []
    for row in rows:
        ranked.append(people[row[2]])
    return ranked


def top_matches(me, pool, limit=None):
    """Three long-term introductions; all eligible people for other intentions."""
    candidates = {}
    for person in pool:
        if person.id not in candidates and eligible(me, person):
            candidates[person.id] = person
    if requires_quiz(me.intention):
        ranked = rank_by_alignment(me, candidates.values())
        limit = MAX_MATCHES if limit is None else min(limit, MAX_MATCHES)
    elif me.intention in QUIZ_FREE_INTENTIONS:
        ranked = rank_by_shared_interests(me, candidates.values())
    else:
        return []
    return ranked if limit is None else ranked[:max(0, limit)]


def public_profile(person):
    """The visible card, without private preferences or raw quiz answers."""
    return {key: getattr(person, key) for key in (
        "id", "name", "age", "city", "gender", "identity_text", "pronouns", "avatar",
        "photo", "role", "company", "interests", "prompt", "building_toward", "intention")}


def preview_introductions(me, samples):
    """Fictional, read-only previews. Real local matches come from connections.reconcile."""
    introductions = []
    for other in top_matches(me, samples):
        details = match_details(me, other)
        details["can_chat"] = False
        details["auto_matched"] = False
        details["meet_status"] = "preview"
        introductions.append(details)
    return introductions


DIMENSION_LABELS = {
    "anxiety": "Staying connected", "avoidance": "Sharing support",
    "conflict": "Communication", "stability": "Changing plans", "agreeable": "Helping others",
    "organised": "Making plans", "novelty": "Trying new things", "commitment": "Relationship pace",
}

ATTACHMENT_STYLES = {
    "secure": {
        "name": "Secure",
        "title": "The steady anchor",
        "text": "You're comfortable with closeness and you give people room too. Partners often feel calm and safe around you.",
        "partner": "You can build something lovely with many kinds of people. Someone who matches your openness will feel like home.",
    },
    "anxious": {
        "name": "Anxious",
        "title": "The devoted heart",
        "text": "You care deeply and notice the little signals. Feeling close and reassured matters to you, and that is not too much to ask.",
        "partner": "You'll likely feel most at ease with someone who loves to show up for people. Your introductions give extra weight to givers.",
    },
    "avoidant": {
        "name": "Avoidant",
        "title": "The independent spirit",
        "text": "You value your own space and handle a lot by yourself. Once you trust someone, your steadiness is a real gift.",
        "partner": "Someone patient, who respects your space and lets closeness grow at its own pace, will suit you well.",
    },
    "fearful": {
        "name": "Fearful-avoidant",
        "title": "The thoughtful protector",
        "text": "You want closeness and you also protect yourself. That usually comes from caring a lot, and it softens with the right person.",
        "partner": "Gentle, consistent people help you feel safe. There is no rush. Take it at your own pace.",
    },
}


def attachment_style(profile):
    """One of four styles, from the anxiety (questions 1, 5) and avoidance (question 3) scores."""
    anxious = profile["anxiety"] >= ANXIOUS_FROM
    avoidant = profile["avoidance"] >= AVOIDANT_FROM
    if anxious and avoidant:
        return "fearful"
    if anxious:
        return "anxious"
    if avoidant:
        return "avoidant"
    return "secure"


def wavelength_summary(person):
    """What the quiz says about you, shown after the 15 questions. None until the quiz is done."""
    if not requires_quiz(person.intention):
        return None
    for question_id in QUESTIONS_BY_ID:
        if question_id not in person.answers:
            return None
    profile = person.profile
    key = attachment_style(profile)
    style = ATTACHMENT_STYLES[key]
    strengths = []
    if is_giver(profile):
        strengths.append("You show up for the people you care about.")
    if profile["conflict"] >= 3:
        strengths.append("You talk things through with care.")
    if profile["stability"] >= 3:
        strengths.append("You stay steady when plans change.")
    if profile["commitment"] >= 3:
        strengths.append("You're ready to make real room for someone.")
    if profile["novelty"] >= 3:
        strengths.append("You bring fresh ideas and adventures.")
    if profile["organised"] >= 3:
        strengths.append("You plan ahead, so people can count on you.")
    if not strengths:
        strengths.append("You know what you want, and you were honest about it.")
    return {
        "style": key,
        "name": style["name"],
        "title": style["title"],
        "text": style["text"],
        "partner": style["partner"],
        "strengths": strengths[:3],
        "core_value": VALUE_TYPES[person.answers[14] - 1],
        "note": "Nothing in your answers is wrong with you. Every style can love and be loved well, "
                "and your person is out there. This is a gentle reflection from a short quiz, not a diagnosis.",
    }


def quiz_details(me, other):
    """Explain long-term matches using the same comparisons as the quiz score."""
    a, b = me.profile, other.profile
    reasons = []
    if care_fit(a, b) == 20 and (is_anxious(a) or is_anxious(b)):
        # Worded so that neither person's private answers are revealed.
        reasons.append({"title": "Care that fits",
                        "text": "The way you each give and receive care fits well together."})
    for question, title, text in (
        (14, "A shared picture", "You chose the same picture of the next five years."),
        (15, "Similar priorities", "You agree on what would be hardest to give up in a relationship."),
    ):
        if me.answers[question] == other.answers[question]:
            reasons.append({"title": title, "text": text})
    gaps = []
    for area in SIMILAR_AREAS:
        gaps.append((abs(a[area] - b[area]), area))
    gaps.sort()
    for gap, area in gaps:
        if gap <= 0.5 and len(reasons) < 3:
            reasons.append({"title": DIMENSION_LABELS[area],
                            "text": "Your answers in this area are similar. It could be a good place to start."})
    if len(reasons) < 2:
        reasons.append({"title": "The same intention", "text": f"You're both here for: {me.intention.lower()}."})
    if len(reasons) < 2:
        reasons.append({"title": "In your city", "text": f"You both selected {me.city}."})

    # The question you answered most differently, preferring the two values questions.
    chosen = None
    chosen_rank = None
    for question_id in QUESTIONS_BY_ID:
        if me.answers[question_id] != other.answers[question_id]:
            rank = (question_id in (14, 15), abs(me.answers[question_id] - other.answers[question_id]))
            if chosen is None or rank > chosen_rank:
                chosen = question_id
                chosen_rank = rank
    if chosen is not None:
        question = QUESTIONS_BY_ID[chosen]
        explore = {"title": "A conversation worth having", "text": question["text"],
                   "yours": question["options"][me.answers[chosen] - 1],
                   "theirs": question["options"][other.answers[chosen] - 1]}
    else:
        explore = {"title": "There is more to discover", "text": "Your quiz answers line up. What is something these questions didn't capture about you?"}
    return reasons, explore


def match_details(me, other):
    """Use quiz evidence only for long-term matches, even with saved old answers."""
    shared = [interest for interest in me.interests if interest in other.interests]
    alignment = None
    if requires_quiz(me.intention) and requires_quiz(other.intention):
        alignment = compatible(me, other)
        reasons, explore = quiz_details(me, other)
    else:
        reasons = [
            {"title": "The same intention", "text": f"You're both here for: {me.intention.lower()}."},
            {"title": "In your city", "text": f"You both selected {me.city}."},
        ]
        if shared:
            reasons.append({"title": "Common interests", "text": "You both enjoy " + ", ".join(shared).lower() + "."})
        explore = {"title": "A conversation worth having", "text": "What would a great first meet-up look like for each of you?"}
    starters = {
        "Cooking": "What's your signature dish?", "Coffee": "Where would you take someone for a really good coffee?",
        "Books": "Which book would you lend me first?", "Music": "What song have you had on repeat?",
        "Outdoors": "What's your favourite place to get a little fresh air?", "Art": "What have you seen lately that inspired you?",
        "Films": "Which film would you happily watch again?", "Gaming": "What's your ideal game night?",
        "Travel": "Where would you go for a spontaneous weekend?", "Fitness": "What's your favourite way to get moving?",
        "Animals": "Tell me about an animal that made your day.", "Gardening": "What would you plant in your dream garden?",
    }
    if shared:
        icebreaker = f"We both enjoy {shared[0].lower()}. {starters[shared[0]]}"
    elif other.building_toward:
        icebreaker = f'Your profile says "{other.building_toward}". What is the story behind that?'
    else:
        icebreaker = f"What's one place in {other.city} you'd love to show someone?"
    # Only the public profile is sent to the browser; quiz answers and private preferences stay in Python.
    return {"profile": public_profile(other), "score": alignment, "score_label": score_label(alignment),
            "reasons": reasons[:3], "explore": explore, "shared_interests": shared, "icebreaker": icebreaker}
