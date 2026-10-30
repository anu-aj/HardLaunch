"""Small, fixed choices keep the classroom demo predictable and offline."""

CITIES = ["Sydney", "Melbourne", "Brisbane", "Canberra", "Perth", "Adelaide", "Hobart", "Darwin"]
GENDERS = {"woman": "Woman", "man": "Man", "non_binary": "Non-binary", "another": "Another identity"}
PREFERENCES = {"woman": "Women", "man": "Men", "non_binary": "Non-binary people", "another": "People of another identity"}
QUIZ_INTENTION = "Long-term relationship"
QUIZ_FREE_INTENTIONS = ["Exploring connections", "Casual dating"]
INTENTIONS = [QUIZ_INTENTION] + QUIZ_FREE_INTENTIONS
INTERESTS = ["Cooking", "Coffee", "Books", "Music", "Outdoors", "Art", "Films", "Gaming", "Travel", "Fitness", "Animals", "Gardening"]
AVATARS = ["sun", "flower", "cloud", "peach", "planet", "spark"]
PROMPTS = {"building": "A life I'm building toward", "sunday": "My ideal Sunday"}
CHAPTERS = ["Connection", "Communication", "Everyday life", "Values", "Relationship pace"]


def requires_quiz(intention):
    return intention == QUIZ_INTENTION
