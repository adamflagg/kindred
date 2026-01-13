#!/usr/bin/env python3
# mypy: ignore-errors
# NOTE: This performance script imports from scripts.test.profile_solver
# which may not exist or is only used for manual profiling.
"""
Simplified solver profiling focusing on time and memory metrics.
"""

import json
import logging
import os
import sys
import time
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO

# Add project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from scripts.test.profile_solver import SolverProfiler

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
logger = logging.getLogger(__name__)


def run_single_scenario(profiler, name, num_campers=500, num_cabins=42, cabin_capacity=12):
    """Run a single profiling scenario and capture results"""
    logger.info(f"\n{'=' * 60}")
    logger.info(f"Running scenario: {name}")
    logger.info(f"Campers: {num_campers}, Cabins: {num_cabins}, Capacity: {cabin_capacity}")
    logger.info(f"{'=' * 60}")

    # Generate test data
    logger.info("Generating test data...")
    campers, friend_groups = profiler.generate_test_campers(num_campers)
    logger.info(f"Created {len(campers)} campers with {len(friend_groups)} friend groups")

    # Capture solver output
    solver_output = StringIO()
    solver_errors = StringIO()

    start_time = time.time()

    # Run solver with output capture
    with redirect_stdout(solver_output), redirect_stderr(solver_errors):
        result = profiler.profile_solver(campers, friend_groups, num_cabins=num_cabins, cabin_capacity=cabin_capacity)

    total_time = time.time() - start_time

    # Parse key metrics from captured output
    output_text = solver_output.getvalue()

    # Extract key metrics
    status = "UNKNOWN"
    objective = None

    for line in output_text.split("\n"):
        if "status:" in line:
            status = line.split("status:")[1].strip()
        elif "objective:" in line and objective is None:
            try:
                objective = int(line.split("objective:")[1].strip())
            except (ValueError, IndexError):
                pass

    # Update result with parsed info
    if result:
        result["scenario"] = name
        result["status"] = status
        result["objective"] = objective
        result["total_elapsed_time"] = total_time

        # Log summary
        logger.info(f"\nResults for {name}:")
        logger.info(f"  Status: {status}")
        logger.info(f"  Total Time: {result.get('total_time', 0):.2f}s")
        logger.info(f"  Solution Found: {result.get('solution_found', False)}")

        if result.get("solution_found"):
            logger.info(f"  Requests Satisfied: {result.get('satisfaction_rate', 0):.1%}")
            logger.info(f"  Friend Groups Together: {result.get('friend_group_rate', 0):.1%}")
            logger.info(f"  Cabins Used: {result.get('cabins_used', 0)}")

    return result


def main():
    """Run simplified profiling suite"""
    profiler = SolverProfiler()
    results = []

    # Test scenarios
    scenarios = [
        {"name": "Standard", "campers": 500, "cabins": 42, "capacity": 12},
        {"name": "Extra Capacity", "campers": 500, "cabins": 45, "capacity": 12},
        {"name": "Large Cabins", "campers": 500, "cabins": 35, "capacity": 15},
    ]

    for scenario in scenarios:
        try:
            result = run_single_scenario(
                profiler, scenario["name"], scenario["campers"], scenario["cabins"], scenario["capacity"]
            )
            if result:
                results.append(result)
        except Exception as e:
            logger.error(f"Error in scenario {scenario['name']}: {e}")
            results.append({"scenario": scenario["name"], "error": str(e), "solution_found": False})

        # Small delay between scenarios
        time.sleep(1)

    # Summary
    logger.info(f"\n{'=' * 60}")
    logger.info("PROFILING SUMMARY")
    logger.info(f"{'=' * 60}\n")

    successful = [r for r in results if r.get("solution_found")]

    if successful:
        avg_time = sum(r.get("total_time", 0) for r in successful) / len(successful)
        max_time = max(r.get("total_time", 0) for r in successful)

        logger.info(f"Successful scenarios: {len(successful)}/{len(results)}")
        logger.info(f"Average solve time: {avg_time:.2f}s")
        logger.info(f"Maximum solve time: {max_time:.2f}s")

        if avg_time < 30:
            logger.info("\n✅ PERFORMANCE REQUIREMENT MET: Average solve time < 30 seconds")
        else:
            logger.warning(f"\n❌ PERFORMANCE REQUIREMENT NOT MET: Average solve time {avg_time:.1f}s > 30s")

        if max_time < 35:
            logger.info("✅ All scenarios completed within reasonable time (<35s)")
        else:
            logger.warning(f"❌ Some scenarios took too long: max {max_time:.1f}s")

    # Save results
    with open("solver_profiling_summary.json", "w") as f:
        json.dump(
            {
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "scenarios": results,
                "summary": {
                    "total_scenarios": len(results),
                    "successful": len(successful),
                    "avg_time": avg_time if successful else None,
                    "max_time": max_time if successful else None,
                    "meets_requirement": avg_time < 30 if successful else False,
                },
            },
            f,
            indent=2,
        )

    logger.info("\nDetailed results saved to: solver_profiling_summary.json")


if __name__ == "__main__":
    main()
