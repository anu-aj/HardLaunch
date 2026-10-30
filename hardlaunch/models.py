"""Data model for a HardLaunch user."""

from dataclasses import asdict, dataclass, field, fields

from hardlaunch import scoring


@dataclass
class User:
    id: str
    name: str
    age: int
    city: str = ""
    building_toward: str = ""   # "A life I'm building toward", in their words
    role: str = ""
    company: str = ""
    answers: dict = field(default_factory=dict)  # {question_id: 1..4}
    gender: str = ""
    identity_text: str = ""
    pronouns: str = ""
    preferred_genders: list = field(default_factory=list)
    age_min: int = 18
    age_max: int = 99
    intention: str = ""
    avatar: str = "sun"
    photo: str = ""           # Optional small image stored as a data URL in local JSON.
    interests: list = field(default_factory=list)
    prompt: str = "building"
    status: str = "draft"
    saved_step: str = "about"
    saved_question_index: int = 0

    @property
    def profile(self):
        """Averaged 1..4 score per dimension."""
        return scoring.score(self.answers)

    @property
    def values(self):
        return scoring.value_types(self.answers)

    @property
    def proof_of_work(self):
        return " · ".join(part for part in (self.role, self.company) if part)

    @classmethod
    def from_dict(cls, data):
        allowed = {f.name for f in fields(cls)}
        data = {k: v for k, v in data.items() if k in allowed}
        # JSON object keys are always strings; questions are keyed by int.
        data["answers"] = {int(k): v for k, v in data.get("answers", {}).items()}
        # Legacy records have no explicit preferences. Never guess them.
        if not data.get("gender") or not data.get("preferred_genders") or not data.get("intention"):
            data["status"] = "draft"
        return cls(**data)

    def to_dict(self):
        data = asdict(self)
        data["answers"] = {str(k): v for k, v in sorted(self.answers.items())}
        return data
