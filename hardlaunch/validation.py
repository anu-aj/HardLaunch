"""Validate on the Python side, including requests not sent by our interface."""

from hardlaunch.catalog import AVATARS, CITIES, GENDERS, INTERESTS, INTENTIONS, PROMPTS, requires_quiz
from hardlaunch.models import User
from hardlaunch.photos import validate_photo
from hardlaunch.questions import QUESTIONS_BY_ID


class ValidationError(ValueError):
    def __init__(self, errors):
        self.errors = errors
        super().__init__(next(iter(errors.values())))


def validate_profile(data, complete=False):
    if not isinstance(data, dict):
        raise ValidationError({"form": "Please send a profile object."})
    errors = {}
    try:
        validate_photo(data.get("photo", ""))
    except ValueError as error:
        errors["photo"] = str(error)
    cleaned = dict(data)
    for key, maximum in {"name": 40, "pronouns": 40, "identity_text": 60,
                         "building_toward": 240, "role": 80, "company": 80}.items():
        value = data.get(key, "")
        if not isinstance(value, str) or len(value.strip()) > maximum:
            errors[key] = f"Use at most {maximum} characters."
        else:
            cleaned[key] = value.strip()
    if complete and not cleaned.get("name"):
        errors["name"] = "Add your first name."
    for key, default in (("age", 0), ("age_min", 18), ("age_max", 99)):
        value = data.get(key, default)
        cleaned[key] = value
        if type(value) is not int or not (18 <= value <= 99 or (key == "age" and value == 0 and not complete)):
            errors[key] = "Use a whole number from 18 to 99."
    if not errors.get("age_min") and not errors.get("age_max"):
        if data.get("age_min", 18) > data.get("age_max", 99):
            errors["age_max"] = "Maximum age must be at least the minimum age."
    for key, options, default in (("city", CITIES, ""), ("gender", GENDERS, ""),
                                   ("intention", INTENTIONS, ""), ("avatar", AVATARS, "sun"),
                                   ("prompt", PROMPTS, "building")):
        value = data.get(key, default)
        if not isinstance(value, str) or (value not in options and (complete or value != "")):
            errors[key] = "Choose one of the available options."
    for key, options, maximum in (("preferred_genders", GENDERS, 4), ("interests", INTERESTS, 3)):
        value = data.get(key, [])
        if not isinstance(value, list) or any(not isinstance(v, str) or v not in options for v in value):
            errors[key] = "Choose from the available options."
        elif len(value) != len(set(value)) or len(value) > maximum:
            errors[key] = f"Choose up to {maximum} different options."
        elif key == "preferred_genders" and complete and not value:
            errors[key] = "Choose at least one gender, or Everyone."
    answers = data.get("answers", {})
    if not isinstance(answers, dict):
        errors["answers"] = "Choose an answer for each question."
    else:
        normalized = {}
        for key, value in answers.items():
            try:
                question_id = int(key)
            except (ValueError, TypeError):
                errors["answers"] = "Question identifiers must be numbers."
                continue
            # Held-back questions from legacy profiles are no longer scored.
            if question_id not in QUESTIONS_BY_ID:
                continue
            if type(value) is not int or value not in (1, 2, 3, 4):
                errors["answers"] = "Choose one of the four answers."
            normalized[question_id] = value
        if complete and requires_quiz(data.get("intention")) and set(normalized) != set(QUESTIONS_BY_ID):
            errors["answers"] = "Finish all 15 questions for long-term relationship matching."
        cleaned["answers"] = normalized
    if errors:
        raise ValidationError(errors)
    cleaned["status"] = "complete" if complete else "draft"
    return User.from_dict(cleaned)


def is_complete(user):
    if user.status != "complete":
        return False
    try:
        validate_profile(user.to_dict(), complete=True)
        return True
    except (ValidationError, TypeError, KeyError):
        return False
