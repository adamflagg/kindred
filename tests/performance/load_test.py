#!/usr/bin/env python3
"""
Load testing script for Kindred.
Tests sync performance, solver performance, and API response times.
"""

import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
import psutil
import requests

# Enable pandas Copy-on-Write for pandas 3.0 compatibility
pd.options.mode.copy_on_write = True

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))


def get_auth_headers():
    """Get authentication headers for API requests."""
    # In test environment, we typically use bypass mode
    return {"X-Test-User": "test@example.com", "X-Test-User-Id": "test_user_123"}


class LoadTester:
    def __init__(self, base_url="http://localhost:8080", pb_url="http://localhost:8080"):
        self.base_url = base_url
        self.pb_url = pb_url
        self.results: dict[str, list[Any]] = {
            "sync_performance": [],
            "solver_performance": [],
            "api_performance": [],
            "memory_usage": [],
            "errors": [],
        }
        self.start_time = None

    def log(self, message, level="INFO"):
        """Log message with timestamp."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] [{level}] {message}")

    def measure_memory(self):
        """Measure current memory usage."""
        process = psutil.Process()
        return {
            "timestamp": datetime.now().isoformat(),
            "memory_mb": process.memory_info().rss / 1024 / 1024,
            "cpu_percent": process.cpu_percent(interval=1),
        }

    def test_sync_performance(self, csv_file):
        """Test sync script performance."""
        self.log(f"Testing sync performance with {csv_file}")

        start_time = time.time()
        start_memory = self.measure_memory()

        try:
            # Run sync script
            cmd = [
                sys.executable,
                str(project_root / "scripts" / "sync" / "bunk_request_processor" / "process_requests.py"),
                "--dry-run",  # Dry run for consistent testing
            ]

            result = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ})

            elapsed = time.time() - start_time
            end_memory = self.measure_memory()

            if result.returncode == 0:
                # Parse output for record count
                lines = result.stdout.split("\n")
                records_processed = 0
                for line in lines:
                    if "Processed" in line and "requests" in line:
                        try:
                            records_processed = int(line.split()[1])
                        except (ValueError, IndexError):
                            pass

                self.results["sync_performance"].append(
                    {
                        "csv_file": csv_file,
                        "records": records_processed,
                        "elapsed_seconds": elapsed,
                        "records_per_second": records_processed / elapsed if elapsed > 0 else 0,
                        "memory_delta_mb": end_memory["memory_mb"] - start_memory["memory_mb"],
                        "status": "success",
                    }
                )
                self.log(f"Sync completed: {records_processed} records in {elapsed:.2f}s")
            else:
                self.results["errors"].append(
                    {"operation": "sync", "error": result.stderr, "timestamp": datetime.now().isoformat()}
                )
                self.log(f"Sync failed: {result.stderr}", "ERROR")

        except Exception as e:
            self.results["errors"].append(
                {"operation": "sync", "error": str(e), "timestamp": datetime.now().isoformat()}
            )
            self.log(f"Sync error: {e}", "ERROR")

    def test_solver_performance(self, session_id, expected_campers):
        """Test solver performance for a session."""
        self.log(f"Testing solver for session {session_id} ({expected_campers} campers)")

        start_time = time.time()
        start_memory = self.measure_memory()

        try:
            response = requests.post(
                f"{self.base_url}/api/solver/solve/{session_id}",
                json={"use_cached": False, "time_limit": 300},
                headers=get_auth_headers(),
            )

            elapsed = time.time() - start_time
            end_memory = self.measure_memory()

            if response.status_code == 200:
                result = response.json()
                self.results["solver_performance"].append(
                    {
                        "session_id": session_id,
                        "expected_campers": expected_campers,
                        "actual_campers": result.get("num_campers", 0),
                        "bunks_created": result.get("num_bunks", 0),
                        "elapsed_seconds": elapsed,
                        "memory_delta_mb": end_memory["memory_mb"] - start_memory["memory_mb"],
                        "status": result.get("status", "unknown"),
                        "satisfaction_rate": result.get("satisfaction_rate", 0),
                    }
                )
                self.log(f"Solver completed: {result.get('num_bunks', 0)} bunks in {elapsed:.2f}s")
            else:
                self.results["errors"].append(
                    {
                        "operation": "solver",
                        "session_id": session_id,
                        "status_code": response.status_code,
                        "error": response.text,
                        "timestamp": datetime.now().isoformat(),
                    }
                )
                self.log(f"Solver failed: {response.status_code}", "ERROR")

        except Exception as e:
            self.results["errors"].append(
                {
                    "operation": "solver",
                    "session_id": session_id,
                    "error": str(e),
                    "timestamp": datetime.now().isoformat(),
                }
            )
            self.log(f"Solver error: {e}", "ERROR")

    def test_api_endpoints(self, num_requests=100, num_threads=10):
        """Test API endpoint performance with concurrent requests."""
        self.log(f"Testing API endpoints with {num_requests} requests using {num_threads} threads")

        endpoints = [
            ("GET", "/api/sessions", "List sessions"),
            ("GET", "/api/campers", "List campers"),
            ("GET", "/api/bunks", "List bunks"),
            ("GET", "/api/solver/status", "Solver status"),
            ("GET", "/health", "Health check"),
        ]

        def make_request(endpoint_info, request_num):
            method, path, name = endpoint_info
            url = f"{self.base_url}{path}"

            start_time = time.time()
            try:
                response = requests.get(url) if method == "GET" else requests.post(url, json={})

                elapsed = time.time() - start_time

                return {
                    "endpoint": path,
                    "name": name,
                    "request_num": request_num,
                    "status_code": response.status_code,
                    "elapsed_ms": elapsed * 1000,
                    "timestamp": datetime.now().isoformat(),
                }
            except Exception as e:
                return {
                    "endpoint": path,
                    "name": name,
                    "request_num": request_num,
                    "error": str(e),
                    "elapsed_ms": (time.time() - start_time) * 1000,
                    "timestamp": datetime.now().isoformat(),
                }

        # Run concurrent requests
        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = []
            for i in range(num_requests):
                endpoint = endpoints[i % len(endpoints)]
                future = executor.submit(make_request, endpoint, i)
                futures.append(future)

            for future in as_completed(futures):
                result = future.result()
                if "error" in result:
                    self.results["errors"].append(result)
                else:
                    self.results["api_performance"].append(result)

        # Calculate statistics
        for endpoint_info in endpoints:
            endpoint_results = [r for r in self.results["api_performance"] if r["endpoint"] == endpoint_info[1]]
            if endpoint_results:
                response_times = [r["elapsed_ms"] for r in endpoint_results]
                avg_time = sum(response_times) / len(response_times)
                max_time = max(response_times)
                min_time = min(response_times)
                self.log(f"{endpoint_info[2]}: avg={avg_time:.2f}ms, min={min_time:.2f}ms, max={max_time:.2f}ms")

    def monitor_resources(self, duration=60, interval=5):
        """Monitor system resources during testing."""
        self.log(f"Monitoring resources for {duration}s")

        start_time = time.time()
        while time.time() - start_time < duration:
            self.results["memory_usage"].append(self.measure_memory())
            time.sleep(interval)

    def generate_report(self):
        """Generate load test report."""
        report_file = f"load_test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"

        with open(report_file, "w") as f:
            f.write("# Load Test Report\n\n")
            f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")

            # Sync Performance
            f.write("## Sync Performance\n\n")
            if self.results["sync_performance"]:
                df = pd.DataFrame(self.results["sync_performance"])
                f.write("| Metric | Value |\n")
                f.write("|--------|-------|\n")
                f.write(f"| Total Records | {df['records'].sum()} |\n")
                f.write(f"| Total Time | {df['elapsed_seconds'].sum():.2f}s |\n")
                f.write(f"| Avg Records/Second | {df['records_per_second'].mean():.2f} |\n")
                f.write(f"| Peak Memory Delta | {df['memory_delta_mb'].max():.2f} MB |\n\n")

            # Solver Performance
            f.write("## Solver Performance\n\n")
            if self.results["solver_performance"]:
                df = pd.DataFrame(self.results["solver_performance"])
                f.write("| Session | Campers | Bunks | Time (s) | Memory (MB) | Status |\n")
                f.write("|---------|---------|-------|----------|-------------|--------|\n")
                for row in df.itertuples(index=False):
                    f.write(
                        f"| {row.session_id} | {row.actual_campers} | "
                        f"{row.bunks_created} | {row.elapsed_seconds:.2f} | "
                        f"{row.memory_delta_mb:.2f} | {row.status} |\n"
                    )
                f.write("\n")

            # API Performance
            f.write("## API Performance\n\n")
            if self.results["api_performance"]:
                df = pd.DataFrame(self.results["api_performance"])
                summary = df.groupby("endpoint")["elapsed_ms"].agg(["mean", "min", "max", "count"]).reset_index()
                f.write("| Endpoint | Avg (ms) | Min (ms) | Max (ms) | Count |\n")
                f.write("|----------|----------|----------|----------|-------|\n")
                for row in summary.itertuples(index=False):
                    f.write(f"| {row.endpoint} | {row.mean:.2f} | {row.min:.2f} | {row.max:.2f} | {row.count} |\n")
                f.write("\n")

            # Memory Usage
            f.write("## Resource Usage\n\n")
            if self.results["memory_usage"]:
                df = pd.DataFrame(self.results["memory_usage"])
                f.write(f"- Peak Memory: {df['memory_mb'].max():.2f} MB\n")
                f.write(f"- Avg Memory: {df['memory_mb'].mean():.2f} MB\n")
                f.write(f"- Peak CPU: {df['cpu_percent'].max():.2f}%\n\n")

            # Errors
            if self.results["errors"]:
                f.write("## Errors\n\n")
                for error in self.results["errors"]:
                    f.write(
                        f"- **{error.get('operation', 'unknown')}** at {error['timestamp']}: "
                        f"{error.get('error', error.get('status_code', 'Unknown error'))}\n"
                    )
                f.write("\n")

            f.write("\n## Summary\n\n")
            total_errors = len(self.results["errors"])
            if total_errors == 0:
                f.write("✅ All tests completed successfully!\n")
            else:
                f.write(f"⚠️ {total_errors} errors encountered during testing.\n")

        self.log(f"Report generated: {report_file}")
        return report_file


def main():
    """Run load tests."""
    tester = LoadTester()

    # Check if services are running
    try:
        response = requests.get(f"{tester.base_url}/health")
        if response.status_code != 200:
            print("ERROR: Solver service is not running. Please start services first.")
            sys.exit(1)
    except requests.exceptions.RequestException:
        print("ERROR: Cannot connect to solver service. Please start services first.")
        sys.exit(1)

    print("========================================")
    print("Kindred Load Testing")
    print("========================================")
    print()

    # Test 1: Sync Performance
    print("Test 1: Sync Performance")
    print("------------------------")
    # Try project root first, then drive location
    test_csv = project_root / "api-bunking-7-08-25.csv"
    if not test_csv.exists():
        test_csv = project_root / "drive" / "api-bunking-7-08-25.csv"

    if test_csv.exists():
        tester.test_sync_performance(str(test_csv))
    else:
        tester.log("Test CSV not found, skipping sync test", "WARN")

    print()

    # Test 2: Solver Performance
    print("Test 2: Solver Performance")
    print("--------------------------")
    # Get available sessions
    try:
        response = requests.get(f"{tester.pb_url}/api/collections/camp_sessions/records", headers=get_auth_headers())
        if response.status_code == 200:
            sessions = response.json().get("items", [])[:3]  # Test first 3 sessions
            for session in sessions:
                # Get camper count for session
                camper_response = requests.get(
                    f"{tester.pb_url}/api/collections/attendees/records",
                    params={"filter": f'session="{session["id"]}"'},
                    headers=get_auth_headers(),
                )
                camper_count = camper_response.json().get("totalItems", 0)
                tester.test_solver_performance(session["id"], camper_count)
        else:
            tester.log("Could not fetch sessions", "WARN")
    except Exception as e:
        tester.log(f"Error testing solver: {e}", "ERROR")

    print()

    # Test 3: API Performance
    print("Test 3: API Performance")
    print("-----------------------")
    tester.test_api_endpoints(num_requests=100, num_threads=10)

    print()

    # Test 4: Resource Monitoring
    print("Test 4: Resource Monitoring")
    print("---------------------------")
    tester.monitor_resources(duration=30, interval=5)

    print()
    print("========================================")

    # Generate report
    report_file = tester.generate_report()
    print(f"\nLoad testing complete. Report saved to: {report_file}")

    # Return exit code based on errors
    return 0 if len(tester.results["errors"]) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
