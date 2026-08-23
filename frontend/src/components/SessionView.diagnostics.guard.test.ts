/**
 * Source guard: the solver-diagnostics payload must outlive close (kindred#2529).
 *
 * SessionView is a heavy integration component that is not practical to render
 * in a unit test (see SessionView.session-reset.test.tsx for the precedent),
 * so this pins the wiring as a source assertion, the way
 * index.css.guard.test.ts pins its invariants.
 *
 * SUPERSEDED, DELIBERATELY, BY kindred#2541 — and the reason is that half of
 * what this file used to assert is no longer expressible in this source.
 *
 * The old guard read the `onClose` arrow's BODY and required that it not
 * contain `setDiagnostics(null)`: with two hand-rolled useState pairs, nulling
 * the payload on close was one keystroke away, and doing it unmounted the
 * modal on the frame the close fired so Modal's 150ms leave (#2530) never
 * played. SessionView now drives the dialog through `useRetainedDialog`, whose
 * `close()` touches the open flag ONLY — there is no payload setter in this
 * file to misuse, so the prohibition has nothing left to prohibit. That
 * invariant moved to where the mechanism now lives and is pinned there by
 * hooks/useRetainedDialog.test.ts ("clears the open flag but RETAINS the
 * snapshot") and by Modal.test.tsx's afterLeave pins.
 *
 * What still needs a source guard is what this file can still see: that
 * SessionView keeps using the hook rather than re-deriving the pattern, and
 * that its outputs are wired to the props they belong to — the
 * retained `data` gating the mount AND feeding the payload, `isOpen` driving
 * the fade, `afterLeave` releasing the snapshot once the fade completes.
 * Regating the modal on `isOpen` is the same defect in a new shape, and this
 * is the only test that would see it.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(resolve(__dirname, './SessionView.tsx'), 'utf-8')

describe('SessionView solver-diagnostics close path (kindred#2529, #2541)', () => {
  // The render block: from the retained-snapshot gate through the modal's
  // self-closing tag. Anchoring on the gate rather than the tag makes the
  // latch assertion below part of the extraction itself. Every index is
  // guarded — an unguarded end would make slice() run to end-of-file and
  // the assertions silently measure unrelated source (#2539 scan round 2).
  const gate = src.indexOf('{diagnostics && (')
  const start = src.indexOf('<SolverDiagnosticsModal', gate)
  const end = start === -1 ? -1 : src.indexOf('/>', start)
  const block = gate === -1 || start === -1 || end === -1 ? '' : src.slice(gate, end)

  it('holds the diagnostics payload in useRetainedDialog, not a hand-rolled pair', () => {
    // The extraction itself. A second hand-rolled `useState` pair here is how
    // the pattern grew four copies in the first place (#2541).
    expect(src).toContain('useRetainedDialog<SolverDiagnostics>()')
    expect(src).toContain('data: diagnostics,')
    expect(src).not.toContain('setDiagnostics')
    expect(src).not.toContain('setShowDiagnostics')
  })

  it('keeps the retained-snapshot latch — the modal renders only behind the retained data', () => {
    // The latch IS the mechanism: null until the first reviewable solve, then
    // kept across closes so the mounted dialog can play the exit fade. Gating
    // on `isOpen` instead would unmount it on the close frame again.
    expect(gate).toBeGreaterThan(-1)
    expect(start).toBeGreaterThan(gate)
    expect(end).toBeGreaterThan(start)
    expect(block).toContain('isOpen={diagnosticsOpen}')
    expect(block).toContain('onClose={closeDiagnostics}')
    expect(block).toContain('diagnostics={diagnostics}')
  })

  it('DOES drop the payload once the fade completes, via afterLeave', () => {
    // The other half of the retention contract: keep the payload through the
    // leave, then release it so the mounted-closed modal stops re-rendering
    // its report on every SessionView render forever (round-2 finding 3).
    expect(block).toContain('afterLeave={releaseDiagnostics}')
  })
})
