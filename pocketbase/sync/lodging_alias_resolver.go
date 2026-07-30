package sync

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// aliasRow is one lodging_unit_aliases record, flattened.
type aliasRow struct {
	ID            string
	AliasString   string
	MemberUnitIDs []string
	// ValidFromYear / ValidToYear are PocketBase number columns, declared
	// NUMERIC DEFAULT 0 NOT NULL. An unset bound stores as 0, never NULL --
	// 94 of the 100 seeded rows are unbounded on both sides -- so 0 means
	// "no bound" and must never be compared as a real year.
	ValidFromYear int
	ValidToYear   int
}

func (a aliasRow) covers(year int) bool {
	if a.ValidFromYear > 0 && year < a.ValidFromYear {
		return false
	}
	if a.ValidToYear > 0 && year > a.ValidToYear {
		return false
	}
	return true
}

// AliasResolution is the outcome of resolving one raw cabin string for one year.
// Resolved=false with Ambiguous=false means "no alias covers this" -- a work
// queue item, not an error.
type AliasResolution struct {
	Raw       string
	UnitIDs   []string
	UnitCodes []string
	Resolved  bool
	Ambiguous bool
}

// IsMerge reports whether the alias denotes a merge of two or more atomic rooms.
func (r AliasResolution) IsMerge() bool { return len(r.UnitIDs) >= 2 }

// AliasResolver resolves raw cabin strings through lodging_unit_aliases,
// honoring each row's year window. Built once per sync run and read many times.
type AliasResolver struct {
	byString map[string][]aliasRow
	unitCode map[string]string
}

// NewAliasResolver loads the unit and alias tables into memory. Build one per
// sync run: the tables are small (89 units, 100 aliases) and Resolve is called
// once per observed cabin value.
func NewAliasResolver(app core.App) (*AliasResolver, error) {
	r := &AliasResolver{
		byString: make(map[string][]aliasRow),
		unitCode: make(map[string]string),
	}

	units, err := app.FindRecordsByFilter("lodging_units", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("loading lodging_units: %w", err)
	}
	for _, u := range units {
		r.unitCode[u.Id] = u.GetString("code")
	}

	aliases, err := app.FindRecordsByFilter("lodging_unit_aliases", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("loading lodging_unit_aliases: %w", err)
	}
	for _, a := range aliases {
		row := aliasRow{
			ID:            a.Id,
			AliasString:   a.GetString("alias_string"),
			MemberUnitIDs: a.GetStringSlice("member_units"),
			ValidFromYear: a.GetInt("valid_from_year"),
			ValidToYear:   a.GetInt("valid_to_year"),
		}
		key := aliasLookupKey(row.AliasString)
		r.byString[key] = append(r.byString[key], row)
	}
	return r, nil
}

// aliasLookupKey normalises outer whitespace and case only.
//
// Inner spacing stays significant: the seed stores strings verbatim and one of
// them, "Health Center Downstairs  - Room A", genuinely carries a double space.
// Collapsing inner runs would merge it with a single-space variant that means
// the same room today but need not tomorrow.
func aliasLookupKey(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// Resolve maps a raw cabin string onto units for a given year.
func (r *AliasResolver) Resolve(raw string, year int) AliasResolution {
	out := AliasResolution{Raw: raw}

	var matches []aliasRow
	for _, row := range r.byString[aliasLookupKey(raw)] {
		if row.covers(year) {
			matches = append(matches, row)
		}
	}

	switch len(matches) {
	case 0:
		return out
	case 1:
		out.UnitIDs = matches[0].MemberUnitIDs
		out.UnitCodes = make([]string, 0, len(out.UnitIDs))
		for _, id := range out.UnitIDs {
			out.UnitCodes = append(out.UnitCodes, r.unitCode[id])
		}
		out.Resolved = len(out.UnitIDs) > 0
		return out
	default:
		// Two rows whose windows both contain this year. The seed contains no
		// such pair, but the Plan 3 admin UI can create one: the unique index is
		// on (alias_string, valid_from_year), not on alias_string alone. Picking
		// one arbitrarily would place households in a cabin nobody chose.
		out.Ambiguous = true
		return out
	}
}

// UnitCode returns a unit's stable code, or "" if the id is unknown.
func (r *AliasResolver) UnitCode(unitID string) string { return r.unitCode[unitID] }
