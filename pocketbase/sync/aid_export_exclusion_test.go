package sync

import (
	"strings"
	"testing"
)

// TestAidCollectionsAreNeverExportedToSheets: no aid_ collection reaches a
// Google Sheet -- not as a tab, and not as a lookup a column resolves through
// (campership spec §14.3). The Exports folder's audience is deliberately wider
// than finance (workbook_manager.go), so a family's aid there would be a leak.
// Matched by prefix so an aid_ table a later sub-project adds is covered.
func TestAidCollectionsAreNeverExportedToSheets(t *testing.T) {
	t.Parallel()
	configs := append(GetReadableYearExports(), GetReadableGlobalExports()...)
	if len(configs) == 0 {
		t.Fatal("no export configs found; this test would prove nothing")
	}
	isAid := func(name string) bool { return strings.HasPrefix(strings.ToLower(name), "aid_") }
	for _, cfg := range configs {
		if isAid(cfg.Collection) {
			t.Errorf("sheet %q exports %s; aid_ collections must never reach Sheets", cfg.SheetName, cfg.Collection)
		}
		for _, col := range cfg.Columns {
			for _, ref := range []string{col.RelatedCol, col.IntermediateCol} {
				if isAid(ref) {
					t.Errorf("sheet %q column %q resolves through %s; aid_ collections must never reach Sheets",
						cfg.SheetName, col.Header, ref)
				}
			}
		}
	}
}
