package sync

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// serviceNameFinancialAidApplications is the canonical name for this sync service
const serviceNameFinancialAidApplications = "financial_aid_applications"

// FA field name constants to avoid magic strings (goconst)
const (
	faFieldCAFinancialAssistanceInterest = "CA-FinancialAssistanceInterest"
	faFieldCAFinancialAssistanceAmount   = "CA-FinancialAssistanceAmount"
	faFieldCADonationAmount              = "CA-Donation amount"
	faFieldCADonationOther               = "CA-Donation other"
	faFieldSummerQuestAmtRequested       = "Summer/Quest: Amt Requested"
	faFieldFamilyCampAmtRequested        = "Family Camp: Amt Requested"
	faFieldBnaiMitzvahAmtRequested       = "B'nai Mitzvah: Amt Requested"
	// WW- fields are the adult weekends' equivalent of the CA- interest
	// indicators above -- same four-question shape (interest / amount
	// awarded / donation amount / donation other), routed to the same four
	// program-neutral columns. See kindred#2436.
	faFieldWWFinancialAssistanceInterest = "WW-FA"
	faFieldWWFinancialAssistanceAmount   = "WW-FA Amount"
	faFieldWWDonationAmount              = "WW-Donation Amount"
	faFieldWWDonationOther               = "WW-Donation Amount Other"
	// Boolean string parsing constants (shared with other sync files)
	boolYes = "yes"
)

// FinancialAidApplicationsSync computes derived financial aid applications from custom values.
// This service reads from person_custom_values (FA- and CA- prefixed fields)
// and populates the financial_aid_applications table.
//
// Unlike CampMinder API syncs, this doesn't call external APIs - it computes
// derived/aggregated data from existing PocketBase records.
type FinancialAidApplicationsSync struct {
	App            core.App
	Year           int  // Year to compute for (0 = current year from env)
	DryRun         bool // Dry run mode (compute but don't write)
	Debug          bool // Enable verbose debug logging
	Stats          Stats
	SyncSuccessful bool
}

// NewFinancialAidApplicationsSync creates a new financial aid applications sync service
func NewFinancialAidApplicationsSync(app core.App) *FinancialAidApplicationsSync {
	return &FinancialAidApplicationsSync{
		App:    app,
		Year:   0,
		DryRun: false,
	}
}

// Name returns the service name
func (s *FinancialAidApplicationsSync) Name() string {
	return serviceNameFinancialAidApplications
}

// GetStats returns the current stats
func (s *FinancialAidApplicationsSync) GetStats() Stats {
	return s.Stats
}

// SetDebug enables or disables debug logging
func (s *FinancialAidApplicationsSync) SetDebug(debug bool) {
	s.Debug = debug
}

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2334) so a
// unified sync run with dry_run=true reaches the DryRun field that this service's
// Sync() already checks before it writes.
func (s *FinancialAidApplicationsSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
}

// SetYear sets the year for this sync service
func (s *FinancialAidApplicationsSync) SetYear(year int) {
	s.Year = year
}

// DebugLog logs a message at INFO level only when Debug is enabled
func (s *FinancialAidApplicationsSync) DebugLog(msg string, args ...any) {
	if s.Debug {
		slog.Info(msg, args...)
	}
}

// faApplicationData holds extracted financial aid application information
type faApplicationData struct {
	personPBID    string
	householdPBID string
	personCMID    int

	// Interest indicators
	interestExpressed  bool
	donationPreference string
	donationOther      string
	amountAwarded      float64

	// Contact Parent 1
	contactFirstName     string
	contactLastName      string
	contactEmail         string
	contactPhone         string
	contactAddress       string
	contactCity          string
	contactState         string
	contactZip           string
	contactCountry       string
	contactMaritalStatus string
	contactJewish        string

	// Parent 2
	parent2Name          string
	parent2MaritalStatus string
	parent2Jewish        string

	// Financial - Income
	totalGrossIncome    float64
	expectedGrossIncome float64
	totalAdjustedIncome float64
	totalExemptions     float64
	unemployment        bool
	stillUnemployed     bool

	// Financial - Assets
	nonRetirementSavings float64
	retirementAccounts   float64
	studentDebt          float64
	ownsHome             bool

	// Financial - Expenses
	totalMedicalExpenses float64
	totalEduExpenses     float64
	totalHousingExpenses float64
	totalRent            float64

	// Family Info
	numChildren          int
	singleParent         bool
	camperName           string
	specialCircumstances string

	// Jewish Affiliations
	affiliatedJCC            bool
	childAffiliatedSynagogue string
	childrenJewishDaySchool  string
	russianSpeaking          bool

	// Government/External Aid
	govSubsidies             bool
	govSubsidiesDetail       string
	synagogueGrant           string
	oneHappyCamper           string
	otherFinancialSupport    string
	otherSupportAmount       float64
	otherSupportExpectations string
	financialSupport         string

	// Program Requests
	summerProgram         string
	summerAmountRequested float64
	fcProgram             string
	fcAmountRequested     float64
	tbmProgram            string
	tbmAmountRequested    float64
	numPrograms           int
	numSessions           int
	amountRequested       float64

	// COVID/Disaster
	covidChildcare          bool
	covidChildcareAmount    float64
	covidExpenses           string
	covidExpensesAdditional string
	covidExpensesAmount     float64
	fire                    string
	fireAffected            bool
	fireDetail              string

	// Admin/Status
	depositPaid        float64
	depositPaidAdult   float64
	applicantSignature string
	incomeConfirmed    bool
	amountConfirmed    bool
}

