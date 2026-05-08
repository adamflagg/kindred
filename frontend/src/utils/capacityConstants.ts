/**
 * Hardcoded cabin capacity constants. Mirror of `bunking/solver/constants.py`.
 *
 * Previously stored in the PocketBase `config` collection under
 * `constraint.cabin_capacity.{standard,max,mode,penalty}`. None were ever
 * tuned at runtime; collapsed to constants in Phase 2.
 *
 * - DEFAULT_BUNK_CAPACITY: solver hard cap and reference cabin size for
 *   grade-ratio math and post-solve evaluator displays.
 * - MAX_BUNK_CAPACITY: staff manual-edit ceiling enforced by the assignments
 *   drag-and-drop UI. Solver does not read this.
 */
export const DEFAULT_BUNK_CAPACITY = 12
export const MAX_BUNK_CAPACITY = 14
