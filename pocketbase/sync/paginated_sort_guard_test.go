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

// This guard pins kindred#2338: FindRecordsByFilter(collection, filter, sort,
// perPage, offset, ...) only emits an ORDER BY when its sort argument is
// non-empty -- verified against the module source at
// pocketbase@v0.39.x/core/record_query.go:398-407, where `offset` and `limit`
// are applied unconditionally below the `if sort != ""` block that builds the
// ordering. A read that WALKS pages -- i.e. its offset argument varies across
// calls rather than always being the literal 0 -- is therefore free to skip a
// row or return one twice across page boundaries the moment the SQLite planner
// picks a different index, completely silently. sortByID (base_sync.go) is the
// fix: pass it (or any other explicit sort) at every walked read.
//
// A single-record lookup ("", 1, 0) and an unpaginated fetch-all ("", 0, 0)
// carry none of this hazard -- their offset is always the literal 0, so there
// is no second page to disagree with the first about row order -- which is why
// this guard keys specifically on "offset is not the literal 0", not on
// "perPage looks large" or any other proxy for pagination.
//
// The guard deliberately carries no allowlist: every paginated read in this
// package passes an explicit sort, so a new violation is always a new mistake.

// paginatedSortSite is one offending FindRecordsByFilter call.
type paginatedSortSite struct {
	file       string
	collection string
	line       int
}

// collectPaginatedSortSites walks every non-test .go file in this package and
// returns one entry per FindRecordsByFilter call whose sort argument is the
// empty string literal AND whose offset argument (5th positional arg) is
// anything other than the literal 0.
func collectPaginatedSortSites(t *testing.T) []paginatedSortSite {
	t.Helper()

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package dir: %v", err)
	}

	var found []paginatedSortSite
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
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || sel.Sel.Name != "FindRecordsByFilter" {
				return true
			}
			// collection, filter, sort, perPage, offset, [optFilterParams...]
			if len(call.Args) < 5 {
				return true
			}
			if !isEmptyStringLit(call.Args[2]) {
				return true
			}
			if isZeroIntLit(call.Args[4]) {
				return true
			}
			collection, ok := stringLitValue(call.Args[0])
			if !ok {
				collection = "<non-literal collection expr>"
			}
			found = append(found, paginatedSortSite{
				file:       name,
				collection: collection,
				line:       fset.Position(call.Pos()).Line,
			})
			return true
		})
	}
	return found
}

func isEmptyStringLit(e ast.Expr) bool {
	lit, ok := e.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return false
	}
	v, err := strconv.Unquote(lit.Value)
	return err == nil && v == ""
}

func isZeroIntLit(e ast.Expr) bool {
	lit, ok := e.(*ast.BasicLit)
	return ok && lit.Kind == token.INT && lit.Value == "0"
}

func stringLitValue(e ast.Expr) (string, bool) {
	lit, ok := e.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return "", false
	}
	v, err := strconv.Unquote(lit.Value)
	if err != nil {
		return "", false
	}
	return v, true
}

// TestNoPaginatedReadWalksWithAnEmptySort is the kindred#2338 guard. It fails
// the moment a NEW FindRecordsByFilter call walks pages (a non-literal-0
// offset) with an empty sort -- which is exactly how this class of bug has
// reappeared before: a service written by copying a sibling, with the sibling's
// missing sort argument copied right along with it.
func TestNoPaginatedReadWalksWithAnEmptySort(t *testing.T) {
	t.Parallel()

	sites := collectPaginatedSortSites(t)
	unexpected := make([]string, 0, len(sites))
	for _, site := range sites {
		unexpected = append(unexpected, site.file+":"+strconv.Itoa(site.line)+
			": FindRecordsByFilter(\""+site.collection+"\", ..., \"\", perPage, offset) walks "+
			"pages with no ORDER BY -- pass sortByID (base_sync.go)")
	}
	sort.Strings(unexpected)

	if len(unexpected) > 0 {
		t.Errorf("%d paginated read(s) walk LIMIT/OFFSET with an empty sort (kindred#2338):\n  %s",
			len(unexpected), strings.Join(unexpected, "\n  "))
	}
}
