package sync

import (
	"testing"
)

func TestFinancialLookupsSync_Name(t *testing.T) {
	s := &FinancialLookupsSync{}

	got := s.Name()
	want := "financial_lookups"

	if got != want {
		t.Errorf("FinancialLookupsSync.Name() = %q, want %q", got, want)
	}
}

// =============================================================================
// Financial Category Transform Tests
// =============================================================================

func TestTransformFinancialCategoryToPB(t *testing.T) {
	s := &FinancialLookupsSync{}

	// Mock CampMinder API response (lowercase field names per OpenAPI spec)
	categoryData := map[string]interface{}{
		"id":         float64(22650),
		"name":       "Fees - Summer Camp",
		"isArchived": false,
	}

	pbData, err := s.transformFinancialCategoryToPB(categoryData)
	if err != nil {
		t.Fatalf("transformFinancialCategoryToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["cm_id"].(int), 22650; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Fees - Summer Camp"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}
	if got, want := pbData["is_archived"].(bool), false; got != want {
		t.Errorf("is_archived = %v, want %v", got, want)
	}
}

func TestTransformFinancialCategoryToPB_Archived(t *testing.T) {
	s := &FinancialLookupsSync{}

	categoryData := map[string]interface{}{
		"id":         float64(100),
		"name":       "Archived Category",
		"isArchived": true,
	}

	pbData, err := s.transformFinancialCategoryToPB(categoryData)
	if err != nil {
		t.Fatalf("transformFinancialCategoryToPB returned error: %v", err)
	}

	if got, want := pbData["is_archived"].(bool), true; got != want {
		t.Errorf("is_archived = %v, want %v", got, want)
	}
}

func TestTransformFinancialCategoryToPB_NullName(t *testing.T) {
	s := &FinancialLookupsSync{}

	// API allows nullable name
	categoryData := map[string]interface{}{
		"id":         float64(100),
		"name":       nil,
		"isArchived": false,
	}

	pbData, err := s.transformFinancialCategoryToPB(categoryData)
	if err != nil {
		t.Fatalf("transformFinancialCategoryToPB returned error: %v", err)
	}

	// Name should be empty string when null
	if got, want := pbData["name"].(string), ""; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}
}

func TestTransformFinancialCategoryToPB_MissingName(t *testing.T) {
	s := &FinancialLookupsSync{}

	// No name key at all
	categoryData := map[string]interface{}{
		"id":         float64(100),
		"isArchived": false,
	}

	pbData, err := s.transformFinancialCategoryToPB(categoryData)
	if err != nil {
		t.Fatalf("transformFinancialCategoryToPB returned error: %v", err)
	}

	// Name should be empty string when missing
	if got, want := pbData["name"].(string), ""; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}
}

func TestTransformFinancialCategoryToPB_MissingID(t *testing.T) {
	s := &FinancialLookupsSync{}

	data := map[string]interface{}{
		"name":       "Test Category",
		"isArchived": false,
	}

	_, err := s.transformFinancialCategoryToPB(data)
	if err == nil {
		t.Error("expected error for missing id, got nil")
	}
}

func TestTransformFinancialCategoryToPB_ZeroID(t *testing.T) {
	s := &FinancialLookupsSync{}

	data := map[string]interface{}{
		"id":         float64(0),
		"name":       "Test Category",
		"isArchived": false,
	}

	_, err := s.transformFinancialCategoryToPB(data)
	if err == nil {
		t.Error("expected error for zero id, got nil")
	}
}

// =============================================================================
// Payment Method Transform Tests
// =============================================================================

func TestTransformPaymentMethodToPB(t *testing.T) {
	s := &FinancialLookupsSync{}

	// Mock CampMinder API response (lowercase field names per OpenAPI spec)
	methodData := map[string]interface{}{
		"id":   float64(1),
		"name": "Credit Card",
	}

	pbData, err := s.transformPaymentMethodToPB(methodData)
	if err != nil {
		t.Fatalf("transformPaymentMethodToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["cm_id"].(int), 1; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Credit Card"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}

	// Verify only 2 fields
	if len(pbData) != 2 {
		t.Errorf("expected 2 fields, got %d: %v", len(pbData), pbData)
	}
}

func TestTransformPaymentMethodToPB_NullName(t *testing.T) {
	s := &FinancialLookupsSync{}

	// API allows nullable name
	methodData := map[string]interface{}{
		"id":   float64(1),
		"name": nil,
	}

	pbData, err := s.transformPaymentMethodToPB(methodData)
	if err != nil {
		t.Fatalf("transformPaymentMethodToPB returned error: %v", err)
	}

	// Name should be empty string when null
	if got, want := pbData["name"].(string), ""; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}
}

func TestTransformPaymentMethodToPB_MissingName(t *testing.T) {
	s := &FinancialLookupsSync{}

	// No name key at all
	methodData := map[string]interface{}{
		"id": float64(1),
	}

	pbData, err := s.transformPaymentMethodToPB(methodData)
	if err != nil {
		t.Fatalf("transformPaymentMethodToPB returned error: %v", err)
	}

	// Name should be empty string when missing
	if got, want := pbData["name"].(string), ""; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}
}

func TestTransformPaymentMethodToPB_MissingID(t *testing.T) {
	s := &FinancialLookupsSync{}

	data := map[string]interface{}{
		"name": "Credit Card",
	}

	_, err := s.transformPaymentMethodToPB(data)
	if err == nil {
		t.Error("expected error for missing id, got nil")
	}
}

func TestTransformPaymentMethodToPB_ZeroID(t *testing.T) {
	s := &FinancialLookupsSync{}

	data := map[string]interface{}{
		"id":   float64(0),
		"name": "Credit Card",
	}

	_, err := s.transformPaymentMethodToPB(data)
	if err == nil {
		t.Error("expected error for zero id, got nil")
	}
}
