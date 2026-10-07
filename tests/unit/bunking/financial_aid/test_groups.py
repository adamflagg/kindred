"""The one group concept (spec §4.1): a group is a budget pool, named by its label, in pool order, with the equity
class most of its open, session-claiming programs use. Fictional: the fixture's pools are Camp, Weekends, B'mitzvah."""

from bunking.financial_aid.rules.groups import Group, group_of_class, group_of_pool, season_groups
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, with_lever, with_levers


def test_groups_follow_the_pools_order_and_labels_with_the_class_most_programs_use() -> None:
    assert season_groups(fictional_rules()) == [
        Group("camp_pool", "Camp", "camp"),  # summer + quest are camp, teen is teen: camp wins 2-1
        Group("weekend_pool", "Weekends", "family"),  # family_camp and family_school have no class
        Group("bmitzvah_pool", "B'mitzvah", "camp"),
    ]


def test_a_tie_goes_to_the_program_listed_first() -> None:
    rules = with_lever(fictional_rules(), "programs.quest.equity_class", "teen")  # camp 1, teen 2 ... make it 1-1:
    rules = with_lever(rules, "programs.teen.open_to_aid", False)  # summer camp, quest teen
    assert season_groups(rules)[0].equity_class == "camp"


def test_a_closed_or_empty_program_has_no_say() -> None:
    rules = with_levers(fictional_rules(), {"programs.summer.open_to_aid": False, "programs.quest.session_cm_ids": []})
    assert season_groups(rules)[0].equity_class == "teen"


def test_a_pool_with_no_classed_program_has_no_class() -> None:
    rules = with_lever(fictional_rules(), "programs.adult_weekend.equity_class", None)
    assert group_of_pool(rules, "weekend_pool") == Group("weekend_pool", "Weekends", None)


def test_a_class_names_the_first_group_that_uses_it() -> None:
    assert group_of_class(fictional_rules(), "camp") == Group("camp_pool", "Camp", "camp")
    assert group_of_class(fictional_rules(), "teen") is None
    assert group_of_pool(fictional_rules(), None) is None


def test_a_program_claiming_sessions_only_by_type_still_has_its_say() -> None:
    """Pin: `claims_sessions` counts a session type as a claim, as validation does."""
    rules = with_levers(
        fictional_rules(),
        {
            "programs.summer.session_cm_ids": [],
            "programs.quest.session_cm_ids": [],
            "programs.quest.session_types": ["x"],
        },
    )
    assert season_groups(rules)[0].equity_class == "camp"  # summer + quest by type outvote teen
