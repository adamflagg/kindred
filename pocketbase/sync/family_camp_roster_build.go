package sync

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The roster builder's database half. kindred#2433.
//
// Everything comes from four tables -- attendees, persons, family_camp_adults
// and camp_sessions. No lodging, no scenario, no solver, no placement: the
// roster describes who is coming, not where they sleep.

// A roster can be built only for sessionTypeFamily (sessions.go).
//
// rosterFilterChunk bounds how many ids go into one `a = x || a = y || ...`
// filter. A representative weekend is 63 households and 98 campers, so this
// keeps the whole build to one query per table while staying far short of any
// filter-length limit.
const rosterFilterChunk = 100

// Refusals. Each names a state where producing an artifact would be worse than
// producing an error, so they are sentinels the HTTP layer maps to a status
// rather than free-form strings.
var (
	// ErrRosterSessionNotFound means no camp_sessions row matched (cm_id, year).
	ErrRosterSessionNotFound = errors.New("no session found for that CampMinder id and year")
	// ErrRosterSessionNotFamily guards the adult weekends, which enroll
	// individuals rather than households and have no family_camp_adults rows at
	// all -- a roster built for one would be a camper-only sheet that looks
	// plausible and is wrong.
	ErrRosterSessionNotFamily = errors.New("session is not a Family Camp weekend")
	// ErrRosterNoEnrolledCampers guards the two of 2026's ten family weekends
	// that are later in the season. An empty tab appended to a workbook staff
	// hand-edit is worse than a clear error.
	ErrRosterNoEnrolledCampers = errors.New("session has no enrolled campers")
)

// RosterPerson is one rendered row: a camper or one accompanying adult.
type RosterPerson struct {
	Name  string
	Role  string // "Camper", or "Adult 1", "Adult 2", ...
	Age   string // campers only; adults carry no birthdate on the later slots
	Email string // adults only
}

// HouseholdBlock is one family's contiguous run of rows. The block, not the row,
// is the unit the sheet bands and borders -- that is what makes a family read as
// one unit.
type HouseholdBlock struct {
	HouseholdID string // households PB record id
	City        string
	People      []RosterPerson
	// LinkGroup is 0 for an ordinary household, or a 1-based group number when
	// this household SHARES an adult with another in the same weekend (§5).
	LinkGroup int
	// campers is how many of People are campers. They always lead the block, so
	// this doubles as the index adults start at.
	campers int
}

// Roster is one weekend's whole artifact, ordered and ready to render.
type Roster struct {
	SessionID   string // camp_sessions PB record id
	SessionCMID int
	SessionName string
	Year        int
	Start       time.Time
	End         time.Time
	Blocks      []HouseholdBlock
}

// HouseholdCount returns the number of blocks.
func (r *Roster) HouseholdCount() int { return len(r.Blocks) }

// CamperCount returns the number of enrolled campers across every block.
func (r *Roster) CamperCount() int {
	total := 0
	for _, block := range r.Blocks {
		total += block.campers
	}
	return total
}

// AdultCount returns the number of rendered adults across every block.
func (r *Roster) AdultCount() int { return r.PersonCount() - r.CamperCount() }

// PersonCount returns the number of person rows the sheet will carry.
func (r *Roster) PersonCount() int {
	total := 0
	for _, block := range r.Blocks {
		total += len(block.People)
	}
	return total
}

// BuildFamilyCampRoster assembles one weekend's roster, ordered and rendered but
// not yet written anywhere. It makes no Google calls.
//
// `on` is the instant ages are measured against. It is a parameter rather than
// time.Now() because ages are computed AT EXPORT TIME (design §Age) and a
// hard-coded clock is untestable -- the reference implementation measured ages
// at session start, and only a caller-supplied instant can tell the two apart.
func BuildFamilyCampRoster(app core.App, year, sessionCMID int, on time.Time) (*Roster, error) {
	session, err := findRosterSession(app, year, sessionCMID)
	if err != nil {
		return nil, err
	}

	households, err := loadRosterHouseholds(app, year, session.Id)
	if err != nil {
		return nil, err
	}
	if len(households) == 0 {
		return nil, fmt.Errorf("%w: %s (cm_id %d, year %d)",
			ErrRosterNoEnrolledCampers, session.GetString("name"), sessionCMID, year)
	}

	ordered := make([]rosterHousehold, 0, len(households))
	for _, household := range households {
		ordered = append(ordered, *household)
	}
	// Sorted before either attach so both walk households in one stable order,
	// which is what makes a re-export of unchanged data byte-identical.
	for i := range ordered {
		sortRosterCampers(ordered[i].Campers)
	}
	orderRosterHouseholds(ordered)

	if err := attachRosterCityFallback(app, ordered); err != nil {
		return nil, err
	}
	if err := attachRosterAdults(app, year, ordered); err != nil {
		return nil, err
	}

	return &Roster{
		SessionID:   session.Id,
		SessionCMID: sessionCMID,
		SessionName: session.GetString("name"),
		Year:        year,
		// start_date and end_date are PocketBase DATE fields stored as
		// "2026-08-20 07:00:00.000Z", a layout date_utils.go's parser does not
		// carry, so GetDateTime is the only correct read.
		Start:  session.GetDateTime("start_date").Time(),
		End:    session.GetDateTime("end_date").Time(),
		Blocks: buildRosterBlocks(ordered, on),
	}, nil
}

