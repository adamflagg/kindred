import { describe, expect, it } from 'vitest'

import { buildRunTitle } from './runTitle'

import type { SolverRun } from '../../../hooks/useSolverRuns'

const base: SolverRun = {
  id: 'rec_a',
  run_id: 'run_abc',
  status: 'success',
  created: '2026-05-08T10:14:00Z',
  stats: { status: 'FEASIBLE' },
  details: {
    source_label: 'S2 · Production',
    sweep_label: 'baseline',
  },
}

describe('buildRunTitle', () => {
  it('joins sweep_label · source_label · time when all three present', () => {
    const title = buildRunTitle(base)
    expect(title).toMatch(/^baseline · S2 · Production · /)
    expect(title).toMatch(/\d{1,2}:\d{2}/)
  })

  it('omits sweep_label when missing', () => {
    const { sweep_label: _omit, ...detailsNoSweep } = base.details ?? {}
    void _omit
    const run: SolverRun = { ...base, details: detailsNoSweep }
    const title = buildRunTitle(run)
    expect(title).not.toMatch(/baseline/)
    expect(title.startsWith('S2 · Production · ')).toBe(true)
  })

  it('falls back to "Solver run" when source_label is missing', () => {
    const { source_label: _drop, sweep_label: _drop2, ...details } = base.details ?? {}
    void _drop
    void _drop2
    const run: SolverRun = { ...base, details }
    const title = buildRunTitle(run)
    expect(title.startsWith('Solver run · ')).toBe(true)
  })

  it('omits the timestamp segment when created is unparseable', () => {
    const run: SolverRun = { ...base, created: 'not-a-date' }
    const title = buildRunTitle(run)
    expect(title).toBe('baseline · S2 · Production')
  })

  it('omits the timestamp segment when created is missing entirely', () => {
    const { created: _drop, ...rest } = base
    void _drop
    const run = rest as SolverRun
    const title = buildRunTitle(run)
    expect(title).toBe('baseline · S2 · Production')
  })
})
