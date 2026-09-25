package sync

import (
	"slices"
	"testing"
)

// =============================================================================
// Transaction Transform Tests
// =============================================================================

func TestTransformTransactionToPB(t *testing.T) {
	t.Parallel()
	s := &FinancialTransactionsSync{}

	// Build lookup maps for relation resolution
	lookupMaps := TransactionLookupMaps{
		FinancialCategories: map[int]string{22650: "pb_cat_22650"},
		PaymentMethods:      map[int]string{1: "pb_pm_1"},
		Sessions:            map[int]string{1335115: "pb_session_1335115"},
		SessionGroups:       map[int]string{100: "pb_group_100"},
		Divisions:           map[int]string{85: "pb_div_85"},
		Persons:             map[int]string{3451504: "pb_person_3451504"},
		Households:          map[int]string{3539709: "pb_hh_3539709"},
	}

	// Mock CampMinder API response (lowercase field names per OpenAPI spec)
	transactionData := map[string]any{
		"transactionId":          float64(57783711),
		"transactionNumber":      float64(12345),
		"season":                 float64(2025),
		"postDate":               "2025-11-11T17:05:26.363Z",
		"effectiveDate":          "2025-11-11T00:00:00Z",
		"isReversed":             false,
		"reversalDate":           nil,
		"financialCategoryId":    float64(22650),
		"description":            "Session 2 - Camper Fee",
		"quantity":               float64(1),
		"unitAmount":             float64(128.0),
		"amount":                 float64(128.0),
		"recognitionGLAccountId": "1000",
		"deferralGLAccountId":    "2000",
		"glAccountNote":          "Test GL note",
		"transactionNote":        "Test transaction note",
		"paymentMethodId":        float64(1),
		"sessionId":              float64(1335115),
		"programId":              float64(500),
		"sessionGroupId":         float64(100),
		"divisionId":             float64(85),
		"personId":               float64(3451504),
		"householdId":            float64(3539709),
		"serviceStartDate":       "2025-06-15T00:00:00Z",
		"serviceEndDate":         "2025-07-13T00:00:00Z",
	}

	pbData, err := s.transformTransactionToPB(transactionData, 2025, lookupMaps)
	if err != nil {
		t.Fatalf("transformTransactionToPB returned error: %v", err)
	}

	t.Run("identity_fields", func(t *testing.T) {
		verifyIntField(t, pbData, "cm_id", 57783711)
		verifyIntField(t, pbData, "transaction_number", 12345)
		verifyIntField(t, pbData, "year", 2025)
	})

	t.Run("dates", func(t *testing.T) {
		// postDate is an instant on a Mountain wall clock: 2025-11-11 17:05 MST = 00:05 UTC next day.
		verifyStringField(t, pbData, "post_date", "2025-11-12 00:05:26Z")
		// The three calendar dates stay dates: midnight is not shifted.
		verifyStringField(t, pbData, "effective_date", "2025-11-11 00:00:00Z")
		verifyStringField(t, pbData, "service_start_date", "2025-06-15 00:00:00Z")
		verifyStringField(t, pbData, "service_end_date", "2025-07-13 00:00:00Z")
	})

	t.Run("reversal_tracking", func(t *testing.T) {
		verifyBoolField(t, pbData, "is_reversed", false)
		verifyFieldEmpty(t, pbData, "reversal_date")
	})

	t.Run("text_fields", func(t *testing.T) {
		verifyStringField(t, pbData, "description", "Session 2 - Camper Fee")
		verifyStringField(t, pbData, "transaction_note", "Test transaction note")
		verifyStringField(t, pbData, "gl_account_note", "Test GL note")
		verifyStringField(t, pbData, "recognition_gl_account_id", "1000")
		verifyStringField(t, pbData, "deferral_gl_account_id", "2000")
	})

	t.Run("amounts", func(t *testing.T) {
		verifyIntField(t, pbData, "quantity", 1)
		verifyFloatField(t, pbData, "unit_amount", 128.0)
		verifyFloatField(t, pbData, "amount", 128.0)
	})

	t.Run("relations", func(t *testing.T) {
		verifyStringField(t, pbData, "financial_category", "pb_cat_22650")
		verifyStringField(t, pbData, "payment_method", "pb_pm_1")
		verifyStringField(t, pbData, "session", "pb_session_1335115")
		verifyStringField(t, pbData, "session_group", "pb_group_100")
		verifyStringField(t, pbData, "division", "pb_div_85")
		verifyStringField(t, pbData, "person", "pb_person_3451504")
		verifyStringField(t, pbData, "household", "pb_hh_3539709")
		verifyIntField(t, pbData, "program_id", 500)
	})
}

