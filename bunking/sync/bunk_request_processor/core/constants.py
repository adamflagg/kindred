"""System constants for bunk request processing.

These constants define configuration values and mappings that are
used throughout the system."""

from __future__ import annotations

# Valid session types for bunking (kept as simple constant for reference)
# For DB-based session queries, use SessionRepository.get_valid_bunking_session_ids()
VALID_SESSION_TYPES = {"main", "embedded", "ag"}

# Source field to RequestSource mapping
SOURCE_FIELD_TO_SOURCE = {
    "share_bunk_with": "family",
    "do_not_share_with": "staff",
    "ret_parent_socialize_with_best": "parent",
    "internal_notes": "staff-notes",
    "bunking_notes": "staff-notes",
}

# Priority keywords that indicate high importance
# These should match the keywords in ai_config.json priority_overrides.keywords
# plus common variations that parents use
PRIORITY_KEYWORDS = [
    # Original keywords
    "must have",
    "very important",
    "top priority",
    "essential",
    "critical",
    "urgent",
    "first choice",
    "most important",
    "must be with",  # Config: must_be_with
    "#1",  # Config: hashtag_one
]

# Age filtering constants
MAX_AGE_DIFFERENCE_MONTHS = 36  # For pre-filtering candidates
DEFAULT_AGE_SPREAD_MONTHS = 24  # For validation warnings

# Confidence thresholds
# These define base confidence values for match types and status thresholds.
# Status determination:
#   >= auto_accept (0.95): resolved, high confidence (shown with ✓✓ in UI)
#   >= resolved (0.85): resolved, standard confidence (shown with ✓ in UI)
#   < resolved (0.85): pending, needs manual review
CONFIDENCE_THRESHOLDS = {
    # Match type base scores
    "exact_match": 1.0,
    "nickname_match": 0.9,
    "fuzzy_match": 0.8,
    "phonetic_match": 0.7,
    # Boost values (added to base confidence)
    "social_graph_boost": 0.1,
    "same_school_boost": 0.05,
    # Status thresholds (used by collected_request.py)
    "auto_accept": 0.95,  # High confidence, no staff review needed
    "resolved": 0.85,  # Standard confidence, staff may spot-check
}

# Name resolution settings
NAME_RESOLUTION_SETTINGS = {
    "fuzzy_threshold": 85,  # Levenshtein ratio threshold
    "max_candidates_for_ai": 10,  # Limit candidates sent to AI
    "cache_ttl_seconds": 3600,  # 1 hour cache
}

# Batch processing settings
BATCH_SETTINGS = {"default_batch_size": 50, "max_batch_size": 200, "parallel_workers": 4}

