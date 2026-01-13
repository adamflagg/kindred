#!/usr/bin/env python3
"""
Comprehensive test runner for the bunking system
Runs all test suites and generates coverage reports
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestRunner:
    """Orchestrates running all test suites"""

    def __init__(self, verbose: bool = False) -> None:
        self.verbose = verbose
        self.project_root = Path(__file__).parent.parent
        self.results: dict[str, bool] = {}

    def run_python_tests(self, test_type: str = "all") -> bool:
        """Run Python tests with pytest"""
        print("\n" + "=" * 60)
        print("Running Python Tests")
        print("=" * 60)

        test_dir = self.project_root / "scripts" / "test"

        # Determine which tests to run
        cmd = [sys.executable, "-m", "pytest", "--tb=short"]

        if test_type == "unit":
            cmd.append(str(self.project_root / "tests" / "unit"))
        elif test_type == "integration":
            cmd.extend([str(test_dir), "-k", "integration"])
        elif test_type == "sync":
            cmd.extend([str(test_dir), "-k", "sync or base_sync"])
        else:
            # Run all tests in the directory
            cmd.append(str(test_dir))

        if self.verbose:
            cmd.append("-v")

        result = subprocess.run(cmd, capture_output=True, text=True)

        print(result.stdout)
        if result.stderr:
            print(result.stderr)

        self.results["python"] = result.returncode == 0
        return result.returncode == 0

    def run_frontend_tests(self) -> bool:
        """Run React/TypeScript tests with Vitest"""
        print("\n" + "=" * 60)
        print("Running Frontend Tests")
        print("=" * 60)

        frontend_dir = self.project_root / "frontend"

        # Check if node_modules exists
        if not (frontend_dir / "node_modules").exists():
            print("Installing frontend dependencies...")
            subprocess.run(["npm", "install"], cwd=frontend_dir, check=True)

        cmd = ["npm", "run", "test", "--", "--run"]
        if self.verbose:
            cmd.append("--reporter=verbose")

        result = subprocess.run(cmd, cwd=frontend_dir, capture_output=True, text=True)

        print(result.stdout)
        if result.stderr:
            print(result.stderr)

        self.results["frontend"] = result.returncode == 0
        return result.returncode == 0

    def run_linting(self) -> None:
        """Run code quality checks"""
        print("\n" + "=" * 60)
        print("Running Code Quality Checks")
        print("=" * 60)

        # Python linting with ruff
        print("\nPython linting (ruff)...")
        ruff_result = subprocess.run(
            [sys.executable, "-m", "ruff", "check", ".", "--fix"], capture_output=True, text=True
        )

        if ruff_result.returncode != 0:
            print("Ruff found issues:")
            print(ruff_result.stdout)
        else:
            print("✓ Python code passes ruff checks")

        # Frontend linting
        print("\nTypeScript linting...")
        frontend_dir = self.project_root / "frontend"
        lint_result = subprocess.run(["npm", "run", "lint"], cwd=frontend_dir, capture_output=True, text=True)

        if lint_result.returncode != 0:
            print("ESLint found issues:")
            print(lint_result.stdout)
        else:
            print("✓ TypeScript code passes ESLint checks")

        # Type checking
        print("\nTypeScript type checking...")
        type_result = subprocess.run(["npm", "run", "type-check"], cwd=frontend_dir, capture_output=True, text=True)

        if type_result.returncode != 0:
            print("TypeScript type errors:")
            print(type_result.stdout)
        else:
            print("✓ TypeScript types are correct")

        self.results["linting"] = (
            ruff_result.returncode == 0 and lint_result.returncode == 0 and type_result.returncode == 0
        )

    def run_coverage_report(self) -> None:
        """Generate coverage reports"""
        print("\n" + "=" * 60)
        print("Coverage Report")
        print("=" * 60)

        # Python coverage
        coverage_file = self.project_root / "htmlcov" / "index.html"
        if coverage_file.exists():
            print(f"\nPython coverage report: {coverage_file}")

        # Frontend coverage
        frontend_coverage = self.project_root / "frontend" / "coverage" / "index.html"
        if frontend_coverage.exists():
            print(f"Frontend coverage report: {frontend_coverage}")

    def print_summary(self) -> int:
        """Print test summary"""
        print("\n" + "=" * 60)
        print("Test Summary")
        print("=" * 60)

        all_passed = True
        for suite, passed in self.results.items():
            status = "✓ PASSED" if passed else "✗ FAILED"
            print(f"{suite.ljust(20)} {status}")
            if not passed:
                all_passed = False

        print("=" * 60)

        if all_passed:
            print("🎉 All tests passed!")
            return 0
        else:
            print("❌ Some tests failed")
            return 1

    def run_all(self, skip_frontend: bool = False, skip_linting: bool = False, test_type: str = "all") -> int:
        """Run all test suites"""

        # Run Python tests
        self.run_python_tests(test_type)

        # Run frontend tests
        if not skip_frontend:
            self.run_frontend_tests()

        # Run linting
        if not skip_linting:
            self.run_linting()

        # Generate coverage reports
        self.run_coverage_report()

        # Print summary
        return self.print_summary()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run all test suites")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    parser.add_argument("--skip-frontend", action="store_true", help="Skip frontend tests")
    parser.add_argument("--skip-linting", action="store_true", help="Skip linting checks")
    parser.add_argument(
        "--type", choices=["all", "unit", "integration", "sync"], default="all", help="Type of tests to run"
    )

    args = parser.parse_args()

    runner = TestRunner(verbose=args.verbose)
    return runner.run_all(skip_frontend=args.skip_frontend, skip_linting=args.skip_linting, test_type=args.type)


if __name__ == "__main__":
    sys.exit(main())
