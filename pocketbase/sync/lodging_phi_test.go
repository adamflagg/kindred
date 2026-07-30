package sync

import (
	"os"
	"strings"
	"testing"
)

// phiCollections hold detailed medical disclosures about named individuals.
// Spec 5.1 puts them in a separate, admin-gated collection; 5.2 keeps them out
// of every export.
var phiCollections = []string{"family_camp_medical"}

// phiColumns are the column names carrying narrative medical text. Any of these
// appearing in an export config means a disclosure is being written to a Google
// Sheet next to the person's name.
var phiColumns = []string{
	"cpap_info",
	"special_needs_info",
	"allergy_info",
	"dietary_info",
	"additional_info",
	"bathroom_explain",
	"accommodation_explain",
	"physician_info",
}

// KNOWN EXPOSURE, deliberately not fixed here. person_custom_values and
// household_custom_values ARE exported to Google Sheets, with First Name, Last
// Name, Field Name and the raw Value, so the PHI narrative already reaches
// Sheets through the raw tables alongside the individual's name. That predates
// this work and staff may depend on the sheet, so narrowing it is a behavior
// change with a real chance of breaking a workflow -- it is recorded for the
// owner rather than changed silently. What follows covers what this plan is
// responsible for: no NEW collection carries PHI into an export.

// TestPHICollectionsAreNotExported is the assertion spec 5.4 asks for.
func TestPHICollectionsAreNotExported(t *testing.T) {
	configs := append(GetReadableYearExports(), GetReadableGlobalExports()...)

	// Without this the test passes by looking at nothing: every assertion below
	// is inside the loop, so an empty config list reads as "no PHI exported"
	// rather than as "the export registry moved and this test went blind".
	if len(configs) == 0 {
		t.Fatal("no export configs found; this test cannot prove anything about PHI containment")
	}

	for _, cfg := range configs {
		for _, phi := range phiCollections {
			if cfg.Collection == phi {
				t.Errorf("collection %q is exported to sheet %q; spec 5.2 forbids it",
					phi, cfg.SheetName)
			}
		}
		for _, col := range cfg.Columns {
			for _, phi := range phiColumns {
				if col.Field == phi {
					t.Errorf("export %q writes PHI column %q to sheet %q",
						cfg.Collection, phi, cfg.SheetName)
				}
			}
		}
	}
}

// TestLodgingCollectionsAreNotExported: nothing this plan created goes to
// Sheets. lodging_ingest_issues carries verbatim request text, and
// lodging_assignments ties a household to a room -- neither belongs in a
// spreadsheet that gets shared around.
func TestLodgingCollectionsAreNotExported(t *testing.T) {
	forbidden := map[string]bool{
		"lodging_assignments":        true,
		"lodging_assignment_history": true,
		"lodging_merges":             true,
		"lodging_availability":       true,
		"lodging_ingest_issues":      true,
		"lodging_field_mappings":     true,
	}

	for _, cfg := range append(GetReadableYearExports(), GetReadableGlobalExports()...) {
		if forbidden[cfg.Collection] {
			t.Errorf("lodging collection %q is exported to sheet %q", cfg.Collection, cfg.SheetName)
		}
	}
}

// TestSyncJobToCollectionsIsNotAnExportList guards against the easy misreading
// of the entry the ingest phase adds to that map. It exists ONLY so the
// export-skip optimisation knows which collections a job writes; membership must
// never imply an export.
//
// The job name is written as a literal rather than serviceNameLodgingAssignments
// because that constant ships on the ingest branch, not this one. A missing key
// yields a nil slice and the loop simply does not run, so this test is inert
// here and becomes live the moment the two branches meet -- which is the point
// at which the misreading it guards against becomes possible.
func TestSyncJobToCollectionsIsNotAnExportList(t *testing.T) {
	exported := map[string]bool{}
	for _, cfg := range append(GetReadableYearExports(), GetReadableGlobalExports()...) {
		exported[cfg.Collection] = true
	}

	for _, job := range []string{"lodging_assignments", "family_camp_derived"} {
		for _, collection := range SyncJobToCollections[job] {
			if exported[collection] {
				t.Errorf("%q is both in SyncJobToCollections[%q] and exported", collection, job)
			}
		}
	}
}