# Nickname groups for matching
NICKNAME_GROUPS = [
    # Common nicknames
    {"John", "Johnny", "Jon"},
    {"William", "Will", "Bill", "Billy"},
    {"Robert", "Rob", "Bob", "Bobby"},
    {"Richard", "Rick", "Dick", "Ricky"},
    {"Michael", "Mike", "Mikey"},
    {"James", "Jim", "Jimmy", "Jamie"},
    {"Joseph", "Joe", "Joey"},
    {"Thomas", "Tom", "Tommy"},
    {"Charles", "Charlie", "Chuck"},
    {"Christopher", "Chris"},
    {"Daniel", "Dan", "Danny"},
    {"Matthew", "Matt", "Matty"},
    {"David", "Dave", "Davey"},
    {"Andrew", "Andy", "Drew"},
    {"Steven", "Steve"},
    {"Kenneth", "Ken", "Kenny"},
    {"Joshua", "Josh"},
    {"Kevin", "Kev"},
    {"Brian", "Bryan"},
    {"George", "Georgie"},
    {"Edward", "Ed", "Eddie"},
    {"Ronald", "Ron", "Ronnie"},
    {"Timothy", "Tim", "Timmy"},
    {"Nicholas", "Nick", "Nicky"},
    {"Alexander", "Alex", "Al"},
    {"Raymond", "Ray"},
    {"Gregory", "Greg"},
    {"Samuel", "Sam", "Sammy"},
    {"Benjamin", "Ben", "Benny"},
    {"Patrick", "Pat", "Patty"},
    {"Peter", "Pete"},
    {"Harold", "Harry"},
    {"Douglas", "Doug"},
    {"Lawrence", "Larry"},
    {"Francis", "Frank", "Frankie"},
    {"Albert", "Al"},
    {"Wayne", "Waynie"},
    # Female nicknames
    {"Elizabeth", "Liz", "Beth", "Betty", "Eliza", "Lizzie"},
    {"Margaret", "Maggie", "Meg", "Peggy", "Marge"},
    {"Patricia", "Pat", "Patty", "Trish"},
    {"Jennifer", "Jen", "Jenny"},
    {"Linda", "Lindy"},
    {"Barbara", "Barb", "Barbie"},
    {"Susan", "Sue", "Susie"},
    {"Jessica", "Jess", "Jessie"},
    {"Sarah", "Sara"},
    {"Karen", "Kari"},
    {"Nancy", "Nan"},
    {"Betty", "Bette"},
    {"Dorothy", "Dot", "Dottie"},
    {"Sandra", "Sandy"},
    {"Ashley", "Ash"},
    {"Kimberly", "Kim"},
    {"Donna", "Donnie"},
    {"Emily", "Em", "Emmy"},
    {"Michelle", "Shelly"},
    {"Carol", "Carrie"},
    {"Amanda", "Mandy"},
    {"Melissa", "Mel", "Missy"},
    {"Deborah", "Deb", "Debbie"},
    {"Stephanie", "Steph"},
    {"Rebecca", "Becca", "Becky"},
    {"Laura", "Laurie"},
    {"Sharon", "Shari"},
    {"Cynthia", "Cindy"},
    {"Kathleen", "Kathy", "Kate", "Katie"},
    {"Amy", "Aimee"},
    {"Shirley", "Shirl"},
    {"Angela", "Angie"},
    {"Helen", "Ellie"},
    {"Anna", "Annie"},
    {"Brenda", "Bren"},
    {"Pamela", "Pam"},
    {"Nicole", "Nikki"},
    {"Samantha", "Sam", "Sammy"},
    {"Katherine", "Kate", "Katie", "Kathy"},
    {"Christine", "Chris", "Christie"},
    {"Debra", "Deb", "Debbie"},
    {"Rachel", "Rae"},
    {"Janet", "Jan"},
    {"Catherine", "Cathy", "Cat"},
    {"Maria", "Marie"},
    {"Heather", "Heath"},
    {"Diane", "Di"},
    {"Ruth", "Ruthie"},
    {"Julie", "Jules"},
    {"Olivia", "Liv", "Livy"},
    {"Joyce", "Joy"},
    {"Virginia", "Ginny"},
    {"Victoria", "Vicky", "Tori"},
    {"Kelly", "Kel"},
    {"Lauren", "Laurie"},
    {"Christina", "Tina"},
    {"Joan", "Joanie"},
    {"Evelyn", "Eve", "Evie"},
    {"Judith", "Judy"},
    {"Megan", "Meg"},
    {"Cheryl", "Cher"},
    {"Andrea", "Andi"},
    {"Hannah", "Han"},
    {"Martha", "Marty"},
    {"Madison", "Maddie"},
    {"Teresa", "Terry"},
    {"Gloria", "Glory"},
    {"Sara", "Sarah"},
    {"Janice", "Jan"},
    {"Ann", "Anne", "Annie"},
    {"Doris", "Dori"},
    {"Abigail", "Abby", "Gail"},
    {"Natalie", "Nat"},
    {"Brittany", "Britt"},
    {"Danielle", "Dani"},
    {"Alexis", "Lexi"},
    {"Kayla", "Kay"},
    {"Charlotte", "Charlie", "Lottie"},
    {"Sophia", "Sophie"},
]