// buildRosterBlocks renders the ordered households into sheet rows and paints
// the linked-household groups on.
func buildRosterBlocks(households []rosterHousehold, on time.Time) []HouseholdBlock {
	order := make([]string, 0, len(households))
	adultNames := make(map[string][]string, len(households))
	for _, household := range households {
		order = append(order, household.ID)
		names := make([]string, 0, len(household.Adults))
		for _, adult := range household.Adults {
			names = append(names, adult.Name)
		}
		adultNames[household.ID] = names
	}
	linked := linkedHouseholdGroups(order, adultNames)

	blocks := make([]HouseholdBlock, 0, len(households))
	for _, household := range households {
		people := make([]RosterPerson, 0, len(household.Campers)+len(household.Adults))
		for _, camper := range household.Campers {
			people = append(people, RosterPerson{
				Name: camper.Name,
				Role: "Camper",
				Age:  rosterAgeLabel(camper.Birthdate, on),
			})
		}
		for _, adult := range household.Adults {
			people = append(people, RosterPerson{
				Name:  adult.Name,
				Role:  fmt.Sprintf("Adult %d", adult.Number),
				Email: adult.Email,
			})
		}
		blocks = append(blocks, HouseholdBlock{
			HouseholdID: household.ID,
			City:        household.City,
			People:      people,
			LinkGroup:   linked[household.ID],
			campers:     len(household.Campers),
		})
	}
	return blocks
}

// findRosterSession resolves (cm_id, year) to a camp_sessions record and refuses
// anything that is not a Family Camp weekend.
func findRosterSession(app core.App, year, sessionCMID int) (*core.Record, error) {
	// Spaces around every operator: PocketBase's filter parser silently returns
	// wrong results without them.
	filter := fmt.Sprintf("cm_id = %d && year = %d", sessionCMID, year)
	records, err := app.FindRecordsByFilter("camp_sessions", filter, "", 1, 0)
	if err != nil {
		return nil, fmt.Errorf("finding session %d for %d: %w", sessionCMID, year, err)
	}
	if len(records) == 0 {
		return nil, fmt.Errorf("%w: cm_id %d, year %d", ErrRosterSessionNotFound, sessionCMID, year)
	}

	session := records[0]
	if sessionType := session.GetString("session_type"); sessionType != sessionTypeFamily {
		return nil, fmt.Errorf("%w: %q is a %q session",
			ErrRosterSessionNotFamily, session.GetString("name"), sessionType)
	}
	return session, nil
}

// loadRosterHouseholds groups this weekend's actively-enrolled campers by
// household, keyed on the household RECORD id -- what persons and
// family_camp_adults both carry.
func loadRosterHouseholds(app core.App, year int, sessionID string) (map[string]*rosterHousehold, error) {
	filter := fmt.Sprintf("year = %d && status_id = %d && session = {:session}", year, statusIDActiveEnrolled)
	attendees, err := findAllRecords(app, "attendees", filter, dbx.Params{"session": sessionID})
	if err != nil {
		return nil, err
	}

	personIDs := make([]string, 0, len(attendees))
	for _, attendee := range attendees {
		if personID := attendee.GetString("person"); personID != "" {
			personIDs = append(personIDs, personID)
		}
	}

	persons, err := findRosterRecordsByID(app, "persons", personIDs)
	if err != nil {
		return nil, err
	}

	households := make(map[string]*rosterHousehold)
	for _, person := range persons {
		householdID := person.GetString("household")
		if householdID == "" {
			// A camper with no household cannot be grouped into a block, and a
			// block of one orphan would read as a family. Sync repairs the link.
			continue
		}
		household, ok := households[householdID]
		if !ok {
			household = &rosterHousehold{ID: householdID}
			households[householdID] = household
		}
		household.Campers = append(household.Campers, rosterCamper{
			Name: rosterCamperName(
				person.GetString("preferred_name"),
				person.GetString("first_name"),
				person.GetString("last_name"),
			),
			Last:      strings.TrimSpace(person.GetString("last_name")),
			Birthdate: strings.TrimSpace(person.GetString("birthdate")),
		})
		if household.City == "" {
			household.City = rosterCleanCity(
				person.GetString("normalized_city"), person.GetString("address_city"))
		}
	}
	return households, nil
}

