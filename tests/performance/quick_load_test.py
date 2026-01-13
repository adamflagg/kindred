#!/usr/bin/env python3
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from tests.performance.load_test import LoadTester


def main():
    tester = LoadTester()

    print("========================================")
    print("Quick API Load Testing")
    print("========================================")
    print()

    # Test API Performance
    print("Test: API Performance")
    print("-----------------------")
    tester.test_api_endpoints(num_requests=100, num_threads=10)

    print()

    # Test Resource Monitoring
    print("Test: Resource Monitoring (10s)")
    print("---------------------------")
    tester.monitor_resources(duration=10, interval=2)

    print()
    print("========================================")

    # Generate report
    report_file = tester.generate_report()
    print(f"\nLoad testing complete. Report saved to: {report_file}")

    return 0 if len(tester.results["errors"]) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
