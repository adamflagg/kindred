package sync

import (
	"context"
	"testing"
)

// MockSheetsWriter implements SheetsWriter interface for testing
type MockSheetsWriter struct {
	WrittenData map[string][][]interface{} // sheetName -> rows
	ClearedTabs []string
	WriteError  error
	ClearError  error
}

func NewMockSheetsWriter() *MockSheetsWriter {
	return &MockSheetsWriter{
		WrittenData: make(map[string][][]interface{}),
		ClearedTabs: []string{},
	}
}

func (m *MockSheetsWriter) WriteToSheet(_ context.Context, _, sheetTab string, data [][]interface{}) error {
	if m.WriteError != nil {
		return m.WriteError
	}
	m.WrittenData[sheetTab] = data
	return nil
}

func (m *MockSheetsWriter) ClearSheet(_ context.Context, _, sheetTab string) error {
	if m.ClearError != nil {
		return m.ClearError
	}
	m.ClearedTabs = append(m.ClearedTabs, sheetTab)
	return nil
}

func TestGoogleSheetsExport_Name(t *testing.T) {
	export := &GoogleSheetsExport{}
	if got := export.Name(); got != "google_sheets_export" {
		t.Errorf("Name() = %q, want %q", got, "google_sheets_export")
	}
}

func TestFormatAttendeesData(t *testing.T) {
	// Test data formatting for attendees
	records := []AttendeeRecord{
		{
			FirstName:      "Emma",
			LastName:       "Johnson",
			Grade:          5,
			Gender:         "F",
			SessionName:    "Session 2",
			SessionType:    "main",
			EnrollmentDate: "2025-01-15",
			Status:         "enrolled",
		},
		{
			FirstName:      "Liam",
			LastName:       "Garcia",
			Grade:          6,
			Gender:         "M",
			SessionName:    "Session 3",
			SessionType:    "main",
			EnrollmentDate: "2025-02-01",
			Status:         "enrolled",
		},
	}

	data := FormatAttendeesData(records)

	// Check headers
	if len(data) < 1 {
		t.Fatal("Expected at least header row")
	}
	headers := data[0]
	expectedHeaders := []interface{}{
		"First Name", "Last Name", "Grade", "Gender",
		"Session", "Session Type", "Enrollment Date", "Status",
	}
	if len(headers) != len(expectedHeaders) {
		t.Errorf("Header count = %d, want %d", len(headers), len(expectedHeaders))
	}
	for i, h := range expectedHeaders {
		if headers[i] != h {
			t.Errorf("Header[%d] = %v, want %v", i, headers[i], h)
		}
	}

	// Check data rows
	if len(data) != 3 { // 1 header + 2 data rows
		t.Errorf("Row count = %d, want 3", len(data))
	}

	// Check first data row
	row1 := data[1]
	if row1[0] != "Emma" {
		t.Errorf("Row 1 FirstName = %v, want Emma", row1[0])
	}
	if row1[1] != "Johnson" {
		t.Errorf("Row 1 LastName = %v, want Johnson", row1[1])
	}
	if row1[2] != 5 {
		t.Errorf("Row 1 Grade = %v, want 5", row1[2])
	}
}

func TestFormatSessionsData(t *testing.T) {
	// Test data formatting for sessions
	records := []SessionRecord{
		{
			Name:      "Session 2",
			Type:      "main",
			StartDate: "2025-06-15",
			EndDate:   "2025-07-06",
			Year:      2025,
		},
		{
			Name:      "Taste of Camp",
			Type:      "main",
			StartDate: "2025-06-08",
			EndDate:   "2025-06-14",
			Year:      2025,
		},
	}

	data := FormatSessionsData(records)

	// Check headers
	if len(data) < 1 {
		t.Fatal("Expected at least header row")
	}
	headers := data[0]
	expectedHeaders := []interface{}{"Name", "Type", "Start Date", "End Date", "Year"}
	if len(headers) != len(expectedHeaders) {
		t.Errorf("Header count = %d, want %d", len(headers), len(expectedHeaders))
	}

	// Check data rows
	if len(data) != 3 {
		t.Errorf("Row count = %d, want 3", len(data))
	}

	// Check first data row
	row1 := data[1]
	if row1[0] != "Session 2" {
		t.Errorf("Row 1 Name = %v, want Session 2", row1[0])
	}
	if row1[4] != 2025 {
		t.Errorf("Row 1 Year = %v, want 2025", row1[4])
	}
}

func TestGoogleSheetsExport_ExportToSheets(t *testing.T) {
	mock := NewMockSheetsWriter()
	export := &GoogleSheetsExport{
		sheetsWriter:  mock,
		spreadsheetID: "test-spreadsheet-id",
	}

	attendees := []AttendeeRecord{
		{
			FirstName:      "Emma",
			LastName:       "Johnson",
			Grade:          5,
			Gender:         "F",
			SessionName:    "Session 2",
			SessionType:    "main",
			EnrollmentDate: "2025-01-15",
			Status:         "enrolled",
		},
	}

	sessions := []SessionRecord{
		{
			Name:      "Session 2",
			Type:      "main",
			StartDate: "2025-06-15",
			EndDate:   "2025-07-06",
			Year:      2025,
		},
	}

	err := export.ExportToSheets(context.Background(), attendees, sessions)
	if err != nil {
		t.Errorf("ExportToSheets() error = %v", err)
	}

	// Verify Attendees tab was written
	if _, ok := mock.WrittenData["Attendees"]; !ok {
		t.Error("Attendees tab was not written")
	}

	// Verify Sessions tab was written
	if _, ok := mock.WrittenData["Sessions"]; !ok {
		t.Error("Sessions tab was not written")
	}

	// Verify both tabs were cleared first
	if len(mock.ClearedTabs) != 2 {
		t.Errorf("Expected 2 tabs cleared, got %d", len(mock.ClearedTabs))
	}
}

func TestGoogleSheetsExport_GetStats(t *testing.T) {
	export := &GoogleSheetsExport{}
	export.Stats = Stats{
		Created: 10,
		Updated: 5,
	}

	stats := export.GetStats()
	if stats.Created != 10 {
		t.Errorf("Stats.Created = %d, want 10", stats.Created)
	}
	if stats.Updated != 5 {
		t.Errorf("Stats.Updated = %d, want 5", stats.Updated)
	}
}

func TestAttendeeRecord_Validation(t *testing.T) {
	// Test that empty required fields are handled
	record := AttendeeRecord{}

	// Should not panic with empty values
	data := FormatAttendeesData([]AttendeeRecord{record})
	if len(data) != 2 { // header + 1 row
		t.Errorf("Expected 2 rows for empty record, got %d", len(data))
	}

	// Empty strings should be preserved
	row := data[1]
	if row[0] != "" {
		t.Errorf("Empty FirstName should be empty string, got %v", row[0])
	}
}

func TestSessionRecord_Validation(t *testing.T) {
	// Test that empty required fields are handled
	record := SessionRecord{}

	// Should not panic with empty values
	data := FormatSessionsData([]SessionRecord{record})
	if len(data) != 2 { // header + 1 row
		t.Errorf("Expected 2 rows for empty record, got %d", len(data))
	}
}
