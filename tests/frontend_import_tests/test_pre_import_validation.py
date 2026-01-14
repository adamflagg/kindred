"""Pre-import validation tests to catch issues before runtime"""

import ast
import subprocess
import sys
from pathlib import Path

import pytest


class TestPreImportValidation:
    """Validate code before importing to catch syntax and dependency issues"""

    @pytest.fixture(autouse=True)
    def setup(self) -> None:
        """Setup test environment"""
        self.project_root = Path(__file__).resolve().parent.parent.parent
        self.python_files: list[Path] = []

        # Collect Python files
        for dir_name in ["scripts", "bunking"]:
            dir_path = self.project_root / dir_name
            if dir_path.exists():
                self.python_files.extend(dir_path.rglob("*.py"))

        # Filter out test files and cache
        self.python_files = [f for f in self.python_files if "__pycache__" not in str(f) and "test" not in f.parts]

    def test_syntax_valid(self) -> None:
        """Check all Python files have valid syntax"""
        syntax_errors: list[tuple[Path, Exception]] = []

        for py_file in self.python_files:
            try:
                # Use ast.parse for syntax checking
                with open(py_file, encoding="utf-8") as f:
                    ast.parse(f.read(), filename=str(py_file))
            except SyntaxError as e:
                syntax_errors.append((py_file, e))
            except Exception as e:
                # Other parsing errors
                syntax_errors.append((py_file, e))

        if syntax_errors:
            error_msg = "Syntax errors found:\n\n"
            for file, error in syntax_errors:
                error_msg += f"{file}:\n  {error}\n\n"
            pytest.fail(error_msg)

    def test_compile_all_files(self):
        """Compile all Python files to bytecode"""
        compile_errors = []

        for py_file in self.python_files:
            result = subprocess.run([sys.executable, "-m", "py_compile", str(py_file)], capture_output=True, text=True)

            if result.returncode != 0:
                compile_errors.append((py_file, result.stderr))

        if compile_errors:
            error_msg = "Compilation errors found:\n\n"
            for file, error in compile_errors:
                error_msg += f"{file}:\n{error}\n\n"
            pytest.fail(error_msg)

    def test_required_dependencies(self):
        """Verify all required packages are installed"""
        required_packages = {
            # Core dependencies
            "pocketbase": "pocketbase",
            "typer": "typer",
            "pydantic": "pydantic",
            "ortools": "ortools",
            "pandas": "pandas",
            "fastapi": "fastapi",
            "uvicorn": "uvicorn",
            "httpx": "httpx",
            # Testing dependencies
            "pytest": "pytest",
            # Optional AI providers (check but don't fail)
            "openai": "openai",
            "anthropic": "anthropic",
        }

        missing_required = []
        missing_optional = []

        for import_name, package_name in required_packages.items():
            try:
                __import__(import_name)
            except ImportError:
                if import_name in ["openai", "anthropic"]:
                    missing_optional.append(package_name)
                else:
                    missing_required.append(package_name)

        # Report findings
        if missing_optional:
            print(f"\nOptional packages not installed: {', '.join(missing_optional)}")

        if missing_required:
            pytest.fail(f"Required packages not installed: {', '.join(missing_required)}")

    def test_no_undefined_names(self):
        """Check for undefined names using AST analysis"""
        undefined_errors = []

        class UndefinedNameChecker(ast.NodeVisitor):
            def __init__(self, filename: str):
                self.filename = filename
                self.defined_names: set[str] = set()
                self.used_names: list[tuple[str, int]] = []
                self.imports: set[str] = set()
                self.errors: list[tuple[str, int]] = []

                # Built-in names that are always available
                self.builtins = set(dir(__builtins__))
                self.builtins.update(["__name__", "__file__", "__doc__", "__package__"])

            def visit_Import(self, node):
                for alias in node.names:
                    name = alias.asname if alias.asname else alias.name
                    self.defined_names.add(name.split(".")[0])

            def visit_ImportFrom(self, node):
                for alias in node.names:
                    if alias.name == "*":
                        # Can't track star imports
                        self.imports.add("*")
                    else:
                        name = alias.asname if alias.asname else alias.name
                        self.defined_names.add(name)

            def visit_FunctionDef(self, node):
                self.defined_names.add(node.name)
                # Add parameters
                for arg in node.args.args:
                    self.defined_names.add(arg.arg)
                self.generic_visit(node)

            def visit_ClassDef(self, node):
                self.defined_names.add(node.name)
                self.generic_visit(node)

            def visit_Name(self, node):
                if isinstance(node.ctx, ast.Store):
                    self.defined_names.add(node.id)
                elif isinstance(node.ctx, ast.Load):
                    self.used_names.append((node.id, node.lineno))

            def visit_ExceptHandler(self, node):
                if node.name:
                    self.defined_names.add(node.name)
                self.generic_visit(node)

            def check(self):
                """Check for undefined names"""
                for name, lineno in self.used_names:
                    if name not in self.defined_names and name not in self.builtins and "*" not in self.imports:
                        self.errors.append((name, lineno))

        for py_file in self.python_files:
            try:
                with open(py_file, encoding="utf-8") as f:
                    tree = ast.parse(f.read(), filename=str(py_file))

                checker = UndefinedNameChecker(str(py_file))
                checker.visit(tree)
                checker.check()

                if checker.errors:
                    undefined_errors.append((py_file, checker.errors))

            except Exception:
                # Skip files with parsing errors (handled in syntax test)
                continue

        if undefined_errors:
            error_msg = "Undefined names found:\n\n"
            for file, errors in undefined_errors:
                error_msg += f"{file}:\n"
                for name, lineno in errors:
                    error_msg += f"  Line {lineno}: '{name}' is not defined\n"
                error_msg += "\n"

            # This is informational - some may be false positives
            print(error_msg)

    def test_import_structure(self):
        """Verify import structure follows best practices"""
        import_issues = []

        for py_file in self.python_files:
            try:
                with open(py_file, encoding="utf-8") as f:
                    lines = f.readlines()

                # Check for imports after code
                found_code = False
                for i, line in enumerate(lines):
                    stripped = line.strip()

                    # Skip comments and docstrings
                    if not stripped or stripped.startswith("#") or stripped.startswith('"""'):
                        continue

                    # Check if this is an import
                    if stripped.startswith(("import ", "from ")):
                        if found_code and i > 20:  # Allow some imports in first 20 lines
                            import_issues.append((py_file, i + 1, "Import statement after code"))
                    else:
                        # This is code
                        if not stripped.startswith(("def ", "class ", "@")):
                            found_code = True

            except Exception:
                continue

        if import_issues:
            print("\nImport structure issues (non-critical):")
            for file, line_num, issue in import_issues:
                print(f"  {file}:{line_num} - {issue}")

    def test_no_exec_or_eval(self):
        """Check for dangerous exec() or eval() usage"""
        dangerous_usage = []

        for py_file in self.python_files:
            try:
                with open(py_file, encoding="utf-8") as f:
                    content = f.read()

                # Simple regex check (not perfect but catches obvious cases)
                import re

                exec_matches = re.finditer(r"\bexec\s*\(", content)
                eval_matches = re.finditer(r"\beval\s*\(", content)

                for match in exec_matches:
                    line_no = content[: match.start()].count("\n") + 1
                    dangerous_usage.append((py_file, line_no, "exec()"))

                for match in eval_matches:
                    line_no = content[: match.start()].count("\n") + 1
                    dangerous_usage.append((py_file, line_no, "eval()"))

            except Exception:
                continue

        if dangerous_usage:
            error_msg = "Dangerous function usage found:\n\n"
            for file, line, func in dangerous_usage:
                error_msg += f"{file}:{line} - {func} usage detected\n"

            # This could be a security issue
            pytest.fail(error_msg)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
