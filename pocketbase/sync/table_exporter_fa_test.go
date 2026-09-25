package sync

import "testing"

// The FA export must follow the column rename (design §6.4) and must not export the two
// dropped columns. The wider export review is kindred#2836; this touches only the renamed
// and dropped columns.
func TestFAApplicationsExportFollowsTheRename(t *testing.T) {
	t.Parallel()
	var cols []ColumnConfig
	for _, cfg := range GetReadableYearExports() {
		if cfg.Collection == "financial_aid_applications" {
			cols = cfg.Columns
		}
	}
	if cols == nil {
		t.Fatal("no financial_aid_applications export config")
	}
	found := false
	for _, c := range cols {
		switch c.Field {
		case "amount_awarded", "amount_requested", "deposit_paid":
			t.Errorf("export still reads dropped or renamed column %q (header %q)", c.Field, c.Header)
		case "registration_request_amount":
			found = c.Header == "Registration Request Amt"
		}
		if c.Header == "Amt Awarded" {
			t.Error(`the "Amt Awarded" header must go: the value was never an award`)
		}
	}
	if !found {
		t.Error(`want a registration_request_amount column headed "Registration Request Amt"`)
	}
}