// Test helper functions for field verification
func verifyIntField(t *testing.T, data map[string]any, field string, want int) {
	t.Helper()
	got, ok := data[field].(int)
	if !ok {
		t.Errorf("%s: not an int, got %T", field, data[field])
		return
	}
	if got != want {
		t.Errorf("%s = %d, want %d", field, got, want)
	}
}

func verifyFloatField(t *testing.T, data map[string]any, field string, want float64) {
	t.Helper()
	got, ok := data[field].(float64)
	if !ok {
		t.Errorf("%s: not a float64, got %T", field, data[field])
		return
	}
	if got != want {
		t.Errorf("%s = %f, want %f", field, got, want)
	}
}

func verifyStringField(t *testing.T, data map[string]any, field, want string) {
	t.Helper()
	got, ok := data[field].(string)
	if !ok {
		t.Errorf("%s: not a string, got %T", field, data[field])
		return
	}
	if got != want {
		t.Errorf("%s = %q, want %q", field, got, want)
	}
}

func verifyBoolField(t *testing.T, data map[string]any, field string, want bool) {
	t.Helper()
	got, ok := data[field].(bool)
	if !ok {
		t.Errorf("%s: not a bool, got %T", field, data[field])
		return
	}
	if got != want {
		t.Errorf("%s = %v, want %v", field, got, want)
	}
}

func verifyFieldEmpty(t *testing.T, data map[string]any, field string) {
	t.Helper()
	if data[field] != nil && data[field] != "" {
		t.Errorf("%s should be nil/empty, got %v", field, data[field])
	}
}

func TestTransformTransactionToPB_Reversed(t *testing.T) {
	t.Parallel()
	s := &FinancialTransactionsSync{}
	lookupMaps := TransactionLookupMaps{}

	transactionData := map[string]any{
		"transactionId":       float64(12345),
		"season":              float64(2025),
		"isReversed":          true,
		"reversalDate":        "2025-12-01T10:00:00Z",
		"financialCategoryId": float64(100),
		"amount":              float64(-50.0),
	}

	pbData, err := s.transformTransactionToPB(transactionData, 2025, lookupMaps)
	if err != nil {
		t.Fatalf("transformTransactionToPB returned error: %v", err)
	}

	if got, want := pbData["is_reversed"].(bool), true; got != want {
		t.Errorf("is_reversed = %v, want %v", got, want)
	}
	if pbData["reversal_date"] == nil || pbData["reversal_date"] == "" {
		t.Error("reversal_date should be set for reversed transaction")
	}
}

func TestTransformTransactionToPB_MissingTransactionID(t *testing.T) {
	t.Parallel()
	s := &FinancialTransactionsSync{}
	lookupMaps := TransactionLookupMaps{}

	transactionData := map[string]any{
		"season":              float64(2025),
		"financialCategoryId": float64(100),
		"amount":              float64(50.0),
	}

	_, err := s.transformTransactionToPB(transactionData, 2025, lookupMaps)
	if err == nil {
		t.Error("expected error for missing transactionId, got nil")
	}
}

func TestTransformTransactionToPB_ZeroTransactionID(t *testing.T) {
	t.Parallel()
	s := &FinancialTransactionsSync{}
	lookupMaps := TransactionLookupMaps{}

	transactionData := map[string]any{
		"transactionId":       float64(0),
		"season":              float64(2025),
		"financialCategoryId": float64(100),
		"amount":              float64(50.0),
	}

	_, err := s.transformTransactionToPB(transactionData, 2025, lookupMaps)
	if err == nil {
		t.Error("expected error for zero transactionId, got nil")
	}
}

