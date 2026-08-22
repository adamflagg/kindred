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
  // The render block: from the retained-snapshot gate through the modal's
  // self-closing tag. Anchoring on the gate rather than the tag makes the
  // latch assertion below part of the extraction itself. Every index is
  // guarded — an unguarded end would make slice() run to end-of-file and
  // both assertions silently measure unrelated source (#2539 scan round 2).
  const gate = src.indexOf('{diagnostics && (')
  const start = src.indexOf('<SolverDiagnosticsModal', gate)
  const end = start === -1 ? -1 : src.indexOf('/>', start)
  const block = gate === -1 || start === -1 || end === -1 ? '' : src.slice(gate, end)

  // onClose's own arrow body, extracted separately: the payload rule below is
  // about the CLOSE path specifically. Clearing on afterLeave is the
  // OPPOSITE of the bug — that fires only after the fade has completed, when
  // the DOM is already gone — so the guard must not forbid it (round-2
  // finding 1: the first version banned setDiagnostics(null) anywhere in the
  // block, which vetoed the correct afterLeave cleanup).
  const closeStart = block.indexOf('onClose=')
  const closeEnd = closeStart === -1 ? -1 : block.indexOf('}}', closeStart)
  const closeBody = closeStart === -1 || closeEnd === -1 ? '' : block.slice(closeStart, closeEnd)

  it('keeps the retained-snapshot latch — the modal renders only behind {diagnostics && …}', () => {
    // The latch IS the mechanism: null until the first reviewable solve,
    // then kept across closes so the mounted dialog can play the exit fade.
    expect(gate).toBeGreaterThan(-1)
    expect(start).toBeGreaterThan(gate)
    expect(end).toBeGreaterThan(start)
    expect(closeBody).toContain('setShowDiagnostics(false)')
  })

  it('does NOT null the diagnostics payload in onClose — the exit fade needs it', () => {
    expect(closeBody.length).toBeGreaterThan(0)
    expect(closeBody).not.toContain('setDiagnostics(null)')
  })

  it('DOES drop the payload once the fade completes, via afterLeave', () => {
    // The other half of the retention contract: keep the payload through the
    // leave, then release it so the mounted-closed modal stops re-rendering
    // its report on every SessionView render forever (round-2 finding 3).
    expect(block).toContain('afterLeave')
    expect(block).toContain('setDiagnostics(null)')
  })
})
