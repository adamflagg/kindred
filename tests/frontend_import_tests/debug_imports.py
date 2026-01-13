#!/usr/bin/env python3
"""Tool to trace and debug import issues

Usage:
    python debug_imports.py <module_name>
    python debug_imports.py scripts.sync.base_sync
    python debug_imports.py --trace scripts.sync.sync_01_camp_sessions
"""

import argparse
import ast
import importlib
import importlib.util
import sys
from pathlib import Path
from typing import Any


class ImportTracer:
    """Trace imports and their dependencies"""

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.imported_modules: set[str] = set()
        self.import_stack: list[str] = []
        self.errors: list[dict[str, Any]] = []

    def trace_import(self, module_name: str, depth: int = 0) -> bool:
        """Trace the import process for a module"""
        indent = "  " * depth

        print(f"{indent}Attempting to import: {module_name}")

        # Avoid circular imports
        if module_name in self.import_stack:
            print(f"{indent}⚠️  Circular import detected! Already importing: {module_name}")
            return False

        self.import_stack.append(module_name)

        try:
            # Find module spec
            spec = importlib.util.find_spec(module_name)
            if spec is None:
                error = f"Module {module_name} not found"
                print(f"{indent}❌ ERROR: {error}")
                self.errors.append({"module": module_name, "error": error})
                return False

            if spec.origin:
                print(f"{indent}📁 Found at: {spec.origin}")

                # Analyze imports in the module
                if self.verbose and Path(spec.origin).suffix == ".py":
                    imports = self._analyze_imports(spec.origin)
                    if imports:
                        print(f"{indent}📦 Direct imports:")
                        for imp in sorted(imports):
                            print(f"{indent}    - {imp}")

            # Try to import
            module = importlib.import_module(module_name)
            print(f"{indent}✅ SUCCESS: Module imported")

            if self.verbose:
                attrs = [attr for attr in dir(module) if not attr.startswith("_")]
                print(f"{indent}🔧 Public attributes: {', '.join(attrs[:10])}" + ("..." if len(attrs) > 10 else ""))

            self.imported_modules.add(module_name)
            return True

        except ImportError as e:
            print(f"{indent}❌ ImportError: {e}")
            self.errors.append({"module": module_name, "error": str(e)})

            # Try to identify the problematic import
            if "cannot import name" in str(e):
                print(f"{indent}💡 Hint: Check if the imported name exists in the module")
            elif "No module named" in str(e):
                missing = str(e).split("'")[1]
                print(f"{indent}💡 Hint: Missing module '{missing}' - install it or check the import path")

            return False

        except Exception as e:
            print(f"{indent}❌ ERROR: {type(e).__name__}: {e}")
            self.errors.append({"module": module_name, "error": f"{type(e).__name__}: {e}"})

            if self.verbose:
                import traceback

                print(f"{indent}Stack trace:")
                traceback.print_exc()

            return False

        finally:
            self.import_stack.pop()

    def _analyze_imports(self, file_path: str) -> set[str]:
        """Analyze imports in a Python file"""
        imports = set()

        try:
            with open(file_path, encoding="utf-8") as f:
                tree = ast.parse(f.read())

            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        imports.add(alias.name)
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        imports.add(node.module)

        except Exception:
            pass

        return imports

    def check_dependencies(self, module_name: str) -> None:
        """Check all dependencies of a module"""
        print(f"\n🔍 Checking dependencies for: {module_name}")

        spec = importlib.util.find_spec(module_name)
        if not spec or not spec.origin:
            print("❌ Module not found")
            return

        imports = self._analyze_imports(spec.origin)

        print(f"\n📦 Found {len(imports)} direct imports")

        # Check each import
        failed_imports = []
        for imp in sorted(imports):
            # Skip built-in modules
            if imp in sys.builtin_module_names:
                continue

            # Try to import
            try:
                importlib.import_module(imp)
                print(f"  ✅ {imp}")
            except ImportError as e:
                print(f"  ❌ {imp}: {e}")
                failed_imports.append((imp, str(e)))

        if failed_imports:
            print(f"\n❌ {len(failed_imports)} imports failed:")
            for imp, error in failed_imports:
                print(f"    - {imp}: {error}")
        else:
            print("\n✅ All dependencies can be imported")

    def trace_with_mock(self, module_name: str) -> None:
        """Try to import with common dependencies mocked"""
        print("\n🔧 Attempting import with mocked dependencies...")

        from unittest.mock import Mock, patch

        # Common dependencies to mock
        mock_modules = {
            "pocketbase": Mock(),
            "pocketbase.Client": Mock(),
            "campminder": Mock(),
            "campminder.client": Mock(CampMinderClient=Mock, load_config_from_file=Mock(return_value=Mock())),
            "openai": Mock(),
            "anthropic": Mock(),
            "ollama": Mock(),
        }

        with patch.dict(sys.modules, mock_modules):
            success = self.trace_import(module_name)

            if success:
                print("\n✅ Module imports successfully with mocked dependencies")
            else:
                print("\n❌ Module still fails to import even with mocked dependencies")

    def summary(self) -> None:
        """Print import summary"""
        print("\n" + "=" * 60)
        print("📊 IMPORT SUMMARY")
        print("=" * 60)

        print(f"\n✅ Successfully imported: {len(self.imported_modules)}")
        for module in sorted(self.imported_modules):
            print(f"    - {module}")

        if self.errors:
            print(f"\n❌ Failed imports: {len(self.errors)}")
            for error in self.errors:
                print(f"    - {error['module']}: {error['error']}")

        print("\n" + "=" * 60)


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Debug Python import issues")
    parser.add_argument("module", help="Module name to import (e.g., scripts.sync.base_sync)")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    parser.add_argument("-d", "--dependencies", action="store_true", help="Check all dependencies")
    parser.add_argument("-m", "--mock", action="store_true", help="Try import with mocked dependencies")
    parser.add_argument("-t", "--trace", action="store_true", help="Trace all imports recursively")

    args = parser.parse_args()

    # Add project root to path
    project_root = Path(__file__).resolve().parent.parent.parent
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    print(f"🐍 Python: {sys.version}")
    print(f"📁 Working directory: {Path.cwd()}")
    print(f"📁 Project root: {project_root}")
    print()

    tracer = ImportTracer(verbose=args.verbose)

    # Trace the import
    tracer.trace_import(args.module)

    # Check dependencies if requested
    if args.dependencies:
        tracer.check_dependencies(args.module)

    # Try with mocks if requested
    if args.mock:
        tracer.trace_with_mock(args.module)

    # Print summary
    tracer.summary()


if __name__ == "__main__":
    main()
