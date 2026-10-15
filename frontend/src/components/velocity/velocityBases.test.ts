/**
 * K13 (#3207, owner 2026-10-15): "label it but note 2025 and prior, not just 2025, if that is the
 * case." Velocity's lines can be built two ways: the count stored each night, or rebuilt from
 * registration dates. A numbered note says which line is which, driven by each point's data_source.
 */
import { describe, it, expect } from 'vitest'
import { describeVelocityBases, type BasisPoint } from './velocityBases'

function points(from: string, to: string, storedFrom?: string): BasisPoint[] {
  const out: BasisPoint[] = []
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`);) {
    const date = d.toISOString().slice(0, 10)
    out.push({ date, data_source: storedFrom && date >= storedFrom ? 'snapshot' : 'reconstructed' })
    d = new Date(d.getTime() + 86_400_000)
  }
  return out
}

const S2026 = { year: 2026, points: points('2025-11-12', '2026-04-13', '2026-03-02') }
const S2025 = { year: 2025, points: points('2024-11-12', '2025-08-20') }
const S2024 = { year: 2024, points: points('2023-11-07', '2024-08-20') }

describe('describeVelocityBases', () => {
  it('names the stored line and says every earlier season is rebuilt', () => {
    const basis = describeVelocityBases({
      lines: [S2026, S2025],
      snapshotsStart: '2026-03-02',
      includesRebuiltPrograms: false,
    })
    expect(basis?.years).toEqual([2026, 2025])
    expect(basis?.text).toContain(
      '2026 is the count Kindred stored each night from Mar 2, 2026, and is rebuilt before then.'
    )
    expect(basis?.text).toContain('2025 and earlier seasons are rebuilt')
    expect(basis?.text).toContain('registered by that day and not cancelled by it')
  })

  it('says "2025 and earlier" once, however many prior years are ticked', () => {
    const basis = describeVelocityBases({
      lines: [S2026, S2025, S2024],
      snapshotsStart: '2026-03-02',
      includesRebuiltPrograms: false,
    })
    expect(basis?.years).toEqual([2026, 2025, 2024])
    expect(basis?.text).toContain('2025 and earlier seasons are rebuilt')
    expect(basis?.text).not.toContain('2024')
  })

  it('adds that Quests and teen programs are always rebuilt when they are in scope', () => {
    const basis = describeVelocityBases({
      lines: [S2026, S2025],
      snapshotsStart: '2026-03-02',
      includesRebuiltPrograms: true,
    })
    expect(basis?.text).toContain('Quests and teen programs are always rebuilt')
  })

  it('says nothing when every line is rebuilt: one basis, nothing to label', () => {
    expect(
      describeVelocityBases({
        lines: [S2025, S2024],
        snapshotsStart: '2026-03-02',
        includesRebuiltPrograms: true,
      })
    ).toBeNull()
  })

  it('says nothing without a comparison line', () => {
    expect(
      describeVelocityBases({
        lines: [S2026],
        snapshotsStart: '2026-03-02',
        includesRebuiltPrograms: false,
      })
    ).toBeNull()
  })

  it('names a rebuilt line from after the snapshots began on its own, not as "and earlier"', () => {
    const S2027 = { year: 2027, points: points('2026-11-10', '2026-11-20') }
    const basis = describeVelocityBases({
      lines: [S2027, S2026, S2025],
      snapshotsStart: '2026-03-02',
      includesRebuiltPrograms: false,
    })
    expect(basis?.years).toEqual([2027, 2026, 2025])
    expect(basis?.text).toContain('2026 is the count Kindred stored each night from Mar 2, 2026')
    expect(basis?.text).toContain('2027 is rebuilt')
    expect(basis?.text).toContain('2025 and earlier seasons are rebuilt')
  })

  it('without a known snapshots start, names the rebuilt years it shows', () => {
    const basis = describeVelocityBases({
      lines: [S2026, S2025, S2024],
      snapshotsStart: null,
      includesRebuiltPrograms: false,
    })
    expect(basis?.text).toContain('2025 and 2024 are rebuilt')
  })
})
