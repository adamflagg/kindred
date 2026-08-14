package sync

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// This file pins the kindred#2284 reclassification: which counter each per-record
// rejection increments.
//
// Almost every reject site sits inside a loop over records fetched from
// CampMinder, so reaching one from a test means standing up the whole HTTP feed.
// That is why the classification is pinned structurally instead. It is not a
// style check: `Stats.Errors` fails the run outright under kindred#2284's
// escalation, and `Stats.Rejected` is warn-only and skips the collection's orphan
// sweep (kindred#2295). Putting a site on the wrong counter is a behavior change
// in both directions, and the revert history on this branch shows it is exactly
// the edit that gets made by accident.

// The two counters kindred#2284 split Stats.Errors into.
const (
	counterErrors   = "Errors"
	counterRejected = "Rejected"
)

// rejectSite is one classified counter bump, identified by the file it lives in
// and the log line immediately above it.
type rejectSite struct {
	file    string
	message string
}

// expectedRejectSites is the complete list of per-record rejections in this
// package: an upstream record that could not be turned into a PocketBase row.
// Every one of them `continue`s past TrackProcessedKey, which is why they all
// have to be visible to the orphan sweep.
//
// Sites deliberately NOT here, and why:
//   - "Error processing X" / "Error saving X" -- App.Save and friends. Local
//     SQLite operations that did not complete: infrastructure, zero tolerance.
//   - household_demographics.go's sweep refusal -- a refusal is not a counted
//     failure at all; kindred#2283 moves it onto the returned-error channel.
//   - wrapper sites whose callee returns both classes (processAttendee,
//     ProcessSimpleRecord) -- they stay loud until kindred#2292 gives them typed
//     errors to tell apart.
func expectedRejectSites() []rejectSite {
	return []rejectSite{
		{"bunks.go", "Error transforming bunk"},
		{"bunks.go", "Invalid bunk ID type"},
		{"bunks.go", "Invalid year type in pbData"},
		{"custom_field_definitions.go", "Error transforming custom field definition"},
		{"custom_field_definitions.go", "Invalid custom field definition cm_id"},
		{"divisions.go", "Error transforming division"},
		{"divisions.go", "Invalid division cm_id"},
		{"financial_lookups.go", "Error transforming financial category"},
		{"financial_lookups.go", "Invalid financial category cm_id"},
		{"financial_lookups.go", "Error transforming payment method"},
		{"financial_lookups.go", "Invalid payment method cm_id"},
		{"financial_transactions.go", "Error transforming transaction"},
		{"financial_transactions.go", "Invalid transaction cm_id"},
		{"household_custom_field_values.go", "Invalid or missing field id in custom field value"},
		{"person_custom_field_values.go", "Invalid or missing field id in custom field value"},
		// kindred#2270: a second API entry for a (person|household, field_definition, year)
		// already tracked this run. Today's API shape makes this latent -- CampMinder packs
		// multi-selects into one delimited value string -- but before this guard the second
		// entry silently collapsed onto the first (Skipped/Updated/Errors depending on
		// timing) with nothing attributable. Same per-record upstream-shape rejection as the
		// "Invalid or missing field id" pair directly above; belongs on the same counter.
		{"household_custom_field_values.go", "Duplicate custom field value entry in this sync run, discarding"},
		{"person_custom_field_values.go", "Duplicate custom field value entry in this sync run, discarding"},
		{"person_tag_definitions.go", "Error transforming person tag definition"},
		{"person_tag_definitions.go", "Invalid person tag definition name"},
		{"persons.go", "Error transforming household"},
		{"session_groups.go", "Error transforming session group"},
		{"session_groups.go", "Invalid session group ID type"},
		{"sessions.go", "Error transforming session"},
		{"sessions.go", "Invalid session ID type"},
		{"sessions.go", "Invalid year type in pbData"},
		{"staff.go", "Error transforming staff record"},
		// The three kindred#2295 additions. Their `Error transforming ...` siblings
		// three lines up were reclassified in the first pass and these were missed,
		// even though they are the same per-record validation failure -- and the
		// identical branch in financial_lookups.go DID move.
		{"staff_lookups.go", "Error transforming program area"},
		{"staff_lookups.go", "Invalid program area cm_id"},
		{"staff_lookups.go", "Error transforming org category"},
		{"staff_lookups.go", "Invalid org category cm_id"},
		{"staff_lookups.go", "Error transforming position"},
		{"staff_lookups.go", "Invalid position cm_id"},
	}
}

