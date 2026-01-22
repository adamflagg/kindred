package sync

import (
	"testing"
)

func TestFinancialTransactionsSync_Name(t *testing.T) {
	s := &FinancialTransactionsSync{}

	got := s.Name()
	want := "financial_transactions"

	if got != want {
		t.Errorf("FinancialTransactionsSync.Name() = %q, want %q", got, want)
	}
}

// =============================================================================
// Transaction Transform Tests
// =============================================================================

func TestTransformTransactionToPB(t *testing.T) {
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
	transactionData := map[string]interface{}{
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

	// Verify identity fields
	if got, want := pbData["cm_id"].(int), 57783711; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["transaction_number"].(int), 12345; got != want {
		t.Errorf("transaction_number = %d, want %d", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}

	// Verify dates
	if pbData["post_date"] == nil || pbData["post_date"] == "" {
		t.Error("post_date should be set")
	}
	if pbData["effective_date"] == nil || pbData["effective_date"] == "" {
		t.Error("effective_date should be set")
	}
	if pbData["service_start_date"] == nil || pbData["service_start_date"] == "" {
		t.Error("service_start_date should be set")
	}
	if pbData["service_end_date"] == nil || pbData["service_end_date"] == "" {
		t.Error("service_end_date should be set")
	}

	// Verify reversal tracking
	if got, want := pbData["is_reversed"].(bool), false; got != want {
		t.Errorf("is_reversed = %v, want %v", got, want)
	}
	if pbData["reversal_date"] != nil && pbData["reversal_date"] != "" {
		t.Errorf("reversal_date should be nil/empty, got %v", pbData["reversal_date"])
	}

	// Verify category (relation only)
	if got, want := pbData["financial_category"].(string), "pb_cat_22650"; got != want {
		t.Errorf("financial_category = %q, want %q", got, want)
	}

	// Verify description and notes
	if got, want := pbData["description"].(string), "Session 2 - Camper Fee"; got != want {
		t.Errorf("description = %q, want %q", got, want)
	}
	if got, want := pbData["transaction_note"].(string), "Test transaction note"; got != want {
		t.Errorf("transaction_note = %q, want %q", got, want)
	}
	if got, want := pbData["gl_account_note"].(string), "Test GL note"; got != want {
		t.Errorf("gl_account_note = %q, want %q", got, want)
	}

	// Verify amounts
	if got, want := pbData["quantity"].(int), 1; got != want {
		t.Errorf("quantity = %d, want %d", got, want)
	}
	if got, want := pbData["unit_amount"].(float64), 128.0; got != want {
		t.Errorf("unit_amount = %f, want %f", got, want)
	}
	if got, want := pbData["amount"].(float64), 128.0; got != want {
		t.Errorf("amount = %f, want %f", got, want)
	}

	// Verify GL accounts (string IDs)
	if got, want := pbData["recognition_gl_account_id"].(string), "1000"; got != want {
		t.Errorf("recognition_gl_account_id = %q, want %q", got, want)
	}
	if got, want := pbData["deferral_gl_account_id"].(string), "2000"; got != want {
		t.Errorf("deferral_gl_account_id = %q, want %q", got, want)
	}

	// Verify payment method (relation only)
	if got, want := pbData["payment_method"].(string), "pb_pm_1"; got != want {
		t.Errorf("payment_method = %q, want %q", got, want)
	}

	// Verify session (relation only)
	if got, want := pbData["session"].(string), "pb_session_1335115"; got != want {
		t.Errorf("session = %q, want %q", got, want)
	}

	// Verify program (CM ID only - no program table)
	if got, want := pbData["program_id"].(int), 500; got != want {
		t.Errorf("program_id = %d, want %d", got, want)
	}

	// Verify session group (relation only)
	if got, want := pbData["session_group"].(string), "pb_group_100"; got != want {
		t.Errorf("session_group = %q, want %q", got, want)
	}

	// Verify division (relation only)
	if got, want := pbData["division"].(string), "pb_div_85"; got != want {
		t.Errorf("division = %q, want %q", got, want)
	}

	// Verify person (relation only)
	if got, want := pbData["person"].(string), "pb_person_3451504"; got != want {
		t.Errorf("person = %q, want %q", got, want)
	}

	// Verify household (relation only)
	if got, want := pbData["household"].(string), "pb_hh_3539709"; got != want {
		t.Errorf("household = %q, want %q", got, want)
	}
}

func TestTransformTransactionToPB_Reversed(t *testing.T) {
	s := &FinancialTransactionsSync{}
	lookupMaps := TransactionLookupMaps{}

	transactionData := map[string]interface{}{
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
	s := &FinancialTransactionsSync{}
	lookupMaps := TransactionLookupMaps{}

	transactionData := map[string]interface{}{
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
	s := &FinancialTransactionsSync{}
	lookupMaps := TransactionLookupMaps{}

	transactionData := map[string]interface{}{
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
	s := &FinancialTransactionsSync{}
	lookupMaps := TransactionLookupMaps{}

	// Transaction with all optional relation fields as nil
	transactionData := map[string]interface{}{
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
	s := &FinancialTransactionsSync{}

	// Empty lookup maps - relations won't be resolvable
	lookupMaps := TransactionLookupMaps{}

	transactionData := map[string]interface{}{
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
	s := &FinancialTransactionsSync{}
	lookupMaps := TransactionLookupMaps{}

	// Refund/credit with negative amount
	transactionData := map[string]interface{}{
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
