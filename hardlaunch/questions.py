"""The 15 HardLaunch quiz questions: the top three in each of the five sections.

Wording is original paraphrase of what each cited instrument measures (see the
HardLaunch Compatibility Quiz doc); none of it reproduces a copyrighted item.

The doc holds the full 20-question bank. This app ships the three questions per
section that the research supports best. Question ids are kept from the doc, so
they are not contiguous (2, 4, 8, 13 and 16 are held back) and answers saved
earlier still line up. Why each was kept or held back:

    Attachment (ECR-R)       kept 1, 3, 5. Covers both ECR-R dimensions (anxiety:
                             1 and 5, avoidance: 3). Held back 2 (repeats the
                             separation worry in 1) and 4 (pace of the
                             relationship, which Commitment already covers).
    Conflict and repair      kept 6, 7, 9. One each for criticism, defensiveness
                             and stonewalling, and bids for connection. Held back
                             8 (overlaps the stonewalling in 7).
    Personality (Big Five)   kept 10, 11, 12: emotional stability, agreeableness
                             and conscientiousness, the traits the match logic
                             weights. Held back 13 (extraversion).
    Values and growth        kept 14, 15, 17. Held back 16, the only question in
                             the bank that was original rather than adapted from
                             a published instrument.
    Commitment and readiness kept 18, 19, 20. The section only has three, and
                             commitment is the hard filter, so all stay.

Every question is a dict with:
    id         the question number in the doc
    section    the quiz section it belongs to
    text       the prompt shown to the user
    options    four answer strings, in the order A, B, C, D
    dimension  the score dimension it feeds ("values" is tagged, not averaged)
    reverse    True if option A should score 4 instead of 1
    kind       "scale" (scored 1..4) or "value" (tagged by value type)
    basis      the research the question is adapted from

Answers are always stored as the chosen option's position (A=1 .. D=4).
"""

VALUE_TYPES = [
    "Conservation",
    "Openness to change",
    "Self-enhancement",
    "Self-transcendence",
]