// countedSite is a Stats counter bump whose reason the line above it names.
type countedSite struct {
	rejectSite
	counter string // counterErrors or counterRejected
	line    int
}

// collectCountedSites finds EVERY `<something>.Errors++` / `<something>.Rejected++`
// in the package, and classifies each by the slog call immediately above it.
//
// Collecting every bump, rather than only the ones it can classify, is the whole
// point (kindred#2299 row 3). The earlier version skipped a bump whose preceding
// statement was not an slog call with a string-literal message -- so an
// infrastructure failure counted as Rejected passed the census silently if it had
// no log line, or a fmt.Sprintf message, or logged at Info. Verified by injecting
// all three shapes at base_sync.go's failed-orphan-delete: the census stayed green.
//
// An allowlist that ignores what it cannot understand is the same false-green shape
// this campaign exists to remove, and this census is the only safety net over all 30
// sites. So a bump it cannot classify gets an empty message and is REPORTED, not
// dropped. Keying on the message rather than a line number is what keeps it from
// going stale the way kindred#2284's tables did.
func collectCountedSites(t *testing.T) []countedSite {
	t.Helper()

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package dir: %v", err)
	}

	var found []countedSite
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		fset := token.NewFileSet()
		parsed, parseErr := parser.ParseFile(fset, filepath.Join(".", name), nil, 0)
		if parseErr != nil {
			t.Fatalf("parse %s: %v", name, parseErr)
		}

		ast.Inspect(parsed, func(n ast.Node) bool {
			block, ok := n.(*ast.BlockStmt)
			if !ok {
				return true
			}
			for i, stmt := range block.List {
				counter, isCount := statsCounterBump(stmt)
				if !isCount {
					continue
				}
				// An unclassifiable bump keeps an empty message and is reported by
				// TestNoUnexpectedSiteUsesTheRejectedCounter rather than skipped.
				var message string
				if i > 0 {
					message, _ = slogMessage(block.List[i-1])
				}
				found = append(found, countedSite{
					rejectSite: rejectSite{file: name, message: message},
					counter:    counter,
					line:       fset.Position(stmt.Pos()).Line,
				})
			}
			return true
		})
	}
	return found
}

// statsCounterBump matches `x.Errors++` and `x.Rejected++` at any selector depth,
// so it sees both `s.Stats.Rejected++` and persons.go's `householdStats.Rejected++`.
func statsCounterBump(stmt ast.Stmt) (string, bool) {
	inc, ok := stmt.(*ast.IncDecStmt)
	if !ok || inc.Tok != token.INC {
		return "", false
	}
	sel, ok := inc.X.(*ast.SelectorExpr)
	if !ok {
		return "", false
	}
	if sel.Sel.Name != counterErrors && sel.Sel.Name != counterRejected {
		return "", false
	}
	return sel.Sel.Name, true
}

// slogMessage returns the literal first argument of an slog.Error/slog.Warn call.
func slogMessage(stmt ast.Stmt) (string, bool) {
	expr, ok := stmt.(*ast.ExprStmt)
	if !ok {
		return "", false
	}
	call, ok := expr.X.(*ast.CallExpr)
	if !ok || len(call.Args) == 0 {
		return "", false
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return "", false
	}
	pkg, ok := sel.X.(*ast.Ident)
	if !ok || pkg.Name != "slog" {
		return "", false
	}
	if sel.Sel.Name != "Error" && sel.Sel.Name != "Warn" {
		return "", false
	}
	lit, ok := call.Args[0].(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return "", false
	}
	msg, err := strconv.Unquote(lit.Value)
	if err != nil {
		return "", false
	}
	return msg, true
}

