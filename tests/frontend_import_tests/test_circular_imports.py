"""Test for circular imports in the codebase"""

import ast
from pathlib import Path
from typing import Any

import pytest


class ImportAnalyzer(ast.NodeVisitor):
    """Analyze Python files for import statements"""

    def __init__(self, module_path: str):
        self.module_path = module_path
        self.imports: set[str] = set()

    def visit_Import(self, node):
        """Handle 'import x' statements"""
        for alias in node.names:
            self.imports.add(alias.name)

    def visit_ImportFrom(self, node):
        """Handle 'from x import y' statements"""
        if node.module:
            # Handle relative imports
            if node.level > 0:
                # Relative import - need to resolve based on current module
                parts = self.module_path.split(".")
                # Go up 'level' directories
                if len(parts) > node.level:
                    base = ".".join(parts[: -node.level])
                    if node.module:
                        self.imports.add(f"{base}.{node.module}")
                    else:
                        self.imports.add(base)
            else:
                self.imports.add(node.module)


class CircularImportDetector:
    """Detect circular imports in Python codebase"""

    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.import_graph: dict[str, set[str]] = {}
        self.module_to_file: dict[str, Path] = {}

    def build_import_graph(self) -> None:
        """Build the import dependency graph"""
        # Directories to analyze
        dirs_to_analyze = ["scripts", "bunking"]

        for dir_name in dirs_to_analyze:
            dir_path = self.project_root / dir_name
            if not dir_path.exists():
                continue

            for py_file in dir_path.rglob("*.py"):
                # Skip test files and cache
                if "test" in py_file.parts or "__pycache__" in str(py_file):
                    continue

                # Skip __init__.py files that are usually empty
                if py_file.name == "__init__.py":
                    continue

                # Convert file path to module name
                relative_path = py_file.relative_to(self.project_root)
                module_name = str(relative_path).replace("/", ".").replace(".py", "")

                self.module_to_file[module_name] = py_file

                try:
                    with open(py_file, encoding="utf-8") as f:
                        tree = ast.parse(f.read())
                        analyzer = ImportAnalyzer(module_name)
                        analyzer.visit(tree)

                        # Filter imports to only include project modules
                        project_imports = set()
                        for imp in analyzer.imports:
                            # Check if this is a project import
                            if imp.startswith(("scripts.", "bunking.")):
                                # Normalize the import
                                base_module = imp.split(".")[0]
                                if base_module in dirs_to_analyze:
                                    project_imports.add(imp)

                        self.import_graph[module_name] = project_imports

                except (SyntaxError, UnicodeDecodeError) as e:
                    print(f"Warning: Could not parse {py_file}: {e}")

    def find_cycles(self) -> list[list[str]]:
        """Find all cycles in the import graph using DFS"""
        cycles: list[list[str]] = []
        visited = set()
        rec_stack = set()
        path = []

        def dfs(module: str) -> None:
            visited.add(module)
            rec_stack.add(module)
            path.append(module)

            for imported in self.import_graph.get(module, set()):
                # Handle submodule imports (e.g., if we import scripts.sync.base_sync,
                # we also implicitly import scripts.sync)
                modules_to_check = [imported]

                # Add parent modules
                parts = imported.split(".")
                for i in range(1, len(parts)):
                    parent = ".".join(parts[:i])
                    if parent in self.import_graph:
                        modules_to_check.append(parent)

                for check_module in modules_to_check:
                    if check_module in rec_stack:
                        # Found a cycle
                        cycle_start = path.index(check_module)
                        cycle = path[cycle_start:] + [check_module]
                        # Only add unique cycles
                        cycle_set = frozenset(cycle[:-1])  # Exclude duplicate end
                        if not any(frozenset(c[:-1]) == cycle_set for c in cycles):
                            cycles.append(cycle)
                    elif check_module not in visited and check_module in self.import_graph:
                        dfs(check_module)

            path.pop()
            rec_stack.remove(module)

        # Run DFS from all unvisited nodes
        for module in self.import_graph:
            if module not in visited:
                dfs(module)

        return cycles

    def analyze_cycle(self, cycle: list[str]) -> dict[str, Any]:
        """Analyze a cycle to provide more context"""
        files_list: list[str] = []
        analysis: dict[str, Any] = {
            "cycle": cycle,
            "length": len(cycle) - 1,  # -1 because last element repeats first
            "files": files_list,
        }

        for module in cycle[:-1]:  # Exclude duplicate
            if module in self.module_to_file:
                files_list.append(str(self.module_to_file[module]))

        return analysis


class TestCircularImports:
    """Test for circular imports in the codebase"""

    def test_no_circular_imports(self):
        """Ensure no circular imports exist in the codebase"""
        project_root = Path(__file__).resolve().parent.parent.parent

        detector = CircularImportDetector(project_root)
        detector.build_import_graph()

        cycles = detector.find_cycles()

        if cycles:
            # Analyze each cycle
            cycle_details = []
            for cycle in cycles:
                analysis = detector.analyze_cycle(cycle)
                cycle_details.append(analysis)

            # Format error message
            error_msg = "Circular imports detected:\n\n"
            for detail in cycle_details:
                error_msg += f"Cycle of length {detail['length']}:\n"
                error_msg += "  " + " -> ".join(detail["cycle"]) + "\n"
                error_msg += "  Files involved:\n"
                for f in detail["files"]:
                    error_msg += f"    - {f}\n"
                error_msg += "\n"

            pytest.fail(error_msg)

    def test_import_graph_statistics(self):
        """Provide statistics about the import graph (informational)"""
        project_root = Path(__file__).resolve().parent.parent.parent

        detector = CircularImportDetector(project_root)
        detector.build_import_graph()

        # Calculate statistics
        total_modules = len(detector.import_graph)
        total_imports = sum(len(imports) for imports in detector.import_graph.values())
        avg_imports = total_imports / total_modules if total_modules > 0 else 0

        # Find modules with most imports
        most_imports = sorted(
            [(module, len(imports)) for module, imports in detector.import_graph.items()],
            key=lambda x: x[1],
            reverse=True,
        )[:5]

        # Find most imported modules
        import_counts: dict[str, int] = {}
        for imports in detector.import_graph.values():
            for imp in imports:
                import_counts[imp] = import_counts.get(imp, 0) + 1

        most_imported = sorted(import_counts.items(), key=lambda x: x[1], reverse=True)[:5]

        # Print statistics (this is informational, not a failure)
        print("\n=== Import Graph Statistics ===")
        print(f"Total modules analyzed: {total_modules}")
        print(f"Total project imports: {total_imports}")
        print(f"Average imports per module: {avg_imports:.2f}")
        print("\nModules with most imports:")
        for module, count in most_imports:
            print(f"  {module}: {count} imports")
        print("\nMost imported modules:")
        for module, count in most_imported:
            print(f"  {module}: imported {count} times")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
