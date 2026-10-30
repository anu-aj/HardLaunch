"""Create ten fictional, editable local profiles for the presentation.

Run: python -m hardlaunch.demo_profiles
Repeated runs add only missing profiles; existing edits and messages are kept.
"""

import argparse
from pathlib import Path

from hardlaunch import storage
from hardlaunch.catalog import GENDERS, QUIZ_INTENTION, requires_quiz
from hardlaunch.models import User
from hardlaunch.validation import validate_profile


def build_demo_profiles():
    """Four long-term, three casual and three exploring profiles, all fictional."""
    rows = [
        {"name": "Zara", "age": 27, "gender": "woman", "pronouns": "she / her",
         "preferred_genders": ["man"], "intention": QUIZ_INTENTION, "avatar": "flower",
         "interests": ["Cooking", "Books", "Outdoors"], "role": "Architect", "company": "Clover Studio (fictional)",
         "building_toward": "A cosy home, a sunny kitchen, and weekend walks with someone kind."},
        {"name": "Ethan", "age": 29, "gender": "man", "pronouns": "he / him",
         "preferred_genders": ["woman"], "intention": QUIZ_INTENTION, "avatar": "sun",
         "interests": ["Cooking", "Books", "Music"], "role": "Product designer", "company": "Kindred Works (fictional)",
         "building_toward": "A steady partnership, creative work, and learning a new recipe every week."},
        {"name": "Harper", "age": 28, "gender": "non_binary", "pronouns": "they / them",
         "preferred_genders": ["another"], "intention": QUIZ_INTENTION, "avatar": "cloud",
         "interests": ["Art", "Gardening", "Animals"], "role": "Illustrator", "company": "Fern Press (fictional)",
         "building_toward": "A home full of art, plants, and a very spoiled rescue cat."},
        {"name": "Miles", "age": 30, "gender": "another", "identity_text": "Genderqueer", "pronouns": "they / them",
         "preferred_genders": ["non_binary"], "intention": QUIZ_INTENTION, "avatar": "planet",
         "interests": ["Art", "Gardening", "Coffee"], "role": "Landscape designer", "company": "Moss & Moon (fictional)",
         "building_toward": "Building a thoughtful life together, with space for a little adventure."},
        {"name": "Chloe", "age": 25, "gender": "woman", "pronouns": "she / her",
         "intention": "Casual dating", "avatar": "peach", "interests": ["Coffee", "Films", "Music"],
         "role": "Event coordinator", "company": "Confetti Collective (fictional)",
         "building_toward": "Brunch, a spontaneous film, and finding somewhere new for dessert."},
        {"name": "Finn", "age": 27, "gender": "man", "pronouns": "he / him",
         "intention": "Casual dating", "avatar": "spark", "interests": ["Coffee", "Films", "Cooking"],
         "role": "Chef", "company": "The Apricot Table (fictional)",
         "building_toward": "Coffee after the morning rush, a good comedy, and absolutely no alarms."},
        {"name": "Sage", "age": 26, "gender": "non_binary", "pronouns": "they / them",
         "intention": "Casual dating", "avatar": "flower", "interests": ["Music", "Films", "Art"],
         "role": "Photographer", "company": "Daylight Club (fictional)",
         "building_toward": "A photo walk, an outdoor film, and discovering a tiny live-music venue."},
        {"name": "Elena", "age": 28, "gender": "woman", "pronouns": "she / her",
         "intention": "Exploring connections", "avatar": "sun", "interests": ["Travel", "Books", "Outdoors"],
         "role": "Research assistant", "company": "Northstar Lab (fictional)",
         "building_toward": "A bookshop detour and a long walk with someone who asks good questions."},
        {"name": "Oscar", "age": 31, "gender": "man", "pronouns": "he / him",
         "intention": "Exploring connections", "avatar": "cloud", "interests": ["Travel", "Outdoors", "Coffee"],
         "role": "Software engineer", "company": "Pebble Systems (fictional)",
         "building_toward": "Finding a new walking trail and seeing where a good conversation goes."},
        {"name": "River", "age": 27, "gender": "another", "identity_text": "Agender", "pronouns": "they / them",
         "intention": "Exploring connections", "avatar": "planet", "interests": ["Books", "Travel", "Art"],
         "role": "Museum educator", "company": "Little Lantern Gallery (fictional)",
         "building_toward": "A gallery visit, a second-hand book, and a conversation that surprises me."},
    ]
    base_answers = {1: 2, 3: 2, 5: 2, 6: 1, 7: 1, 9: 2, 10: 2, 11: 3,
                    12: 2, 14: 4, 15: 4, 17: 3, 18: 3, 19: 3, 20: 4}
    profiles = []
    for index, row in enumerate(rows):
        data = dict(row)
        data.setdefault("preferred_genders", list(GENDERS))  # Explicit Everyone selection for these fictional people.
        answers = {}
        if requires_quiz(data["intention"]):
            answers = dict(base_answers)
            answers[12] = 2 + index % 2
            answers[17] = 2 + index // 2
        person = User(id=f"demo-ten-{index + 1:02}", city="Sydney", age_min=23, age_max=36,
                      status="complete", saved_step="matches", answers=answers,
                      prompt="building" if requires_quiz(data["intention"]) else "sunday", **data)
        profiles.append(validate_profile(person.to_dict(), complete=True))
    return profiles


def seed_demo_profiles(data_dir=storage.DATA_DIR):
    """Add missing demo IDs without replacing existing people or active progress."""
    path = Path(data_dir) / "local_users.json"
    users = storage.load_users(path)
    existing_ids = {person.id for person in users}
    additions = [person for person in build_demo_profiles() if person.id not in existing_ids]
    if additions:
        storage.save_users(users + additions, path)
    return len(additions)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Add ten fictional HardLaunch demo profiles")
    parser.add_argument("--data-dir", type=Path, default=storage.DATA_DIR)
    options = parser.parse_args()
    added = seed_demo_profiles(options.data_dir)
    print(f"Added {added} fictional profiles: 4 long-term, 3 casual, 3 exploring in the demo set.")
    print("Open Profiles in HardLaunch to switch between them.")