// Sync executes the financial aid applications computation
func (s *FinancialAidApplicationsSync) Sync(ctx context.Context) error {
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Determine year
	year := s.Year
	if year == 0 {
		var err error
		year, err = ParseSeasonYear()
		if err != nil {
			return fmt.Errorf("year resolution failed: %w", err)
		}
	}

	// Validate year
	if year < 2017 || year > 2050 {
		return fmt.Errorf("invalid year %d: must be between 2017 and 2050", year)
	}

	slog.Info("Starting financial aid applications computation",
		"year", year,
		"dry_run", s.DryRun,
	)

	// Step 1: Build field name mapping (field_definition PB ID -> field name)
	fieldNameMap, err := s.loadFieldDefinitions(ctx)
	if err != nil {
		return fmt.Errorf("loading field definitions: %w", err)
	}
	slog.Info("Loaded field definitions", "count", len(fieldNameMap))

	// Step 2: Load person info (person PB ID -> person data including household)
	personInfo, err := s.loadPersonInfo(ctx, year)
	if err != nil {
		return fmt.Errorf("loading person info: %w", err)
	}
	slog.Info("Loaded person info", "count", len(personInfo))

	// Step 3: Load person custom values
	personValues, err := s.loadPersonCustomValues(ctx, year, fieldNameMap)
	if err != nil {
		return fmt.Errorf("loading person custom values: %w", err)
	}
	slog.Info("Loaded person custom values", "count", len(personValues))

	// Step 4: Process applications
	applications := s.processApplications(personValues, personInfo)
	slog.Info("Processed applications", "count", len(applications))

	if s.DryRun {
		slog.Info("Dry run mode - computed but not writing",
			"applications", len(applications),
		)
		s.Stats.Created = len(applications)
		s.SyncSuccessful = true
		return nil
	}

	// Step 5: Upsert applications (compare with existing, create/update/skip)
	created, updated, errors := s.upsertApplications(ctx, applications, year)
	s.Stats.Created = created
	s.Stats.Updated = updated
	s.Stats.Errors = errors

	// WAL checkpoint
	if s.Stats.Created > 0 || s.Stats.Updated > 0 {
		if err := s.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
	}

	s.SyncSuccessful = true
	slog.Info("Financial aid applications computation completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"errors", s.Stats.Errors,
	)

	return nil
}

// loadFieldDefinitions builds a map of field_definition PB ID -> field name
func (s *FinancialAidApplicationsSync) loadFieldDefinitions(_ context.Context) (map[string]string, error) {
	result := make(map[string]string)

	// Query all field definitions
	records, err := s.App.FindRecordsByFilter("custom_field_defs", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying field definitions: %w", err)
	}

	for _, record := range records {
		name := normalizeFieldName(record.GetString("name"))
		if isFAFieldName(name) {
			result[record.Id] = name
		}
	}

	return result, nil
}

// isFAFieldName checks if a field name is related to financial aid
func isFAFieldName(name string) bool {
	// FA- prefix (standard financial aid fields)
	if len(name) >= 3 && (name[:3] == "FA-" || name[:3] == "Fa-") {
		return true
	}

	// CA- prefix for financial assistance interest/amount only
	if len(name) >= 3 && name[:3] == "CA-" {
		if name == faFieldCAFinancialAssistanceInterest ||
			name == faFieldCAFinancialAssistanceAmount ||
			name == faFieldCADonationAmount ||
			name == faFieldCADonationOther {
			return true
		}
		return false
	}

	// WW- prefix: the adult weekends' equivalent of the CA- interest
	// indicators, same fixed allowlist shape (kindred#2436).
	if len(name) >= 3 && name[:3] == "WW-" {
		if name == faFieldWWFinancialAssistanceInterest ||
			name == faFieldWWFinancialAssistanceAmount ||
			name == faFieldWWDonationAmount ||
			name == faFieldWWDonationOther {
			return true
		}
		return false
	}

	// Special amount requested fields without FA- prefix
	if name == faFieldSummerQuestAmtRequested ||
		name == faFieldFamilyCampAmtRequested ||
		name == faFieldBnaiMitzvahAmtRequested {
		return true
	}

	return false
}

