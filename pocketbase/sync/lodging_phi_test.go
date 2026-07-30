package sync

import (
	"os"
	"slices"
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

// TestLodgingCollectionsAreNeverExported guards the claim SyncJobToCollections
// makes about the lodging ingest: its entry exists so the export-skip
// optimisation knows which collections the job writes, NOT because any of them
// is exported.
//
// The distinction matters because the two lists look interchangeable and are
// not. SyncJobToCollections is a write manifest; GetReadableYearExports is a
// publish list that ships rows to Google Sheets. lodging_assignments and
// lodging_assignment_history carry per-household and per-person placement --
// who slept where -- which is exactly the shape of data family_camp_medical is
// deliberately kept out of the publish list for.
//
// Without this test the invariant is a comment, and the failure mode is silent:
// a future lodging-board export lands in GetReadableYearExports, nothing goes
// red, and placement data reaches a spreadsheet.
//
// This arrived on the Phase B2 branch (#1880) and supersedes the two narrower
// tests Phase C carried in its place. Those named the lodging collections in a
// literal list and keyed the manifest check off a string literal, because
// serviceNameLodgingAssignments did not exist on this branch yet. It does now,
// so the prefix scan below covers every lodging collection including ones not
// yet written, and the manifest half is live rather than inert.
func TestLodgingCollectionsAreNeverExported(t *testing.T) {
	exported := map[string]string{}
	for _, cfg := range GetReadableYearExports() {
		exported[cfg.Collection] = "GetReadableYearExports"
	}
	for _, cfg := range GetReadableGlobalExports() {
		exported[cfg.Collection] = "GetReadableGlobalExports"
	}

	for collection, where := range exported {
		if strings.HasPrefix(collection, "lodging_") {
			t.Errorf("%s exports %q; lodging collections carry placement data and must not ship to Sheets",
				where, collection)
		}
	}

	// The write manifest is the other half of the claim: every collection the
	// ingest writes has to be listed there, or the export-skip optimisation
	// silently misses it.
	written, ok := SyncJobToCollections[serviceNameLodgingAssignments]
	if !ok {
		t.Fatal("lodging_assignments missing from SyncJobToCollections")
	}
	for _, collection := range written {
		if where, isExported := exported[collection]; isExported {
			t.Errorf("%s is both written by the ingest and exported by %s", collection, where)
		}
	}
}

// TestFamilyCampDerivedManifestIsNotAnExportList is the family-camp half of the
// same claim TestLodgingCollectionsAreNeverExported makes about the ingest, and
// it is the half that matters most here: SyncJobToCollections["family_camp_derived"]
// lists family_camp_medical, which is the PHI collection this whole file exists
// to keep out of Google Sheets.
//
// The two lists look interchangeable and are not -- one is a write manifest, the
// other a publish list -- and the cost of confusing them is different for each
// job. For the ingest it is placement data; here it is medical narrative next to
// a person's name.
//
// Kept as a separate test rather than folded into the merge from #1880: that one
// is scoped to serviceNameLodgingAssignments and would not notice this.
func TestFamilyCampDerivedManifestIsNotAnExportList(t *testing.T) {
	exported := map[string]string{}
	for _, cfg := range GetReadableYearExports() {
		exported[cfg.Collection] = "GetReadableYearExports"
	}
	for _, cfg := range GetReadableGlobalExports() {
		exported[cfg.Collection] = "GetReadableGlobalExports"
	}

	written, ok := SyncJobToCollections[serviceNameFamilyCampDerived]
	if !ok {
		t.Fatalf("%q missing from SyncJobToCollections", serviceNameFamilyCampDerived)
	}

	sawPHICollection := false
	for _, collection := range written {
		if slices.Contains(phiCollections, collection) {
			sawPHICollection = true
		}
		if where, isExported := exported[collection]; isExported {
			t.Errorf("%s is both written by %s and exported by %s",
				collection, serviceNameFamilyCampDerived, where)
		}
	}

	// Without this the test drifts into vacuity the day the manifest stops
	// listing the PHI collection: the loop above would still pass, having
	// checked nothing that matters.
	if !sawPHICollection {
		t.Errorf("%q no longer writes any collection in phiCollections (%v); "+
			"either the manifest is wrong or this test needs rescoping",
			serviceNameFamilyCampDerived, phiCollections)
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
