"""Reproducible fictional fixtures and avatar art; standard library only.

The logo and app icons are not generated here: they come from the HardLaunch brand
files in branding/ (web/assets/logo.svg, icon-192.png, icon-512.png, icon-maskable-512.png)."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "web" / "assets"


def make_avatars():
    colours = {"sun": ("#F7DF89", "#F2C34B"), "flower": ("#EAE1F4", "#B6A0D0"),
               "cloud": ("#E0EBD8", "#B2C59E"), "peach": ("#FADDD3", "#F18D7C"),
               "planet": ("#E0E7F6", "#9BAED4"), "spark": ("#F8DEEA", "#E99BBA")}
    shapes = {
        "sun": '<path d="M120 25l15 22 25-11 4 27 27 3-10 25 24 16-23 17 11 25-28 3-2 28-26-11-17 23-15-23-26 11-3-28-28-3 11-25-23-17 23-16-10-25 27-3 4-27 25 11z"/>',
        "flower": '<path d="M120 48c20-33 54-14 45 15 37-8 54 28 26 47 30 22 12 57-21 47 6 37-32 49-50 21-22 30-57 10-45-21-37 8-52-29-24-47-29-22-8-57 24-47-9-32 25-50 45-15z"/>',
        "cloud": '<path d="M66 155c-39-4-43-60-6-70 1-39 55-51 75-21 36-16 69 11 61 44 34 25 13 65-21 62H77z"/>',
        "peach": '<path d="M117 72C62 27 27 98 62 147c22 31 42 39 58 48 33-14 69-43 74-81 9-58-40-67-77-42z"/><path d="M120 65c-4-24 13-38 31-35-2 23-16 35-31 35z" fill="#6B8A5D"/>',
        "planet": '<circle cx="120" cy="115" r="67"/><ellipse cx="120" cy="115" rx="103" ry="27" transform="rotate(-28 120 115)" fill="none" stroke-width="8"/>',
        "spark": '<path d="M120 30l21 51 54-18-23 52 36 32-54 6-4 48-30-37-35 31-1-48-52-10 39-29-20-51 49 22z"/>',
    }
    (ASSETS / "avatars").mkdir(parents=True, exist_ok=True)
    for name, (background, body) in colours.items():
        face = '<ellipse cx="101" cy="111" rx="5" ry="8" fill="#24132E"/><ellipse cx="139" cy="111" rx="5" ry="8" fill="#24132E"/><path d="M108 130q12 15 24 0" fill="none" stroke="#24132E" stroke-width="4" stroke-linecap="round"/>'
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" rx="36" fill="{background}"/><g stroke="#24132E" stroke-width="3" stroke-linejoin="round" fill="{body}">{shapes[name]}</g>{face}<path d="M49 198l6-12 5 12 12 5-12 5-5 12-6-12-12-5z" fill="#24132E"/><circle cx="200" cy="48" r="5" fill="#24132E"/></svg>'
        (ASSETS / "avatars" / f"{name}.svg").write_text(svg, encoding="utf-8")


def make_samples():
    rows = [
        ("Maya", 27, "Sydney", "woman", "sun", ["Cooking", "Books", "Outdoors"], "A small home with a big garden, a dog, and Sunday lunches that run until dark."),
        ("Leo", 29, "Sydney", "man", "peach", ["Cooking", "Coffee", "Music"], "Opening a neighbourhood bakery. You can be my very honest taste tester."),
        ("Rowan", 28, "Sydney", "non_binary", "flower", ["Books", "Art", "Outdoors"], "A slow morning, a bookshop detour, and absolutely no plans after lunch."),
        ("Nina", 26, "Sydney", "woman", "cloud", ["Outdoors", "Animals", "Cooking"], "More little adventures. Less looking at my phone. A very happy rescue dog."),
        ("Kai", 30, "Sydney", "another", "planet", ["Gaming", "Music", "Films"], "A creative life with space for people, projects, and terrible puns."),
        ("Asha", 25, "Melbourne", "woman", "spark", ["Art", "Coffee", "Books"], "A studio full of sunlight and friends who turn up for dinner."),
        ("Jules", 28, "Melbourne", "non_binary", "sun", ["Travel", "Cooking", "Films"], "Learning a new recipe for every place on my travel list."),
        ("Sam", 31, "Brisbane", "man", "cloud", ["Fitness", "Animals", "Outdoors"], "Beach walks, a good routine, and someone to share the quiet bits with."),
        ("Theo", 24, "Sydney", "man", "spark", ["Music", "Gaming", "Coffee"], "Making music, meeting people, and seeing where life takes me."),
        ("Ivy", 32, "Sydney", "woman", "flower", ["Gardening", "Art", "Books"], "Growing a garden with more tomatoes than I know what to do with."),
        ("Alex", 29, "Sydney", "non_binary", "planet", ["Travel", "Films", "Cooking"], "A year with more stamps in my passport and more stories to tell."),
        ("Noor", 27, "Canberra", "another", "peach", ["Books", "Gardening", "Music"], "A thoughtful life, a slightly chaotic bookshelf, and plenty of tea."),
    ]
    base = {1: 2, 3: 2, 5: 2, 6: 1, 7: 1, 9: 2, 10: 2, 11: 2, 12: 2, 14: 4, 15: 4, 17: 3, 18: 3, 19: 3, 20: 4}
    users = []
    for i, (name, age, city, gender, avatar, interests, prompt) in enumerate(rows):
        answers = dict(base)
        if i:
            answers[12] = 1 + i % 4
            answers[17] = 1 + (i + 1) % 4
            answers[10] = 1 + (i % 3)
        if i in (4, 5, 7, 10):
            answers[14] = 2
        if i == 8:
            answers.update({18: 1, 19: 1, 20: 1})
        users.append({"id": f"sample-{i + 1:02}", "name": name, "age": age, "city": city,
                      "gender": gender, "identity_text": "Genderqueer" if gender == "another" else "",
                      "pronouns": "", "preferred_genders": ["woman", "man", "non_binary", "another"],
                      "age_min": 23, "age_max": 36, "intention": "Casual dating" if i == 10 else "Long-term relationship",
                      "avatar": avatar, "interests": interests, "prompt": "sunday" if i == 2 else "building",
                      "building_toward": prompt, "status": "complete", "answers": {str(k): v for k, v in answers.items()}})
    (ROOT / "data" / "sample_users.json").write_text(json.dumps(users, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    make_avatars()
    make_samples()