QUESTIONS = [
    # Attachment (ECR-R). Higher = more anxiety / more avoidance.
    {
        "id": 1,
        "section": "Attachment",
        "text": "You message someone you're seeing and an hour passes with no reply. What happens in your head?",
        "options": [
            "Not much, I carry on.",
            "I check my phone, but stay calm.",
            "I wonder if I said something wrong.",
            "I replay it and can't settle until they answer.",
        ],
        "dimension": "anxiety",
        "reverse": False,
        "kind": "scale",
        "basis": "ECR-R",
    },
    {
        "id": 3,
        "section": "Attachment",
        "text": "Something upsetting happens at work. What do you usually do?",
        "options": [
            "Tell my partner and lean on them.",
            "Share some, handle the rest myself.",
            "Mostly handle it alone.",
            "Keep it to myself; relying on others feels uncomfortable.",
        ],
        "dimension": "avoidance",
        "reverse": False,
        "kind": "scale",
        "basis": "ECR-R",
    },
    {
        "id": 5,
        "section": "Attachment",
        "text": "Thinking about how much you care compared with a partner:",
        "options": [
            "I trust we're about equal.",
            "I sometimes wonder.",
            "I often worry I care more.",
            "I'm convinced I always care more.",
        ],
        "dimension": "anxiety",
        "reverse": False,
        "kind": "scale",
        "basis": "ECR-R",
    },
    # Conflict and repair (Gottman). Reversed so 4 is the healthiest pattern.
    {
        "id": 6,
        "section": "Conflict and repair",
        "text": "You're upset about something your partner did. How do you usually raise it?",
        "options": [
            "Point to the specific thing and how I felt.",
            "Hint and hope they pick up on it.",
            "Bring up other past issues as well.",
            "Say what it shows about their character.",
        ],
        "dimension": "conflict",
        "reverse": True,
        "kind": "scale",
        "basis": "Gottman, Four Horsemen",
    },
    {
        "id": 7,
        "section": "Conflict and repair",
        "text": "Your partner tells you something you did hurt them.",
        "options": [
            "I listen, then own my part.",
            "I explain my side first.",
            "I point out something they did too.",
            "I go quiet and leave the conversation.",
        ],
        "dimension": "conflict",
        "reverse": True,
        "kind": "scale",
        "basis": "Gottman, Four Horsemen",
    },
    {
        "id": 9,
        "section": "Conflict and repair",
        "text": "Your partner says \"look at that dog!\" while you're busy.",
        "options": [
            "I stop and engage.",
            "I acknowledge it briefly.",
            "I respond later.",
            "I barely register it.",
        ],
        "dimension": "conflict",
        "reverse": True,
        "kind": "scale",
        "basis": "Gottman, bids for connection",
    },
    # Personality (Big Five). Option A is the named trait's strong pole, so
    # these are reversed: a higher score means more of the trait.
    {
        "id": 10,
        "section": "Personality",
        "text": "Plans change at the last minute.",
        "options": [
            "I roll with it.",
            "Mild annoyance, then I adjust.",
            "I'm stressed for a while.",
            "I feel really unsettled.",
        ],
        "dimension": "stability",
        "reverse": True,
        "kind": "scale",
        "basis": "Big Five",
    },
    {
        "id": 11,
        "section": "Personality",
        "text": "A friend asks for help during your busiest week.",
        "options": [
            "I drop things to help.",
            "I make time and help.",
            "I offer a small amount.",
            "I tell them honestly I can't.",
        ],
        "dimension": "agreeable",
        "reverse": True,
        "kind": "scale",
        "basis": "Big Five",
    },
    {
        "id": 12,
        "section": "Personality",
        "text": "Planning a weekend trip.",
        "options": [
            "A detailed plan in advance.",
            "A loose plan with key bookings.",
            "Decide on the day.",
            "I'd rather see what happens.",
        ],
        "dimension": "organised",
        "reverse": True,
        "kind": "scale",
        "basis": "Big Five",
    },
    # Values and growth (Schwartz; self-expansion).
    {
        "id": 14,
        "section": "Values and growth",
        "text": "Which five-year picture feels most like you?",
        "options": [
            "A stable home, family nearby, familiar routines.",
            "Living somewhere new on a different path.",
            "A standout achievement in my field.",
            "Work that helps others or my community.",
        ],
        "dimension": "values",
        "reverse": False,
        "kind": "value",
        "basis": "Schwartz values; Danioni et al.",
    },
    {
        "id": 15,
        "section": "Values and growth",
        "text": "Which would you find hardest to give up in a relationship?",
        "options": [
            "Stability and tradition.",
            "Freedom to explore.",
            "Ambition and success.",
            "Fairness and caring for others.",
        ],
        "dimension": "values",
        "reverse": False,
        "kind": "value",
        "basis": "Schwartz values; van der Wal et al.",
    },
    {
        "id": 17,
        "section": "Values and growth",
        "text": "After months together, your ideal evening is:",
        "options": [
            "Our usual routine.",
            "Cooking something new together.",
            "Trying an activity or place we've never been.",
            "A spontaneous adventure.",
        ],
        "dimension": "novelty",
        "reverse": False,
        "kind": "scale",
        "basis": "Self-expansion (Aron et al.)",
    },
    # Commitment and readiness (Investment Model). Higher = more committed.
    {
        "id": 18,
        "section": "Commitment and readiness",
        "text": "You're happy with someone you've dated for six months, and a new person shows real interest.",
        "options": [
            "I'd be curious to explore.",
            "I'd enjoy the attention but stay put.",
            "I'd stay focused on my partner.",
            "I wouldn't even notice.",
        ],
        "dimension": "commitment",
        "reverse": False,
        "kind": "scale",
        "basis": "Investment Model",
    },
    {
        "id": 19,
        "section": "Commitment and readiness",
        "text": "Over the next three months, how much room does your life have for another person?",
        "options": [
            "Very little; work and study fill it.",
            "A few evenings.",
            "Regular time.",
            "I'm actively making room.",
        ],
        "dimension": "commitment",
        "reverse": False,
        "kind": "scale",
        "basis": "Original",
    },
    {
        "id": 20,
        "section": "Commitment and readiness",
        "text": "The early excitement fades into a dull patch.",
        "options": [
            "I'd start looking elsewhere.",
            "I'd wonder if it's right.",
            "I'd try to bring the spark back.",
            "That's normal; I'd stay and invest.",
        ],
        "dimension": "commitment",
        "reverse": False,
        "kind": "scale",
        "basis": "Investment Model",
    },
]

QUESTIONS_BY_ID = {q["id"]: q for q in QUESTIONS}
