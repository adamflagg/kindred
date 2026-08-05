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

// codeYear keys a unit by its cross-year identity plus the season, which is
// what the composite unique index (code, year) guarantees is unique.
type codeYear struct {
	code string
	year int
}

// AliasResolver resolves raw cabin strings through lodging_unit_aliases,
// honoring each row's year window. Built once per sync run and read many times.
type AliasResolver struct {
	byString     map[string][]aliasRow
	unitCode     map[string]string
	idByCodeYear map[codeYear]string
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
	r.idByCodeYear = make(map[codeYear]string)
	for _, u := range units {
		code := u.GetString("code")
		r.unitCode[u.Id] = code
		r.idByCodeYear[codeYear{code: code, year: u.GetInt("year")}] = u.Id
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
		// An alias stores whichever season's record ids existed when it was
		// written, and it is never re-pointed: `valid_from_year` records what a
		// building was CALLED from a given year, which is a rename history, not
		// a per-year copy. So translate stored id -> code -> the requested
		// year's id. `code` is the cross-year identity thread.
		stored := matches[0].MemberUnitIDs
		ids := make([]string, 0, len(stored))
		codes := make([]string, 0, len(stored))
		for _, id := range stored {
			// ALL OR NOTHING, on both doors. A stored id with no code at all
			// (the unit row is gone) and a code with no row THIS season are the
			// same failure: a member that cannot be carried into the requested
			// year. Skipping either one and returning the members that do exist
			// would silently shrink a family's rooms, which is worse than
			// saying the name does not resolve.
			code := r.unitCode[id]
			if code == "" {
				return out
			}
			target, ok := r.idByCodeYear[codeYear{code: code, year: year}]
			if !ok {
				return out
			}
			ids = append(ids, target)
			codes = append(codes, code)
		}
		out.UnitIDs = ids
		out.UnitCodes = codes
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
