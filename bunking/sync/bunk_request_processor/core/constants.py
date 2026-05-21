"""System constants for bunk request processing.

These constants define configuration values and mappings that are
used throughout the system."""

from __future__ import annotations

# Valid session types for bunking (kept as simple constant for reference)
# For DB-based session queries, use SessionRepository.get_valid_bunking_session_ids()
VALID_SESSION_TYPES = {"main", "embedded", "ag"}

# Priority keywords that indicate high importance
# These should match the keywords in ai_config.json priority_overrides.keywords
# plus common variations that parents use
#
# All entries are matched case-insensitively (lowercased before scan).
# Exception: "IMPORTANT" (all-caps) is handled separately in _has_priority_keyword
# as a case-sensitive guard — lowercase "important" is too common a word to trigger.
PRIORITY_KEYWORDS: tuple[str, ...] = (
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
    # OBR-validated additions (corpus mining: docs/plans/obr-priority-mining.md)
    "highest priority",  # "1) Olivia Chen (highest priority) 2) Liam Garcia…"
    "biggest request",  # "Her biggest request is to not be in the same bunk…"
    "only request",  # "our only request would be that she's with a few other kiddos…"
    "(priority)",  # "(priority)" inline after a name in ranked list
)

# Age filtering constants
MAX_AGE_DIFFERENCE_MONTHS = 36  # For pre-filtering candidates
# DEFAULT_AGE_SPREAD_MONTHS deleted in Age Spread Phase 2 — use
# bunking.solver.constants.MAX_AGE_SPREAD_MONTHS (the single source of truth).

# Context building: maximum age difference (months) used by ContextBuilder when
# selecting peer attendees for AI disambiguation prompts. Was previously read
# from `ai.context_building.max_age_difference_months` via the PB bulk-load
# pattern; now hardcoded since the value has never been tuned and the PB row
# is being deleted in the AI Config Phase 2 cleanup.
CONTEXT_BUILDING_MAX_AGE_DIFFERENCE_MONTHS = 24

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
    # Status thresholds
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