// TestPHINarrativeIsNeverLogged: spec 5.2 bars PHI from logs as well as
// exports. This greps the source rather than the runtime, because the failure
// mode is a slog call somebody adds later while debugging.
//
// It reads the source text of every file that handles narrative or request
// text: a slog line naming any PHI field would put a disclosure into the log
// stream, which on this deployment goes to the container log and from there
// wherever logs go.
func TestPHINarrativeIsNeverLogged(t *testing.T) {
	for _, file := range []string{"family_camp_derived.go", "lodging_requests.go"} {
		for _, v := range phiLogViolations(readSourceFile(t, file)) {
			t.Errorf("%s: %s", file, v)
		}
	}
}

// phiNarrativeExprs are the Go expressions that evaluate to narrative text.
// Separate from phiColumns because a log line can name either the column or the
// struct field that feeds it.
var phiNarrativeExprs = []string{
	"med.cpapInfo", "med.specialNeedsInfo", "med.allergyInfo",
	"med.dietaryInfo", "med.additionalInfo", "med.bathroomExplain",
	"med.accommodationExplain", "med.physicianInfo",
	"reg.requestText", "req.RequestText", "a.req.RequestText",
}

// phiLogViolations returns one message per slog call that names PHI.
//
// It joins each call across lines before matching. The previous version tested
// `strings.HasPrefix(trimmed, "slog.")` on individual lines, which meant gofmt
// wrapping a long call -- exactly what happens when arguments are added to it --
// moved the PHI argument onto a continuation line the scanner never looked at.
// A guard with a formatting-dependent blind spot is worse than no guard, because
// it reads as coverage.
func phiLogViolations(src string) []string {
	var out []string
	lines := strings.Split(src, "\n")

	for i := 0; i < len(lines); i++ {
		start := strings.Index(lines[i], "slog.")
		if start < 0 {
			continue
		}
		// Accumulate until the call's parentheses balance, so the whole
		// argument list is inspected however it happens to be wrapped.
		call := lines[i][start:]
		depth := parenDepth(call)
		for j := i + 1; depth > 0 && j < len(lines) && j < i+12; j++ {
			call += " " + strings.TrimSpace(lines[j])
			depth += parenDepth(lines[j])
			i = j
		}

		for _, phi := range phiColumns {
			if strings.Contains(call, `"`+phi+`"`) {
				out = append(out, "a slog call references the PHI column "+phi+":\n  "+call)
			}
		}
		for _, expr := range phiNarrativeExprs {
			if strings.Contains(call, expr) {
				out = append(out, "a slog call logs "+expr+":\n  "+call)
			}
		}
	}
	return out
}

func parenDepth(s string) int {
	return strings.Count(s, "(") - strings.Count(s, ")")
}

// TestPHILogScannerCatchesWrappedCalls is the guard for the guard. The bug this
// covers is not hypothetical: the line-anchored version passed on every input
// below except the first.
func TestPHILogScannerCatchesWrappedCalls(t *testing.T) {
	cases := map[string]bool{
		`slog.Info("x", "v", med.bathroomExplain)`:                                      true,
		"slog.Info(\"x\",\n\t\"v\", med.bathroomExplain,\n)":                            true,
		"if err != nil {\n\tslog.Error(\"x\",\n\t\t\"v\", med.accommodationExplain)\n}": true,
		"slog.Info(\"x\",\n\t\"field\", \"bathroom_explain\")":                          true,
		`slog.Info("saved", "household", med.householdPBID)`:                            false,
		`bathroomParts = append(bathroomParts, med.bathroomExplain)`:                    false,
	}
	for src, wantViolation := range cases {
		got := phiLogViolations(src)
		if wantViolation && len(got) == 0 {
			t.Errorf("scanner missed a PHI log call:\n%s", src)
		}
		if !wantViolation && len(got) > 0 {
			t.Errorf("scanner false-positived on:\n%s\n  -> %v", src, got)
		}
	}
}

// readSourceFile reads a file from this package's directory. Tests run with the
// package directory as the working directory, so a bare filename is correct.
func readSourceFile(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("reading %s: %v", name, err)
	}
	return string(data)
}
