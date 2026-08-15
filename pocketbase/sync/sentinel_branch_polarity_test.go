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

// This file pins the OTHER half of kindred#2292's classification, the half
// rejection_sites_test.go's census cannot see.
//
// TestPerRecordRejectionsUseTheRejectedCounter proves a "Rejected ..." slog
// line sits directly above a Stats.Rejected++ bump. It does not look at the
// `if errors.Is(err, errRejectedRecord)` condition that sends control to that
// bump at all -- it only reads the statement immediately preceding the
// counter. So a polarity swap at one of the nine call sites this issue added
// -- `if errors.Is(...)` flipped to `if !errors.Is(...)` -- moves BOTH
// branches' bodies (log line and counter bump together) to the opposite
// condition, and the census reads whichever line still sits above
// Rejected++ as correct. It stays green.
//
// Verified by hand against bunks.go's call site: inverting its condition
// alone leaves `go test ./sync/` green without this file.
//
// This test reads the branch condition directly instead: every `if
// errors.Is(_, errRejectedRecord)` (or its negation) in the package must
// route its own body to Rejected and the sibling branch to Errors, with the
// bodies on the correct side of the negation.
func TestSentinelBranchesRouteToTheRightCounter(t *testing.T) {
	t.Parallel()

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package dir: %v", err)
	}

	var mismatches []string
	var sawAny bool

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
			ifStmt, ok := n.(*ast.IfStmt)
			if !ok {
				return true
			}
			negated, isSentinelCheck := sentinelCondition(ifStmt.Cond)
			if !isSentinelCheck {
				return true
			}
			sawAny = true
			line := fset.Position(ifStmt.Pos()).Line

			// errors.Is(...) true means rejected; !errors.Is(...) true means
			// NOT rejected -- i.e. it means infra. Map "then" and "else" onto
			// "rejected branch" / "errors branch" accordingly.
			//
			// ifStmt.Else is walked as a plain ast.Node rather than required to
			// be a *ast.BlockStmt: attendees.go's call site chains a second
			// `else if` onto the infra-error side (an idx_attendees_unique
			// collision diagnostic) before its final `else`, and Errors++ can
			// live in either arm of that chain.
			var thenNode, elseNode ast.Node = ifStmt.Body, ifStmt.Else
			if elseNode == nil {
				mismatches = append(mismatches, name+":"+strconv.Itoa(line)+
					": errors.Is(_, errRejectedRecord) branch has no else at all "+
					"to hold the infra-error counter")
				return true
			}

			rejectedNode, errorsNode := thenNode, elseNode
			if negated {
				rejectedNode, errorsNode = elseNode, thenNode
			}

			if !nodeBumpsCounter(rejectedNode, counterRejected) {
				mismatches = append(mismatches, name+":"+strconv.Itoa(line)+
					": the errors.Is(_, errRejectedRecord)-true branch does not bump Stats.Rejected")
			}
			if !nodeBumpsCounter(errorsNode, counterErrors) {
				mismatches = append(mismatches, name+":"+strconv.Itoa(line)+
					": the errors.Is(_, errRejectedRecord)-false branch does not bump Stats.Errors")
			}
			return true
		})
	}

	if !sawAny {
		t.Fatal("found no `errors.Is(_, errRejectedRecord)` branch in the package -- " +
			"has the sentinel been renamed or removed out from under this test?")
	}

	sort.Strings(mismatches)
	if len(mismatches) > 0 {
		t.Errorf("%d sentinel branch(es) route to the wrong counter (or a polarity-inverted "+
			"one has swapped which side is which):\n  %s",
			len(mismatches), strings.Join(mismatches, "\n  "))
	}
}

// sentinelCondition reports whether cond is `errors.Is(x, errRejectedRecord)`
// or its negation `!errors.Is(x, errRejectedRecord)`, and if so, whether it
// was negated.
func sentinelCondition(cond ast.Expr) (negated, ok bool) {
	if unary, isUnary := cond.(*ast.UnaryExpr); isUnary && unary.Op == token.NOT {
		_, inner := sentinelCondition(unary.X)
		if inner {
			return true, true
		}
		return false, false
	}

	call, isCall := cond.(*ast.CallExpr)
	if !isCall || len(call.Args) != 2 {
		return false, false
	}
	sel, isSel := call.Fun.(*ast.SelectorExpr)
	if !isSel || sel.Sel.Name != "Is" {
		return false, false
	}
	pkgIdent, isIdent := sel.X.(*ast.Ident)
	if !isIdent || pkgIdent.Name != "errors" {
		return false, false
	}
	secondArg, isIdent := call.Args[1].(*ast.Ident)
	if !isIdent || secondArg.Name != "errRejectedRecord" {
		return false, false
	}
	return false, true
}

// nodeBumpsCounter reports whether node contains a `x.<counter>++` bump
// anywhere within it (not just as a direct statement, so it also sees one
// nested inside a further if/else the wrapper's branch might add).
func nodeBumpsCounter(node ast.Node, counter string) bool {
	found := false
	ast.Inspect(node, func(n ast.Node) bool {
		inc, isInc := n.(*ast.IncDecStmt)
		if !isInc || inc.Tok != token.INC {
			return true
		}
		sel, isSel := inc.X.(*ast.SelectorExpr)
		if !isSel || sel.Sel.Name != counter {
			return true
		}
		found = true
		return true
	})
	return found
}