// personInfoEntry holds loaded person information
type personInfoEntry struct {
	pbID        string
	cmID        int
	householdID string
}

// loadPersonInfo loads person info for the year
func (s *FinancialAidApplicationsSync) loadPersonInfo(
	ctx context.Context, year int,
) (map[string]*personInfoEntry, error) {
	result := make(map[string]*personInfoEntry)

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("persons", filter, sortByID, perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying persons page %d: %w", page, err)
		}

		for _, record := range records {
			result[record.Id] = &personInfoEntry{
				pbID:        record.Id,
				cmID:        record.GetInt("cm_id"),
				householdID: record.GetString("household"),
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// faCustomValueEntry represents a loaded FA custom value
type faCustomValueEntry struct {
	personPBID string
	fieldName  string
	value      string
}

// loadPersonCustomValues loads person custom values for FA fields
func (s *FinancialAidApplicationsSync) loadPersonCustomValues(
	ctx context.Context, year int, fieldNameMap map[string]string,
) ([]faCustomValueEntry, error) {
	var result []faCustomValueEntry

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("person_custom_values", filter, sortByID, perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying person custom values page %d: %w", page, err)
		}

		for _, record := range records {
			fieldDefID := record.GetString("field_definition")
			fieldName, ok := fieldNameMap[fieldDefID]
			if !ok {
				continue // Not an FA field
			}

			personID := record.GetString("person")
			value := record.GetString("value")

			if personID != "" && value != "" {
				result = append(result, faCustomValueEntry{
					personPBID: personID,
					fieldName:  fieldName,
					value:      value,
				})
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// processApplications extracts application data from custom values
func (s *FinancialAidApplicationsSync) processApplications(
	values []faCustomValueEntry, personInfo map[string]*personInfoEntry,
) []*faApplicationData {
	// Map: person PB ID -> application data
	appMap := make(map[string]*faApplicationData)

	for _, v := range values {
		info := personInfo[v.personPBID]
		if info == nil {
			continue // Person not found (shouldn't happen)
		}

		if appMap[v.personPBID] == nil {
			appMap[v.personPBID] = &faApplicationData{
				personPBID:    v.personPBID,
				householdPBID: info.householdID,
				personCMID:    info.cmID,
			}
		}

		app := appMap[v.personPBID]
		s.mapFieldToApplication(app, v.fieldName, v.value)
	}

	// Convert map to slice (preallocate for efficiency)
	result := make([]*faApplicationData, 0, len(appMap))
	for _, app := range appMap {
		result = append(result, app)
	}

	return result
}

// mapFieldToApplication maps a field value to the application data structure
func (s *FinancialAidApplicationsSync) mapFieldToApplication(app *faApplicationData, fieldName, value string) {
	// Only set if not already set (first non-empty wins for deduplication)
	switch fieldName {
	// Interest indicators (CA- prefix)
	case faFieldCAFinancialAssistanceInterest:
		if !app.interestExpressed {
			app.interestExpressed = hasInterestExpressed(value)
		}
	case faFieldCAFinancialAssistanceAmount:
		if app.amountAwarded == 0 {
			app.amountAwarded = parseNumberValue(value)
		}
	case faFieldCADonationAmount:
		if app.donationPreference == "" {
			app.donationPreference = value
		}
	case faFieldCADonationOther:
		if app.donationOther == "" {
			app.donationOther = value
		}

	// Interest indicators (WW- prefix, adult weekends -- kindred#2436). Same
	// four program-neutral columns as the CA- arms above: a WW- answer only
	// ever lands on the row for the adult who filled out that form, so this
	// is admission into an existing column, not a grain change.
	case faFieldWWFinancialAssistanceInterest:
		if !app.interestExpressed {
			app.interestExpressed = hasInterestExpressed(value)
		}
	case faFieldWWFinancialAssistanceAmount:
		if app.amountAwarded == 0 {
			app.amountAwarded = parseNumberValue(value)
		}
	case faFieldWWDonationAmount:
		if app.donationPreference == "" {
			app.donationPreference = value
		}
	case faFieldWWDonationOther:
		if app.donationOther == "" {
			app.donationOther = value
		}

	// Contact Parent 1
	case "FA-Contact Parent Name":
		if app.contactFirstName == "" {
			app.contactFirstName = value
		}
	case "Fa-Contact Parent Last Name":
		if app.contactLastName == "" {
			app.contactLastName = value
		}
	case "FA-Contact Parent Email":
		if app.contactEmail == "" {
			app.contactEmail = value
		}
	case "FA-Contact Parent Phone":
		if app.contactPhone == "" {
			app.contactPhone = value
		}
	case "FA-Contact Parent Address":
		if app.contactAddress == "" {
			app.contactAddress = value
		}
	case "FA-Contact parent city":
		if app.contactCity == "" {
			app.contactCity = value
		}
	case "FA-Contact Parent State":
		if app.contactState == "" {
			app.contactState = value
		}
	case "FA-Contact Parent Zip":
		if app.contactZip == "" {
			app.contactZip = value
		}
	case "FA-Contact Parent Country":
		if app.contactCountry == "" {
			app.contactCountry = value
		}
	case "FA-Contact Parent Marital Stat":
		if app.contactMaritalStatus == "" {
			app.contactMaritalStatus = value
		}
	case "FA-Contact Parent Jewish":
		if app.contactJewish == "" {
			app.contactJewish = value
		}

	// Parent 2
	case "FA-Parent 2 Name":
		if app.parent2Name == "" {
			app.parent2Name = value
		}
	case "FA-Parent 2 Marital Status":
		if app.parent2MaritalStatus == "" {
			app.parent2MaritalStatus = value
		}
	case "FA-Parent 2 Jewish":
		if app.parent2Jewish == "" {
			app.parent2Jewish = value
		}

	// Financial - Income
	case "FA-Total Gross Pre-Tax Income":
		if app.totalGrossIncome == 0 {
			app.totalGrossIncome = parseNumberValue(value)
		}
	case "FA-Expected Gross Pre-Tax Inco":
		if app.expectedGrossIncome == 0 {
			app.expectedGrossIncome = parseNumberValue(value)
		}
	case "FA-Total Adjusted Gross Income":
		if app.totalAdjustedIncome == 0 {
			app.totalAdjustedIncome = parseNumberValue(value)
		}
	case "FA-Total Exemptions":
		if app.totalExemptions == 0 {
			app.totalExemptions = parseNumberValue(value)
		}
	case "FA-Unemployment":
		if !app.unemployment {
			app.unemployment = parseBoolValue(value)
		}
	case "FA-still unemployed":
		if !app.stillUnemployed {
			app.stillUnemployed = parseBoolValue(value)
		}

	// Financial - Assets
	case "FA-Non-retirement savings":
		if app.nonRetirementSavings == 0 {
			app.nonRetirementSavings = parseNumberValue(value)
		}
	case "FA-Amt in retirement accounts":
		if app.retirementAccounts == 0 {
			app.retirementAccounts = parseNumberValue(value)
		}
	case "FA-StudentDebt":
		if app.studentDebt == 0 {
			app.studentDebt = parseNumberValue(value)
		}
	case "FA-Do parents own a home?":
		if !app.ownsHome {
			app.ownsHome = parseBoolValue(value)
		}

	// Financial - Expenses
	case "FA-TotaExpectedMedicalExpenses":
		if app.totalMedicalExpenses == 0 {
			app.totalMedicalExpenses = parseNumberValue(value)
		}
	case "FA-Total Expected Edu Expenses":
		if app.totalEduExpenses == 0 {
			app.totalEduExpenses = parseNumberValue(value)
		}
	case "FA-Total Mortgage/RentExpenses":
		if app.totalHousingExpenses == 0 {
			app.totalHousingExpenses = parseNumberValue(value)
		}
	case "FA-Total Rent":
		if app.totalRent == 0 {
			app.totalRent = parseNumberValue(value)
		}

	// Family Info
	case "FA-Number of Children in Fam":
		if app.numChildren == 0 {
			app.numChildren = int(parseNumberValue(value))
		}
	case "FA-Single Parent":
		if !app.singleParent {
			app.singleParent = parseBoolValue(value)
		}
	case "FA-Camper Name":
		if app.camperName == "" {
			app.camperName = value
		}
	case "FA-Special Financial Circumsta":
		if app.specialCircumstances == "" {
			app.specialCircumstances = value
		}

	// Jewish Affiliations
	case "FA-Affiliated with JCC":
		if !app.affiliatedJCC {
			app.affiliatedJCC = parseBoolValue(value)
		}
	case "FA-Child Affiliated Synagogue":
		if app.childAffiliatedSynagogue == "" {
			app.childAffiliatedSynagogue = value
		}
	case "FA-Children Jewish Day School":
		if app.childrenJewishDaySchool == "" {
			app.childrenJewishDaySchool = value
		}
	case "FA-Russian":
		if !app.russianSpeaking {
			app.russianSpeaking = parseBoolValue(value)
		}

	// Government/External Aid
	case "FA-Gov Subsidies":
		if !app.govSubsidies {
			app.govSubsidies = parseBoolValue(value)
		}
	case "FA-Gov Subsidies Detail":
		if app.govSubsidiesDetail == "" {
			app.govSubsidiesDetail = value
		}
	case "FA-SynagogueGrant":
		if app.synagogueGrant == "" {
			app.synagogueGrant = value
		}
	case "FA-OneHappy Camper":
		if app.oneHappyCamper == "" {
			app.oneHappyCamper = value
		}
	case "FA-Other financial support":
		if app.otherFinancialSupport == "" {
			app.otherFinancialSupport = value
		}
	case "FA-Other Support Amount":
		if app.otherSupportAmount == 0 {
			app.otherSupportAmount = parseNumberValue(value)
		}
	case "FA-Other Support Expectations":
		if app.otherSupportExpectations == "" {
			app.otherSupportExpectations = value
		}
	case "FA-Financial Support":
		if app.financialSupport == "" {
			app.financialSupport = value
		}

	// Program Requests
	case "FA-What Program":
		if app.summerProgram == "" {
			app.summerProgram = value
		}
	case faFieldSummerQuestAmtRequested:
		if app.summerAmountRequested == 0 {
			app.summerAmountRequested = parseNumberValue(value)
		}
	case "FA-What Family Camp Program":
		if app.fcProgram == "" {
			app.fcProgram = value
		}
	case faFieldFamilyCampAmtRequested:
		if app.fcAmountRequested == 0 {
			app.fcAmountRequested = parseNumberValue(value)
		}
	case "FA-What Bar and Bat Mitzvah":
		if app.tbmProgram == "" {
			app.tbmProgram = value
		}
	case faFieldBnaiMitzvahAmtRequested:
		if app.tbmAmountRequested == 0 {
			app.tbmAmountRequested = parseNumberValue(value)
		}
	case "FA-Number of Programs":
		if app.numPrograms == 0 {
			app.numPrograms = int(parseNumberValue(value))
		}
	case "FA-How many sessions":
		if app.numSessions == 0 {
			app.numSessions = int(parseNumberValue(value))
		}
	case "FA-Amt of Assistance Requested":
		if app.amountRequested == 0 {
			app.amountRequested = parseNumberValue(value)
		}

	// COVID/Disaster
	case "FA-COVIDchild care":
		if !app.covidChildcare {
			app.covidChildcare = parseBoolValue(value)
		}
	case "FA-COVIDchidcare amount":
		if app.covidChildcareAmount == 0 {
			app.covidChildcareAmount = parseNumberValue(value)
		}
	case "FA-COVIDexpenses":
		if app.covidExpenses == "" {
			app.covidExpenses = value
		}
	case "FA-COVIDexpenses additional":
		if app.covidExpensesAdditional == "" {
			app.covidExpensesAdditional = value
		}
	case "FA-COVIDexpenses amount":
		if app.covidExpensesAmount == 0 {
			app.covidExpensesAmount = parseNumberValue(value)
		}
	case "FA-Fire":
		if app.fire == "" {
			app.fire = value
		}
	case "FA-FireYes/No":
		if !app.fireAffected {
			app.fireAffected = parseBoolValue(value)
		}
	case "FA-Fire Detail":
		if app.fireDetail == "" {
			app.fireDetail = value
		}

	// Admin/Status
	case "FA-Deposit":
		if app.depositPaid == 0 {
			app.depositPaid = parseNumberValue(value)
		}
	case "FA-Applicant Signature":
		if app.applicantSignature == "" {
			app.applicantSignature = value
		}
	case "FA-confirmpretax income":
		if !app.incomeConfirmed {
			app.incomeConfirmed = parseBoolValue(value)
		}
	case "FA-ComfirmationRequestedAmount":
		if !app.amountConfirmed {
			app.amountConfirmed = parseBoolValue(value)
		}
	}
}

// hasInterestExpressed checks if the value indicates interest was expressed
func hasInterestExpressed(value string) bool {
	if value == "" {
		return false
	}
	lower := strings.ToLower(strings.TrimSpace(value))
	return lower != "no" && lower != "n" && lower != "0" && lower != boolFalseStr
}

// parseBoolValue parses boolean values from custom field strings
func parseBoolValue(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return lower == boolYes || lower == "y" || lower == boolTrueStr || lower == "1"
}

// parseNumberValue parses numeric values from text fields (handles currency formatting)
func parseNumberValue(value string) float64 {
	if value == "" {
		return 0
	}

	// Trim whitespace
	clean := strings.TrimSpace(value)

	// Remove $ and , characters
	clean = strings.ReplaceAll(clean, "$", "")
	clean = strings.ReplaceAll(clean, ",", "")

	// Parse as float
	num, err := strconv.ParseFloat(clean, 64)
	if err != nil {
		return 0
	}
	return num
}

// upsertApplications creates or updates application records
func (s *FinancialAidApplicationsSync) upsertApplications(
	ctx context.Context, applications []*faApplicationData, year int,
) (created, updated, errors int) {
	col, err := s.App.FindCollectionByNameOrId("financial_aid_applications")
	if err != nil {
		slog.Error("Error finding financial_aid_applications collection", "error", err)
		return 0, 0, len(applications)
	}

	// Preload existing records for this year
	existingMap, err := s.loadExistingApplications(ctx, year)
	if err != nil {
		slog.Error("Error loading existing applications", "error", err)
		return 0, 0, len(applications)
	}
	slog.Info("Loaded existing applications", "count", len(existingMap))

	// Fields to skip during idempotency comparison (always update these)
	skipFields := map[string]bool{"year": true}

	for _, app := range applications {
		select {
		case <-ctx.Done():
			return created, updated, errors
		default:
		}

		// Convert application data to map
		recordData := app.toRecordData(year)

		// Check if record exists (keyed by person PB ID)
		existingRecord := existingMap[app.personPBID]

		if existingRecord != nil {
			// Convert existing record to map for comparison
			existingData := s.recordToMap(existingRecord)

			// Check if update is needed
			if s.recordNeedsUpdate(existingData, recordData, skipFields) {
				// Update existing record
				for field, value := range recordData {
					existingRecord.Set(field, value)
				}
				if err := s.App.Save(existingRecord); err != nil {
					slog.Error("Error updating application record",
						"person", app.personPBID,
						"error", err,
					)
					errors++
					continue
				}
				updated++
			} else {
				s.Stats.Skipped++
			}
		} else {
			// Create new record
			record := core.NewRecord(col)
			for field, value := range recordData {
				record.Set(field, value)
			}
			if err := s.App.Save(record); err != nil {
				slog.Error("Error creating application record",
					"person", app.personPBID,
					"error", err,
				)
				errors++
				continue
			}
			created++
		}
	}

	return created, updated, errors
}

// recordToMap converts a PocketBase record to a map for comparison
func (s *FinancialAidApplicationsSync) recordToMap(record *core.Record) map[string]any {
	return map[string]any{
		// Core identifiers
		"person":    record.GetString("person"),
		"household": record.GetString("household"),
		"person_id": record.Get("person_id"),
		"year":      record.Get("year"),

		// Interest indicators
		"interest_expressed":  record.GetBool("interest_expressed"),
		"donation_preference": record.GetString("donation_preference"),
		"donation_other":      record.GetString("donation_other"),
		"amount_awarded":      record.Get("amount_awarded"),

		// Contact Parent 1
		"contact_first_name":     record.GetString("contact_first_name"),
		"contact_last_name":      record.GetString("contact_last_name"),
		"contact_email":          record.GetString("contact_email"),
		"contact_phone":          record.GetString("contact_phone"),
		"contact_address":        record.GetString("contact_address"),
		"contact_city":           record.GetString("contact_city"),
		"contact_state":          record.GetString("contact_state"),
		"contact_zip":            record.GetString("contact_zip"),
		"contact_country":        record.GetString("contact_country"),
		"contact_marital_status": record.GetString("contact_marital_status"),
		"contact_jewish":         record.GetString("contact_jewish"),

		// Parent 2
		"parent_2_name":           record.GetString("parent_2_name"),
		"parent_2_marital_status": record.GetString("parent_2_marital_status"),
		"parent_2_jewish":         record.GetString("parent_2_jewish"),

		// Financial - Income
		"total_gross_income":    record.Get("total_gross_income"),
		"expected_gross_income": record.Get("expected_gross_income"),
		"total_adjusted_income": record.Get("total_adjusted_income"),
		"total_exemptions":      record.Get("total_exemptions"),
		"unemployment":          record.GetBool("unemployment"),
		"still_unemployed":      record.GetBool("still_unemployed"),

		// Financial - Assets
		"non_retirement_savings": record.Get("non_retirement_savings"),
		"retirement_accounts":    record.Get("retirement_accounts"),
		"student_debt":           record.Get("student_debt"),
		"owns_home":              record.GetBool("owns_home"),

		// Financial - Expenses
		"total_medical_expenses": record.Get("total_medical_expenses"),
		"total_edu_expenses":     record.Get("total_edu_expenses"),
		"total_housing_expenses": record.Get("total_housing_expenses"),
		"total_rent":             record.Get("total_rent"),

		// Family Info
		"num_children":          record.Get("num_children"),
		"single_parent":         record.GetBool("single_parent"),
		"camper_name":           record.GetString("camper_name"),
		"special_circumstances": record.GetString("special_circumstances"),

		// Jewish Affiliations
		"affiliated_jcc":             record.GetBool("affiliated_jcc"),
		"child_affiliated_synagogue": record.GetString("child_affiliated_synagogue"),
		"children_jewish_day_school": record.GetString("children_jewish_day_school"),
		"russian_speaking":           record.GetBool("russian_speaking"),

		// Government/External Aid
		"gov_subsidies":              record.GetBool("gov_subsidies"),
		"gov_subsidies_detail":       record.GetString("gov_subsidies_detail"),
		"synagogue_grant":            record.GetString("synagogue_grant"),
		"one_happy_camper":           record.GetString("one_happy_camper"),
		"other_financial_support":    record.GetString("other_financial_support"),
		"other_support_amount":       record.Get("other_support_amount"),
		"other_support_expectations": record.GetString("other_support_expectations"),
		"financial_support":          record.GetString("financial_support"),

		// Program Requests
		"summer_program":          record.GetString("summer_program"),
		"summer_amount_requested": record.Get("summer_amount_requested"),
		"fc_program":              record.GetString("fc_program"),
		"fc_amount_requested":     record.Get("fc_amount_requested"),
		"tbm_program":             record.GetString("tbm_program"),
		"tbm_amount_requested":    record.Get("tbm_amount_requested"),
		"num_programs":            record.Get("num_programs"),
		"num_sessions":            record.Get("num_sessions"),
		"amount_requested":        record.Get("amount_requested"),

		// COVID/Disaster
		"covid_childcare":           record.GetBool("covid_childcare"),
		"covid_childcare_amount":    record.Get("covid_childcare_amount"),
		"covid_expenses":            record.GetString("covid_expenses"),
		"covid_expenses_additional": record.GetString("covid_expenses_additional"),
		"covid_expenses_amount":     record.Get("covid_expenses_amount"),
		"fire":                      record.GetString("fire"),
		"fire_affected":             record.GetBool("fire_affected"),
		"fire_detail":               record.GetString("fire_detail"),

		// Admin/Status
		"deposit_paid":        record.Get("deposit_paid"),
		"deposit_paid_adult":  record.Get("deposit_paid_adult"),
		"applicant_signature": record.GetString("applicant_signature"),
		"income_confirmed":    record.GetBool("income_confirmed"),
		"amount_confirmed":    record.GetBool("amount_confirmed"),
	}
}

// loadExistingApplications loads existing application records for the year
func (s *FinancialAidApplicationsSync) loadExistingApplications(
	ctx context.Context, year int,
) (map[string]*core.Record, error) {
	result := make(map[string]*core.Record)

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("financial_aid_applications", filter, sortByID, perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying existing applications page %d: %w", page, err)
		}

		for _, record := range records {
			personID := record.GetString("person")
			if personID != "" {
				result[personID] = record
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// forceWALCheckpoint forces a SQLite WAL checkpoint
func (s *FinancialAidApplicationsSync) forceWALCheckpoint() error {
	db := s.App.DB()
	if db == nil {
		return fmt.Errorf("unable to get database connection")
	}

	_, err := db.NewQuery("PRAGMA wal_checkpoint(FULL)").Execute()
	if err != nil {
		return fmt.Errorf("WAL checkpoint failed: %w", err)
	}

	return nil
}

// toRecordData converts faApplicationData to a map for database operations
func (app *faApplicationData) toRecordData(year int) map[string]any {
	return map[string]any{
		// Core identifiers
		"person":    app.personPBID,
		"household": app.householdPBID,
		"person_id": app.personCMID,
		"year":      year,

		// Interest indicators
		"interest_expressed":  app.interestExpressed,
		"donation_preference": app.donationPreference,
		"donation_other":      app.donationOther,
		"amount_awarded":      app.amountAwarded,

		// Contact Parent 1
		"contact_first_name":     app.contactFirstName,
		"contact_last_name":      app.contactLastName,
		"contact_email":          app.contactEmail,
		"contact_phone":          app.contactPhone,
		"contact_address":        app.contactAddress,
		"contact_city":           app.contactCity,
		"contact_state":          app.contactState,
		"contact_zip":            app.contactZip,
		"contact_country":        app.contactCountry,
		"contact_marital_status": app.contactMaritalStatus,
		"contact_jewish":         app.contactJewish,

		// Parent 2
		"parent_2_name":           app.parent2Name,
		"parent_2_marital_status": app.parent2MaritalStatus,
		"parent_2_jewish":         app.parent2Jewish,

		// Financial - Income
		"total_gross_income":    app.totalGrossIncome,
		"expected_gross_income": app.expectedGrossIncome,
		"total_adjusted_income": app.totalAdjustedIncome,
		"total_exemptions":      app.totalExemptions,
		"unemployment":          app.unemployment,
		"still_unemployed":      app.stillUnemployed,

		// Financial - Assets
		"non_retirement_savings": app.nonRetirementSavings,
		"retirement_accounts":    app.retirementAccounts,
		"student_debt":           app.studentDebt,
		"owns_home":              app.ownsHome,

		// Financial - Expenses
		"total_medical_expenses": app.totalMedicalExpenses,
		"total_edu_expenses":     app.totalEduExpenses,
		"total_housing_expenses": app.totalHousingExpenses,
		"total_rent":             app.totalRent,

		// Family Info
		"num_children":          float64(app.numChildren),
		"single_parent":         app.singleParent,
		"camper_name":           app.camperName,
		"special_circumstances": app.specialCircumstances,

		// Jewish Affiliations
		"affiliated_jcc":             app.affiliatedJCC,
		"child_affiliated_synagogue": app.childAffiliatedSynagogue,
		"children_jewish_day_school": app.childrenJewishDaySchool,
		"russian_speaking":           app.russianSpeaking,

		// Government/External Aid
		"gov_subsidies":              app.govSubsidies,
		"gov_subsidies_detail":       app.govSubsidiesDetail,
		"synagogue_grant":            app.synagogueGrant,
		"one_happy_camper":           app.oneHappyCamper,
		"other_financial_support":    app.otherFinancialSupport,
		"other_support_amount":       app.otherSupportAmount,
		"other_support_expectations": app.otherSupportExpectations,
		"financial_support":          app.financialSupport,

		// Program Requests
		"summer_program":          app.summerProgram,
		"summer_amount_requested": app.summerAmountRequested,
		"fc_program":              app.fcProgram,
		"fc_amount_requested":     app.fcAmountRequested,
		"tbm_program":             app.tbmProgram,
		"tbm_amount_requested":    app.tbmAmountRequested,
		"num_programs":            float64(app.numPrograms),
		"num_sessions":            float64(app.numSessions),
		"amount_requested":        app.amountRequested,

		// COVID/Disaster
		"covid_childcare":           app.covidChildcare,
		"covid_childcare_amount":    app.covidChildcareAmount,
		"covid_expenses":            app.covidExpenses,
		"covid_expenses_additional": app.covidExpensesAdditional,
		"covid_expenses_amount":     app.covidExpensesAmount,
		"fire":                      app.fire,
		"fire_affected":             app.fireAffected,
		"fire_detail":               app.fireDetail,

		// Admin/Status
		"deposit_paid":        app.depositPaid,
		"deposit_paid_adult":  app.depositPaidAdult,
		"applicant_signature": app.applicantSignature,
		"income_confirmed":    app.incomeConfirmed,
		"amount_confirmed":    app.amountConfirmed,
	}
}

// fieldEquals compares two field values for equality, handling type conversions
func (s *FinancialAidApplicationsSync) fieldEquals(existing, newVal any) bool {
	// Handle nil vs empty string
	if (existing == nil && newVal == "") || (existing == "" && newVal == nil) {
		return true
	}
	// Handle nil vs 0
	if existing == nil && newVal == 0 {
		return true
	}
	if existing == nil && newVal == 0.0 {
		return true
	}
	if existing == 0 && newVal == nil {
		return true
	}
	if existing == 0.0 && newVal == nil {
		return true
	}
	// Handle float64 vs int (PocketBase stores numbers as float64)
	if existingFloat, ok := existing.(float64); ok {
		if newInt, ok := newVal.(int); ok {
			// Only equal if the float is exactly representable as the int
			return existingFloat == float64(newInt)
		}
		if newFloat, ok := newVal.(float64); ok {
			return existingFloat == newFloat
		}
	}
	if existingInt, ok := existing.(int); ok {
		if newFloat, ok := newVal.(float64); ok {
			// Only equal if the float is exactly representable as the int
			return float64(existingInt) == newFloat
		}
	}
	// Handle bool
	if existingBool, ok := existing.(bool); ok {
		if newBool, ok := newVal.(bool); ok {
			return existingBool == newBool
		}
	}
	// Direct comparison
	return existing == newVal
}

// recordNeedsUpdate checks if any field differs between existing record and new data
func (s *FinancialAidApplicationsSync) recordNeedsUpdate(
	existing map[string]any, newData map[string]any, skipFields map[string]bool,
) bool {
	for field, newValue := range newData {
		if skipFields != nil && skipFields[field] {
			continue
		}
		if !s.fieldEquals(existing[field], newValue) {
			return true
		}
	}
	return false
}
