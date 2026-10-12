package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

// TestMainRestrictsNewFilesFirst pins that main() sets the private umask as its
// very first statement -- before logging, before pocketbase.New(), and so
// before anything opens pb_data. Both kindred-pocketbase (`pocketbase serve`)
// and kindred-init (`pocketbase superuser upsert`) enter here, and both images
// are distroless enough that no shell runs `umask` for them. A umask set any
// later would leave whatever was created before it at the library's 0644.
// pocketbase/fileperm tests what the call does; this tests that it is made.
func TestMainRestrictsNewFilesFirst(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "main.go", nil, 0)
	if err != nil {
		t.Fatalf("parse main.go: %v", err)
	}

	var mainFn *ast.FuncDecl
	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && fn.Recv == nil && fn.Name.Name == "main" {
			mainFn = fn
		}
	}
	if mainFn == nil || len(mainFn.Body.List) == 0 {
		t.Fatal("main.go has no non-empty func main()")
	}

	first, ok := mainFn.Body.List[0].(*ast.ExprStmt)
	if !ok {
		t.Fatalf("main()'s first statement is %T, want a call to fileperm.RestrictNewFiles()", mainFn.Body.List[0])
	}
	call, ok := first.X.(*ast.CallExpr)
	if !ok {
		t.Fatal("main()'s first statement is not a call; want fileperm.RestrictNewFiles()")
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		t.Fatal("main()'s first call is not a package selector; want fileperm.RestrictNewFiles()")
	}
	pkg, ok := sel.X.(*ast.Ident)
	if !ok || pkg.Name != "fileperm" || sel.Sel.Name != "RestrictNewFiles" {
		t.Fatal("main()'s first call is not fileperm.RestrictNewFiles()")
	}
}
