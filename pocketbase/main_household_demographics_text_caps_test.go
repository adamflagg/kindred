package main

import (
	"os"
	"strings"
	"testing"
)

const householdDemographicsTextCapsMigration = "pb_migrations/1500000163_household_demographics_text_caps.js"

// householdDemographicsWidenedFields is every text column on
// household_demographics that 1500000041 capped below 1000 characters.
//
// The two that forced the change are the date pair. A parent answered
// `HH-Away From (mm/dd/yy)` with a 130-character sentence about plans not
// being settled yet, PocketBase refused the save at max=100, and
// household_demographics reported the WHOLE JOB failed -- one household's
// free text turning a transform-phase job red:
//
//	ERROR Error saving household_demographics record ... error=away_from_date:
//	      Must be no more than 100 character(s).; away_return_date: ...
//	ERROR Phase job failed phase=transform job=household_demographics
//
// The rest are in the list because they are the same KIND of column -- free
// text a parent types into a CampMinder custom field, with no length limit at
// the source -- so each one is the same red job waiting for a longer answer.
// A cap on these was never a data-quality control: nothing downstream reads a
// length, and CampMinder does not enforce one.
var householdDemographicsWidenedFields = []string{
	"jewish_affiliation",
	"jewish_affiliation_other",
	"congregation_summer",
	"congregation_family",
	"jcc_summer",
	"jcc_family",
	"away_location",
	"away_phone",
	"away_from_date",
	"away_return_date",
	"form_filler",
}

func readHouseholdDemographicsTextCapsMigration(t *testing.T) string {
	t.Helper()
	content, err := os.ReadFile(householdDemographicsTextCapsMigration)
	if err != nil {
		t.Fatalf("read migration %s: %v", householdDemographicsTextCapsMigration, err)
	}
	return string(content)
}

// TestHouseholdDemographicsTextCapsNamesEveryShortField guards the list above
// against a migration that widens only the two columns that happened to fail
// in production. Every one of them is fed from the same place.
func TestHouseholdDemographicsTextCapsNamesEveryShortField(t *testing.T) {
	body := readHouseholdDemographicsTextCapsMigration(t)

	for _, field := range householdDemographicsWidenedFields {
		if !strings.Contains(body, `'`+field+`'`) {
			t.Errorf("migration %s must widen %q", householdDemographicsTextCapsMigration, field)
		}
	}
}

// TestHouseholdDemographicsTextCapsWidensToOneThousand pins the target. 1000 is
// the cap `family_description_other` and `parent_immigrant_origin` already
// carry on this same table, so it is the table's own existing answer for "a
// paragraph of free text" rather than a new number.
func TestHouseholdDemographicsTextCapsWidensToOneThousand(t *testing.T) {
	body := readHouseholdDemographicsTextCapsMigration(t)

	if !strings.Contains(body, "1000") {
		t.Errorf("migration %s must set max = 1000", householdDemographicsTextCapsMigration)
	}
}

// TestHouseholdDemographicsTextCapsIsReversibleWithoutTruncating is the guard
// the "no destructive data migrations" rule asks for. The down path has to put
// the old caps back, and it must NOT delete or truncate a row that has since
// used the extra room -- PocketBase applies `max` at record-save time rather
// than at schema-save time, so narrowing the field is safe on its own and any
// attempt to "clean up" first would be the destructive half.
func TestHouseholdDemographicsTextCapsIsReversibleWithoutTruncating(t *testing.T) {
	body := readHouseholdDemographicsTextCapsMigration(t)

	for _, forbidden := range []string{"DELETE FROM", "UPDATE household_demographics", "substr("} {
		if strings.Contains(body, forbidden) {
			t.Errorf("migration %s must not rewrite stored rows (found %q)",
				householdDemographicsTextCapsMigration, forbidden)
		}
	}

	// The original caps have to appear so the down path restores them rather
	// than leaving every column at 1000.
	for _, oldCap := range []string{"100", "200", "300", "400", "500"} {
		if !strings.Contains(body, oldCap) {
			t.Errorf("migration %s down path must restore the original cap %s",
				householdDemographicsTextCapsMigration, oldCap)
		}
	}
}
