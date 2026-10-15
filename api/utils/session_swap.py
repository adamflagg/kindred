"""Session swap detection utility.

A session swap is a cancelled camper who still holds an enrolled record in the
same season: they changed sessions rather than left camp. There is no time
window between the cancellation and the other enrollment (decision 46, #3207):
a family that cancels in February and re-enrols in June is still coming.

Everyone else who cancelled is a true departure, so swaps plus departures split
the cancelled campers exactly as "still enrolled" / "not enrolled" do. The
caller decides the season and the scope by the lists it passes in.
"""

from typing import Any


def detect_session_swaps(
    cancelled_attendees: list[Any],
    enrolled_attendees: list[Any],
) -> set[int]:
    """Person ids of cancelled campers who also hold an enrolled record.

    Args:
        cancelled_attendees: Cancelled/withdrawn/dismissed attendee records.
        enrolled_attendees: Enrolled attendee records in the same season.

    Returns:
        Set of person_ids that are session swaps.
    """
    enrolled_pids = {int(pid) for att in enrolled_attendees if (pid := getattr(att, "person_id", None)) is not None}
    return {
        int(pid)
        for att in cancelled_attendees
        if (pid := getattr(att, "person_id", None)) is not None and int(pid) in enrolled_pids
    }
