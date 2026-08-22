/**
 * Source guard: the solver-diagnostics payload must outlive close (kindred#2529).
 *
 * SessionView is a heavy integration component that is not practical to render
 * in a unit test (see SessionView.session-reset.test.tsx for the precedent),
 * so this pins the one line that matters as a source assertion, the way
 * index.css.guard.test.ts pins its invariants.
 *
 * The mechanism: `{diagnostics && <SolverDiagnosticsModal>}` is a retained
 * snapshot latch — null until the first infeasible solve, then permanently
 * set, with `showDiagnostics` driving the fade. If onClose nulls the payload
 * again, the modal unmounts on the same frame the close fires and Modal's
 * 150ms leave transition (#2530) never plays. SolverDiagnosticsModal renders
 * the "No diagnostic detail is available" fallback for a never-populated
 * payload, and each reviewable solver run overwrites it, so retaining the
 * last payload is safe.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(resolve(__dirname, './SessionView.tsx'), 'utf-8')

describe('SessionView solver-diagnostics close path (kindred#2529)', () => {
  // The render block from the modal's JSX tag to the end of its props.
  const start = src.indexOf('<SolverDiagnosticsModal')
  const block = src.slice(start, src.indexOf('/>', start))

  it('still renders the diagnostics modal (anchor for the assertions below)', () => {
    expect(start).toBeGreaterThan(-1)
    expect(block).toContain('setShowDiagnostics(false)')
  })

  it('does NOT null the diagnostics payload on close — the exit fade needs it', () => {
    expect(block).not.toContain('setDiagnostics(null)')
  })
})