func TestTransformTransactionToPB_NullOptionalFields(t *testing.T) {
	t.Parallel()
	s := &FinancialTransactionsSync{}
	lookupMaps := TransactionLookupMaps{}

	// Transaction with all optional relation fields as nil
	transactionData := map[string]any{
		"transactionId":          float64(12345),
		"season":                 float64(2025),
		"postDate":               "2025-11-11T00:00:00Z",
		"effectiveDate":          "2025-11-11T00:00:00Z",
		"isReversed":             false,
		"financialCategoryId":    float64(100),
		"amount":                 float64(50.0),
		"paymentMethodId":        nil,
		"sessionId":              nil,
		"programId":              nil,
		"sessionGroupId":         nil,
		"divisionId":             nil,
		"personId":               nil,
		"householdId":            nil,
		"recognitionGLAccountId": nil,
		"deferralGLAccountId":    nil,
		"description":            nil,
		"transactionNote":        nil,
		"glAccountNote":          nil,
		"serviceStartDate":       nil,
		"serviceEndDate":         nil,
	}

	pbData, err := s.transformTransactionToPB(transactionData, 2025, lookupMaps)
	if err != nil {
		t.Fatalf("transformTransactionToPB returned error: %v", err)
	}

	// Required fields should be present
	if got, want := pbData["cm_id"].(int), 12345; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}

	// Optional relation fields should not be present (not set) or nil
	optionalRelations := []string{
		"payment_method", "session", "session_group", "division", "person", "household",
	}
	for _, field := range optionalRelations {
		if val, exists := pbData[field]; exists && val != nil && val != "" {
			t.Errorf("%s should not be set when source is nil, got %v", field, val)
		}
	}
}

func TestTransformTransactionToPB_UnknownRelations(t *testing.T) {
	t.Parallel()
	s := &FinancialTransactionsSync{}

	// Empty lookup maps - relations won't be resolvable
	lookupMaps := TransactionLookupMaps{}

	transactionData := map[string]any{
		"transactionId":       float64(12345),
		"season":              float64(2025),
		"financialCategoryId": float64(999), // Not in lookup map
		"paymentMethodId":     float64(999),
		"sessionId":           float64(999),
		"personId":            float64(999),
		"amount":              float64(50.0),
	}

	pbData, err := s.transformTransactionToPB(transactionData, 2025, lookupMaps)
	if err != nil {
		t.Fatalf("transformTransactionToPB returned error: %v", err)
	}

	// PB relations should NOT be set when not in lookup map
	if val, exists := pbData["financial_category"]; exists && val != nil && val != "" {
		t.Errorf("financial_category should not be set when not found in map, got %v", val)
	}
	if val, exists := pbData["payment_method"]; exists && val != nil && val != "" {
		t.Errorf("payment_method should not be set when not found in map, got %v", val)
	}
	if val, exists := pbData["session"]; exists && val != nil && val != "" {
		t.Errorf("session should not be set when not found in map, got %v", val)
	}
	if val, exists := pbData["person"]; exists && val != nil && val != "" {
		t.Errorf("person should not be set when not found in map, got %v", val)
	}
}

func TestTransformTransactionToPB_NegativeAmount(t *testing.T) {
	t.Parallel()
	s := &FinancialTransactionsSync{}
	lookupMaps := TransactionLookupMaps{}

	// Refund/credit with negative amount
	transactionData := map[string]any{
		"transactionId":       float64(12345),
		"season":              float64(2025),
		"financialCategoryId": float64(100),
		"amount":              float64(-150.50),
		"unitAmount":          float64(-150.50),
		"quantity":            float64(1),
	}

	pbData, err := s.transformTransactionToPB(transactionData, 2025, lookupMaps)
	if err != nil {
		t.Fatalf("transformTransactionToPB returned error: %v", err)
	}

	// Negative amounts should be preserved
	if got, want := pbData["amount"].(float64), -150.50; got != want {
		t.Errorf("amount = %f, want %f", got, want)
	}
	if got, want := pbData["unit_amount"].(float64), -150.50; got != want {
		t.Errorf("unit_amount = %f, want %f", got, want)
	}
}

