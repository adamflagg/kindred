package sync

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// This guard is the Go half of kindred#3195, which escaped every PocketBase
// filter value on the Python side and left about thirty Go sync filters that
// pasted values straight into a quoted filter string:
//
//	fmt.Sprintf("id = '%s'", sessionID)
//
// That #3195 guard walks only api/, bunking/ and scripts/, which is how these
// were missed. A value carrying a quote rewrites such a filter -- `x' || id != '`
// turns "this id" into "every row" -- and sync reads PocketBase as superuser,
// so no collection rule stands behind it. The fix everywhere is the idiom this
// module already used in fifty places: a `{:name}` placeholder bound through
// dbx.Params, which PocketBase quotes itself.
//
// The rules mirror #3195's, applied to the Go forms a filter is built from:
//
//   - A QUOTED hole after a comparison operator ("= '%s'", "~ \"%v\"", or a
//     concatenation "= '" + x + "'") always fails. There is no escape helper
//     to bless here, because the placeholder needs none.
//   - An UNQUOTED hole after an operator must be numeric: %d in a format
//     string, or strconv.Itoa / FormatInt in a concatenation. "year = %s" fed
//     a pre-formatted int is safe today and indistinguishable from an
//     injection to a reader, so it fails too.
//
// It walks every non-test .go file in the pocketbase module, not just this
// package, so a filter in rbac/ or audit/ is held to the same line.

// filterHoleExemptions lists format strings that look like a filter to the
// guard but are not PocketBase filters. Each needs a reason a reviewer can
// check; a PocketBase filter never belongs here.
var filterHoleExemptions = map[string]string{
	"google/drive.go|name='%s' and '%s' in parents and mimeType='%s' and trashed=false": "Google Drive " +
		"query language, not a PocketBase filter; the one free-text value (name) goes through " +
		"escapeQueryString, the Drive API's own escaping",
	"aidform/parse.go|monthly: ×12 = %s": "a parse note staff read on an aid form response (rent or " +
		"mortgage typed per month, read ×12), not a PocketBase filter; the value is a formatted dollar amount",
}

// formatVerb matches one fmt verb, flags, width, precision and explicit
// argument indexes included.
var formatVerb = regexp.MustCompile(`%(?:\[\d+\])?[-+# 0]*` + // arg index, flags
	`(?:\d+|\*|\[\d+\]\*)?(?:\.(?:\d+|\*|\[\d+\]\*)?)?` + // width, precision
	`(?:\[\d+\])?[a-zA-Z%]`) // arg index, verb

// filterHoleSite is one offending hole.
type filterHoleSite struct {
	file string
	line int
	what string
}

func (s filterHoleSite) String() string {
	return s.file + ":" + strconv.Itoa(s.line) + ": " + s.what
}

// endsWithComparison reports whether text, trailing spaces removed, ends in a
// PocketBase comparison operator. Every operator in the filter grammar ends in
// one of these four runes: =, !=, >, >=, <, <=, ~, !~ and their ?-prefixed
// any-of forms.
func endsWithComparison(text string) bool {
	text = strings.TrimRight(text, " \t")
	if text == "" {
		return false
	}
	switch text[len(text)-1] {
	case '=', '~', '<', '>':
		return true
	}
	return false
}

// classifyHole decides whether the text in front of a hole makes that hole
// unsafe. It returns a description of the problem, or "" when the hole is not
// a filter value or is a numeric one.
func classifyHole(prefix string, numeric bool) string {
	trimmed := strings.TrimRight(prefix, " \t")
	if strings.HasSuffix(trimmed, "'") || strings.HasSuffix(trimmed, `"`) {
		if endsWithComparison(trimmed[:len(trimmed)-1]) {
			return "quoted value pasted into a filter"
		}
		return ""
	}
	// An unquoted hole counts only with whitespace between it and the operator.
	// PocketBase needs spaces around every operator (pocketbase/CLAUDE.md), so a
	// real filter reads "year = %d", while "session=%s" is a key=value log label.
	if trimmed != prefix && endsWithComparison(trimmed) && !numeric {
		return "unquoted non-numeric value pasted into a filter"
	}
	return ""
}

// sprintfHoles checks every verb of one fmt.Sprintf format string.
func sprintfHoles(format string) []string {
	var problems []string
	for _, loc := range formatVerb.FindAllStringIndex(format, -1) {
		verb := format[loc[0]:loc[1]]
		if verb == "%%" {
			continue
		}
		numeric := strings.HasSuffix(verb, "d")
		if problem := classifyHole(format[:loc[0]], numeric); problem != "" {
			problems = append(problems, problem+": "+verb+" in "+strconv.Quote(format))
		}
	}
	return problems
}

// flattenConcat returns the operands of a `+` chain, left to right.
func flattenConcat(e ast.Expr) []ast.Expr {
	if bin, ok := e.(*ast.BinaryExpr); ok && bin.Op == token.ADD {
		return append(flattenConcat(bin.X), flattenConcat(bin.Y)...)
	}
	if paren, ok := e.(*ast.ParenExpr); ok {
		return flattenConcat(paren.X)
	}
	return []ast.Expr{e}
}