// attachRosterCityFallback fills the city for households where no enrolled
// camper carries one, from any other member of the same household (design §3).
//
// Scoped to the household, never widened: a wrong city on a family's block is
// worse than a blank one. Households that already have a city are not queried.
func attachRosterCityFallback(app core.App, households []rosterHousehold) error {
	missing := make([]string, 0)
	for _, household := range households {
		if household.City == "" {
			missing = append(missing, household.ID)
		}
	}
	if len(missing) == 0 {
		return nil
	}

	found := make(map[string]string, len(missing))
	err := forEachRosterIDChunk(missing, func(filter string, params dbx.Params) error {
		records, chunkErr := findAllRecords(app, "persons", filter, params)
		if chunkErr != nil {
			return chunkErr
		}
		// findAllRecords sorts by id, so the first non-empty city for a
		// household is a stable choice rather than whatever the page returned.
		for _, person := range records {
			householdID := person.GetString("household")
			if found[householdID] != "" {
				continue
			}
			if city := rosterCleanCity(
				person.GetString("normalized_city"), person.GetString("address_city"),
			); city != "" {
				found[householdID] = city
			}
		}
		return nil
	}, "household")
	if err != nil {
		return fmt.Errorf("loading household cities: %w", err)
	}

	for i := range households {
		if households[i].City == "" {
			households[i].City = found[households[i].ID]
		}
	}
	return nil
}

// attachRosterAdults loads each household's accompanying adults for the year.
//
// Adults are not enrolled -- they are scraped from the registration form into
// family_camp_adults, which is keyed (household, year, adult_number). The year
// filter is what keeps last season's adults off this season's roster.
func attachRosterAdults(app core.App, year int, households []rosterHousehold) error {
	ids := make([]string, 0, len(households))
	for _, household := range households {
		ids = append(ids, household.ID)
	}

	byHousehold := make(map[string][]rosterAdult, len(ids))
	err := forEachRosterIDChunk(ids, func(filter string, params dbx.Params) error {
		records, chunkErr := findAllRecords(app,
			"family_camp_adults", fmt.Sprintf("year = %d && (%s)", year, filter), params)
		if chunkErr != nil {
			return chunkErr
		}
		for _, record := range records {
			name := rosterAdultName(
				record.GetString("name"),
				record.GetString("first_name"),
				record.GetString("last_name"),
			)
			// Placeholders ("N/A", "none", "-") mean "there is no second adult".
			// Duplicates are NOT filtered: the same person in two slots is
			// kindred#2483, and deduping here would hide it behind a clean sheet.
			if !isRosterAdultName(name) {
				continue
			}
			householdID := record.GetString("household")
			byHousehold[householdID] = append(byHousehold[householdID], rosterAdult{
				Number: record.GetInt("adult_number"),
				Name:   name,
				Email:  strings.TrimSpace(record.GetString("email")),
			})
		}
		return nil
	}, "household")
	if err != nil {
		return fmt.Errorf("loading family camp adults for %d: %w", year, err)
	}

	for i := range households {
		adults := byHousehold[households[i].ID]
		// Sorted in Go rather than by the query: chunking means the concatenated
		// pages are not globally ordered, and two adults can share a number only
		// across households, so (number, name) is a total order within one.
		slices.SortFunc(adults, func(a, b rosterAdult) int {
			if a.Number != b.Number {
				return a.Number - b.Number
			}
			return strings.Compare(a.Name, b.Name)
		})
		households[i].Adults = adults
	}
	return nil
}

// findRosterRecordsByID fetches records by PB record id, chunked, and returns
// them sorted by id across every chunk. The global sort is what makes
// "the first camper carrying a city" a stable choice.
func findRosterRecordsByID(app core.App, collection string, ids []string) ([]*core.Record, error) {
	unique := slices.Clone(ids)
	slices.Sort(unique)
	unique = slices.Compact(unique)

	all := make([]*core.Record, 0, len(unique))
	err := forEachRosterIDChunk(unique, func(filter string, params dbx.Params) error {
		records, chunkErr := findAllRecords(app, collection, filter, params)
		if chunkErr != nil {
			return chunkErr
		}
		all = append(all, records...)
		return nil
	}, "id")
	if err != nil {
		return nil, fmt.Errorf("loading %s by id: %w", collection, err)
	}
	return all, nil
}

// forEachRosterIDChunk calls fn with an `field = {:p0} || field = {:p1} ...`
// filter for each chunk of ids, so a whole weekend costs one query per table
// rather than one per household. Ids are bound as parameters rather than
// interpolated.
func forEachRosterIDChunk(ids []string, fn func(filter string, params dbx.Params) error, field string) error {
	for start := 0; start < len(ids); start += rosterFilterChunk {
		chunk := ids[start:min(start+rosterFilterChunk, len(ids))]

		clauses := make([]string, 0, len(chunk))
		params := make(dbx.Params, len(chunk))
		for i, id := range chunk {
			key := fmt.Sprintf("p%d", i)
			// Spaces around the operator: PocketBase's filter parser silently
			// returns wrong results without them.
			clauses = append(clauses, fmt.Sprintf("%s = {:%s}", field, key))
			params[key] = id
		}

		if err := fn(strings.Join(clauses, " || "), params); err != nil {
			return err
		}
	}
	return nil
}