// TestTransformTransactionToPB_YearIsCampMindersSeason: year is the row's own season
// (design §6.1), not the season the caller asked for.
func TestTransformTransactionToPB_YearIsCampMindersSeason(t *testing.T) {
	t.Parallel()
	s := &FinancialTransactionsSync{}
	withSeason := map[string]any{"transactionId": float64(1), "season": float64(2027), "amount": 10.0}
	pbData, err := s.transformTransactionToPB(withSeason, 2026, TransactionLookupMaps{})
	if err != nil {
		t.Fatalf("transform: %v", err)
	}
	verifyIntField(t, pbData, "year", 2027)

	noSeason := map[string]any{"transactionId": float64(2), "amount": 10.0}
	pbData, err = s.transformTransactionToPB(noSeason, 2026, TransactionLookupMaps{})
	if err != nil {
		t.Fatalf("transform: %v", err)
	}
	verifyIntField(t, pbData, "year", 2026)
}

// TestTransformTransactionToPB_KeepsRawIDsThatDoNotResolve: before this, an id with no
// PocketBase row was silently dropped (setRelation) and a posting to a non-attendee could
// not be told from a household-level posting (analysis §5.4 item 2).
func TestTransformTransactionToPB_KeepsRawIDsThatDoNotResolve(t *testing.T) {
	t.Parallel()
	s := &FinancialTransactionsSync{}
	lookups := TransactionLookupMaps{Households: map[int]string{9110001: "pb_hh_9110001"}}
	data := map[string]any{
		"transactionId": float64(3), "season": float64(2026), "amount": 10.0,
		"personId": float64(9100001), "householdId": float64(9110001),
		"sessionId": float64(9120001), "financialCategoryId": float64(22650),
	}
	pbData, err := s.transformTransactionToPB(data, 2026, lookups)
	if err != nil {
		t.Fatalf("transform: %v", err)
	}
	verifyIntField(t, pbData, "person_cm_id", 9100001)
	verifyIntField(t, pbData, "household_cm_id", 9110001)
	verifyIntField(t, pbData, "session_cm_id", 9120001)
	verifyIntField(t, pbData, "financial_category_cm_id", 22650)
	verifyStringField(t, pbData, "household", "pb_hh_9110001")
	if _, set := pbData["person"]; set {
		t.Error("person relation must stay unset when the id does not resolve")
	}

	unresolved := unresolvedTransactionIDs{}
	unresolved.tally(pbData)
	if unresolved["person"] != 1 || unresolved["session"] != 1 || unresolved["financial_category"] != 1 ||
		unresolved["household"] != 0 {
		t.Errorf("tally = %v, want person, session and financial_category 1, household 0", unresolved)
	}
}

// TestTransformTransactionToPB_AbsentIDsAreZero: "may be empty" means 0 on a number
// field, set explicitly so a later sync can clear a value CampMinder stopped sending.
func TestTransformTransactionToPB_AbsentIDsAreZero(t *testing.T) {
	t.Parallel()
	s := &FinancialTransactionsSync{}
	data := map[string]any{"transactionId": float64(4), "season": float64(2026), "amount": 10.0, "personId": nil}
	pbData, err := s.transformTransactionToPB(data, 2026, TransactionLookupMaps{})
	if err != nil {
		t.Fatalf("transform: %v", err)
	}
	for _, f := range []string{"person_cm_id", "household_cm_id", "session_cm_id", "financial_category_cm_id"} {
		verifyIntField(t, pbData, f, 0)
	}
}

// TestTransactionCompareFieldsIncludeRawIDs: ProcessSimpleRecord only compares the listed
// fields, so an existing row would never get its raw ids unless they are in the list.
func TestTransactionCompareFieldsIncludeRawIDs(t *testing.T) {
	t.Parallel()
	for _, f := range []string{"person_cm_id", "household_cm_id", "session_cm_id", "financial_category_cm_id"} {
		if !slices.Contains(transactionCompareFields, f) {
			t.Errorf("transactionCompareFields is missing %q", f)
		}
	}
}