// TestPerRecordRejectionsUseTheRejectedCounter is the reclassification spec.
func TestPerRecordRejectionsUseTheRejectedCounter(t *testing.T) {
	t.Parallel()

	counterFor := map[rejectSite]string{}
	for _, site := range collectCountedSites(t) {
		counterFor[site.rejectSite] = site.counter
	}

	var wrong []string
	for _, want := range expectedRejectSites() {
		switch counterFor[want] {
		case counterRejected:
		case counterErrors:
			wrong = append(wrong, want.file+": "+want.message+" still counts as Stats.Errors")
		default:
			wrong = append(wrong, want.file+": "+want.message+" -- no counter bump found "+
				"below that log line (renamed or removed?)")
		}
	}
	sort.Strings(wrong)

	if len(wrong) > 0 {
		t.Errorf("%d per-record rejection(s) are on the wrong counter.\n"+
			"Stats.Errors fails the run outright; these are upstream data quality and belong "+
			"on Stats.Rejected, which also makes the orphan sweep skip the collection:\n  %s",
			len(wrong), strings.Join(wrong, "\n  "))
	}
}

// TestNoUnexpectedSiteUsesTheRejectedCounter is the other half. Rejected is
// warn-only AND it suppresses a collection's orphan sweep for the whole run, so
// moving an infrastructure failure onto it buys silence twice: the run reports
// green and the sweep stops. base_sync.go's "Failed to delete orphaned record" --
// a failed App.Delete -- is the site this exists to keep out. Cited by message
// rather than line number on purpose: the line it used to name has already moved
// once within this PR.
func TestNoUnexpectedSiteUsesTheRejectedCounter(t *testing.T) {
	t.Parallel()

	expected := map[rejectSite]bool{}
	for _, site := range expectedRejectSites() {
		expected[site] = true
	}

	var unexpected []string
	for _, site := range collectCountedSites(t) {
		if site.counter != counterRejected || expected[site.rejectSite] {
			continue
		}
		what := site.message
		if what == "" {
			what = "<unclassifiable: no slog.Error/Warn with a literal message above it>"
		}
		unexpected = append(unexpected,
			site.file+":"+strconv.Itoa(site.line)+": "+what)
	}
	sort.Strings(unexpected)

	if len(unexpected) > 0 {
		t.Errorf("%d site(s) count as Stats.Rejected without being listed as per-record "+
			"rejections.\nAdd them to expectedRejectSites with the reasoning, or move them "+
			"back to Stats.Errors. A site reported as <unclassifiable> is not exempt -- the "+
			"census refuses to ignore a bump it cannot read:\n  %s",
			len(unexpected), strings.Join(unexpected, "\n  "))
	}
}

// ---------------------------------------------------------------------------
// The IsNoOp consequence -- decided, not inherited
// ---------------------------------------------------------------------------

// TestIsNoOpIgnoresRejectedRecords records a deliberate decision, because the
// reclassification silently changes what IsNoOp means and the change would
// otherwise just fall out of the diff.
//
// Stats.IsNoOp tests Created, Updated, Deleted and Errors, and it gates
// GetChangedCollections, which is what lets the Google Sheets export skip
// collections whose data did not move. Before this PR the 30 reject sites
// incremented Errors, so a run that rejected 500 records and wrote nothing was
// non-no-op and forced an export. After it, that run is a no-op and the export is
// skipped.
//
// That is the right answer, and Errors' presence in IsNoOp is what shows why the
// two counters differ here. An Errors site means a write was ATTEMPTED and its
// outcome is unknown -- App.Save came back with an error, so "nothing changed"
// cannot be asserted and the export has to run. A rejected record never reached
// the database at all: the transform failed and the row was never touched, so the
// stored data is byte-identical to what was exported last time.
//
// The alternative is worse than it looks. Rejections are expected to be routine
// -- that is the entire reason kindred#2284 made them warn-only -- so folding
// Rejected into IsNoOp would permanently defeat the skip optimisation for any
// service carrying one piece of persistently malformed upstream data, exporting
// unchanged collections on every run forever.
//
// A skipped orphan sweep (kindred#2295) does not change this. Skipping means rows
// that would have been deleted were not, which is still nothing written.
func TestIsNoOpIgnoresRejectedRecords(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		stats Stats
		want  bool
	}{
		{"an empty run is a no-op", Stats{}, true},
		{"rejections alone leave the database untouched", Stats{Rejected: 500}, true},
		{"a rejection alongside a write is not a no-op", Stats{Created: 1, Rejected: 500}, false},
		{"an infrastructure error is never a no-op", Stats{Errors: 1}, false},
		{"a skipped record is not a change", Stats{Skipped: 20}, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			stats := tc.stats
			if got := stats.IsNoOp(); got != tc.want {
				t.Errorf("IsNoOp() = %v, want %v for %+v", got, tc.want, tc.stats)
			}
		})
	}
}