// isNumericConversion reports whether e is a strconv call that can only
// produce digits (and a sign).
func isNumericConversion(e ast.Expr) bool {
	call, ok := e.(*ast.CallExpr)
	if !ok {
		return false
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	pkg, ok := sel.X.(*ast.Ident)
	if !ok || pkg.Name != "strconv" {
		return false
	}
	switch sel.Sel.Name {
	case "Itoa", "FormatInt", "FormatUint":
		return true
	}
	return false
}

// concatHoles checks the holes of one `+` chain. It sees a chain only from its
// outermost `+`, so a nested chain is not reported twice.
func concatHoles(operands []ast.Expr) []string {
	var problems []string
	for i := 1; i < len(operands); i++ {
		prev, ok := stringLitValue(operands[i-1])
		if !ok {
			continue
		}
		if _, isLit := stringLitValue(operands[i]); isLit {
			continue
		}
		if problem := classifyHole(prev, isNumericConversion(operands[i])); problem != "" {
			problems = append(problems, problem+": "+strconv.Quote(prev)+" + <expr>")
		}
	}
	return problems
}

// collectFilterHoleSites walks the pocketbase module rooted at root and
// returns every hole the rules above reject, exemptions applied.
func collectFilterHoleSites(t *testing.T, root string) []filterHoleSite {
	t.Helper()

	var found []filterHoleSite
	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			name := d.Name()
			if path != root && (strings.HasPrefix(name, ".") || name == "vendor" ||
				name == "testdata" || name == "node_modules" || name == "pb_data") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return fmt.Errorf("relative path of %s: %w", path, relErr)
		}
		rel = filepath.ToSlash(rel)

		fset := token.NewFileSet()
		parsed, parseErr := parser.ParseFile(fset, path, nil, 0)
		if parseErr != nil {
			t.Fatalf("parse %s: %v", rel, parseErr)
		}

		ast.Inspect(parsed, func(n ast.Node) bool {
			switch node := n.(type) {
			case *ast.CallExpr:
				sel, ok := node.Fun.(*ast.SelectorExpr)
				if !ok || sel.Sel.Name != "Sprintf" || len(node.Args) == 0 {
					return true
				}
				if pkg, isIdent := sel.X.(*ast.Ident); !isIdent || pkg.Name != "fmt" {
					return true
				}
				format, ok := stringLitValue(node.Args[0])
				if !ok {
					return true
				}
				if _, exempt := filterHoleExemptions[rel+"|"+format]; exempt {
					return true
				}
				for _, problem := range sprintfHoles(format) {
					found = append(found, filterHoleSite{rel, fset.Position(node.Pos()).Line, problem})
				}
			case *ast.BinaryExpr:
				if node.Op != token.ADD {
					return true
				}
				for _, problem := range concatHoles(flattenConcat(node)) {
					found = append(found, filterHoleSite{rel, fset.Position(node.Pos()).Line, problem})
				}
				// The chain is fully checked; do not re-check its inner `+` nodes.
				return false
			}
			return true
		})
		return nil
	})
	if walkErr != nil {
		t.Fatalf("walk %s: %v", root, walkErr)
	}
	return found
}

// TestNoPocketBaseFilterPastesInAValue fails the moment a Go filter pastes a
// value into its text instead of binding it with a {:name} placeholder.
func TestNoPocketBaseFilterPastesInAValue(t *testing.T) {
	t.Parallel()

	sites := collectFilterHoleSites(t, "..")
	lines := make([]string, 0, len(sites))
	for _, site := range sites {
		lines = append(lines, site.String())
	}
	sort.Strings(lines)

	if len(lines) > 0 {
		t.Errorf("%d PocketBase filter hole(s) paste a value into the filter text (kindred#3195). "+
			"Bind it instead: `\"id = {:id}\"` plus `dbx.Params{\"id\": id}` as the trailing "+
			"argument of FindRecordsByFilter / FindFirstRecordByFilter:\n  %s",
			len(lines), strings.Join(lines, "\n  "))
	}
}

// TestFilterHoleGuardCatchesEachForm proves the rules on fixed inputs, so a
// guard that silently stopped matching cannot pass by finding nothing.
func TestFilterHoleGuardCatchesEachForm(t *testing.T) {
	t.Parallel()

	rejected := []string{
		"id = '%s'",
		"bunk = '%s' && session = '%s' && year = %d",
		"snapshot_datetime ~ '%s'",
		"created < '%s'",
		`field = "%v"`,
		"%s = '%s'",
		"year = %s",
		"session = %v",
		"id = '%[1]s'",
		"name >= '%-10s'",
	}
	for _, format := range rejected {
		if len(sprintfHoles(format)) == 0 {
			t.Errorf("guard accepted %q; it pastes a value into a filter", format)
		}
	}

	accepted := []string{
		"id = {:id}",
		"year = %d && session_cm_id = %d",
		"(%s) && year = %d",
		"%s && year = %d",
		"%s|%d",
		"invalid session '%s': must be 'all' or a numeric cm_id",
		"100%% done: %s",
		"%s(session=%s,bunk=%s,person=%s)",
	}
	for _, format := range accepted {
		if problems := sprintfHoles(format); len(problems) > 0 {
			t.Errorf("guard rejected %q: %v", format, problems)
		}
	}
}

// TestFilterHoleGuardCatchesConcatenation proves the `+` rule on parsed
// expressions, the form lodging_session_attribution.go once used.
func TestFilterHoleGuardCatchesConcatenation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		expr   string
		reject bool
	}{
		{`"session_type = '" + st + "'"`, true},
		{`"year = " + yearStr`, true},
		{`"field_cm_id = " + strconv.Itoa(id)`, false},
		{`"prefix: " + name`, false},
		{`"a" + "b"`, false},
	}
	for _, tc := range cases {
		expr, err := parser.ParseExpr(tc.expr)
		if err != nil {
			t.Fatalf("parse %s: %v", tc.expr, err)
		}
		got := len(concatHoles(flattenConcat(expr))) > 0
		if got != tc.reject {
			t.Errorf("%s: rejected=%v, want %v", tc.expr, got, tc.reject)
		}
	}
}
