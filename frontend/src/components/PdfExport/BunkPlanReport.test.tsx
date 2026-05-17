import { describe, it, expect } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { PDFParse } from 'pdf-parse'
import { BunkPlanReport } from './BunkPlanReport'

function makeStats(overrides: Record<string, unknown> = {}) {
  return {
    total_campers: 50,
    assigned_campers: 48,
    unassigned_campers: 2,
    total_requests: 40,
    satisfied_requests: 34,
    request_satisfaction_rate: 0.85,
    bunks_at_capacity: 6,
    bunks_under_capacity: 2,
    bunks_over_capacity: 0,
    material_parent_requests: 30,
    satisfied_material_parent_requests: 26,
    material_parent_request_satisfaction_rate: 0.87,
    campers_with_unsatisfied_material_parent_requests: 4,
    unsatisfied_material_parent_persons: [
      { cm_id: 2001, name: 'Riley Sam' },
      { cm_id: 2002, name: 'Liam Garcia' },
    ],
    best_effort_parent_requests: 10,
    satisfied_best_effort_parent_requests: 8,
    best_effort_parent_request_satisfaction_rate: 0.8,
    field_stats: {
      bunk_with: { total: 20, satisfied: 18, satisfaction_rate: 0.9 },
      not_bunk_with: { total: 10, satisfied: 8, satisfaction_rate: 0.8 },
    },
    ...overrides,
  }
}

// @react-pdf/renderer renders section titles (textTransform:'uppercase', letterSpacing)
// with individual spaces between characters in the PDF content stream.
// Strip ALL whitespace and uppercase for reliable section-title matching.
function stripSpaces(text: string): string {
  return text.replace(/\s+/g, '').toUpperCase()
}

describe('BunkPlanReport (PDF)', () => {
  it('emits a PDF buffer with key section titles in the text stream', async () => {
    const buf = await renderToBuffer(
      <BunkPlanReport
        sessionName="Taste of Camp 1"
        year={2026}
        plannerName="A. Flagg"
        statistics={makeStats({
          negative_request_violations_detail: [
            {
              requester_cm_id: '1003',
              target_cm_id: '1004',
              requester_name: 'Olivia Chen',
              target_name: 'Liam Garcia',
              bunk_cm_id: '5001',
              bunk_name: 'Cabin 3',
            },
          ],
          priority_unsuccessfuls: [
            {
              requester_cm_id: '1005',
              target_cm_id: '1006',
              requester_name: 'Sophia Martinez',
              target_name: 'Mia Wilson',
              raw_text: 'Mia is our top priority',
            },
          ],
        })}
        impossibilityReport={{
          total_impossible: 3,
          affected_campers: 1,
          by_reason: {},
          flat: [],
          mp_campers_entirely_impossible: [
            {
              cm_id: 1001,
              name: 'Emma Johnson',
              gender: 'Girls',
              grade: 7,
              reason_codes: ['no_valid_bunk'],
            },
          ],
        }}
      />
    )
    // Use pdf-parse to extract text from all pages
    const parser = new PDFParse({ data: buf })
    const result = await parser.getText()
    await parser.destroy()

    // @react-pdf/renderer uppercases section titles and adds inter-char spaces
    // when textTransform:'uppercase' and letterSpacing are applied.
    // Strip ALL whitespace and uppercase for reliable section-title matching.
    const flat = stripSpaces(result.text)

    expect(flat).toMatch(/BUNKPLANREPORT/)
    expect(flat).toMatch(/WHOGOTNOTHING/)
    expect(flat).toMatch(/FAMILIESTOCALL/)
    expect(flat).toMatch(/PRIORITYUNSUCCESSFULS/)
  }, 30000)

describe('BunkPlanReport (PDF) — Cover/Summary page', () => {
  it('renders MSP-focused KPIs + coverage table + impossibility summary + capacity by gender', async () => {
    const buf = await renderToBuffer(
      <BunkPlanReport
        sessionName="Session 3"
        year={2026}
        plannerName="Test Staff"
        statistics={makeStats({
          total_campers: 130,
          assigned_campers: 128,
          material_parent_requests: 48,
          satisfied_material_parent_requests: 42,
          material_parent_request_satisfaction_rate: 0.875,
          capacity_by_gender: { female: { capacity: 65, assigned: 62 }, male: { capacity: 85, assigned: 66 } },
        })}
        impossibilityReport={{
          by_reason: { grade_compatibility: [{}, {}, {}, {}, {}, {}, {}] },
          total_impossible: 7,
          affected_campers: 5,
          flat: [],
          mp_campers_entirely_impossible: [],
        } as any}
      />
    )
    const parser = new PDFParse({ data: buf })
    const result = await parser.getText()
    await parser.destroy()
    const flat = stripSpaces(result.text)

    // KPI section title (might be "EXECUTIVE SUMMARY" or "EXECUTIVESUMMARY" depending on letter-spacing strip)
    expect(flat).toMatch(/EXECUTIVESUMMARY/)
    // KPI values
    expect(result.text).toMatch(/88\s*%|87\s*%/) // 0.875 → 88% rounded
    // Section heads (stripped of whitespace + uppercased)
    expect(flat).toMatch(/COVERAGE/i)
    expect(flat).toMatch(/CAPACITYBYGENDER/)
    expect(flat).toMatch(/IMPOSSIBLEBYREASON/)
    // Friendly reason label (NOT uppercased — appears as regular cell text)
    expect(result.text).toMatch(/Grade range too wide|grade_compatibility/i)
  }, 30000)
})

  it('handles empty action lists gracefully', async () => {
    const buf = await renderToBuffer(
      <BunkPlanReport
        sessionName="Session 2"
        year={2026}
        plannerName="Staff Member"
        statistics={makeStats()}
        impossibilityReport={{
          total_impossible: 0,
          affected_campers: 0,
          by_reason: {},
          flat: [],
          mp_campers_entirely_impossible: [],
        }}
      />
    )
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(0)
  }, 30000)
})

describe('BunkPlanReport (PDF) — Bunks/Other/Unmet page', () => {
  it('renders Bunks needing attention, Other issues, and Unmet drill-down on one page', async () => {
    const buf = await renderToBuffer(
      <BunkPlanReport
        sessionName="Session 3"
        year={2026}
        plannerName="Test Staff"
        statistics={makeStats({
          unsatisfied_material_parent_detail: [
            { requester_cm_id: '1', requester_name: 'Emma Johnson', target_cm_id: '2', target_name: 'Liam Garcia', requester_bunk_name: 'Pine 3', target_bunk_name: 'Oak 2' },
          ],
        })}
        impossibilityReport={{
          by_reason: {},
          total_impossible: 0,
          affected_campers: 0,
          flat: [],
          mp_campers_entirely_impossible: [],
        } as any}
        issues={[
          { type: 'capacity_violation', severity: 'error', message: 'Pine 3 over capacity' },
          { type: 'unassigned_campers', severity: 'error', message: '2 unassigned' },
        ]}
      />
    )
    const parser = new PDFParse({ data: buf })
    const result = await parser.getText()
    await parser.destroy()
    const text = result.text
    const flat = stripSpaces(text)

    expect(flat).toMatch(/BUNKSNEEDINGATTENTION/)
    expect(text).toMatch(/Pine 3/)
    expect(flat).toMatch(/OTHERISSUES/)
    expect(text).toMatch(/unassigned/i)
    expect(flat).toMatch(/UNMET/)
    expect(text).toMatch(/Emma Johnson/)
    expect(text).toMatch(/Liam Garcia/)
  }, 30000)
})

describe('BunkPlanReport (PDF) — Families to contact page', () => {
  it('renders Families to contact with all 3 cohorts in alphabetical order', async () => {
    const buf = await renderToBuffer(
      <BunkPlanReport
        sessionName="Session 3"
        year={2026}
        plannerName="Test Staff"
        statistics={makeStats({
          negative_request_violations_detail: [
            { requester_cm_id: '1', target_cm_id: '2', requester_name: 'Riley Sam', target_name: 'Samuel Johnson', bunk_cm_id: '10', bunk_name: 'Pine 3' },
          ],
          priority_unsuccessfuls: [
            { requester_cm_id: '3', target_cm_id: '4', requester_name: 'Sophia Martinez', target_name: 'Mia Wilson', raw_text: 'top priority' },
          ],
        })}
        impossibilityReport={{
          by_reason: {},
          total_impossible: 0,
          affected_campers: 0,
          flat: [],
          mp_campers_entirely_impossible: [
            { cm_id: 5, name: 'Emma Johnson', grade: 5, gender: 'F', reason_codes: ['grade_compatibility'] },
          ],
        } as any}
      />
    )
    const parser = new PDFParse({ data: buf })
    const result = await parser.getText()
    await parser.destroy()
    const text = result.text

    // Section title visible (uppercase form likely "FAMILIES TO CONTACT" with letter-spacing)
    expect(stripSpaces(text)).toMatch(/FAMILIESTOCONTACT/)
    // All three campers visible
    expect(text).toMatch(/Emma Johnson/)
    expect(text).toMatch(/Riley Sam/)
    expect(text).toMatch(/Sophia Martinez/)
    // Alphabetical: Emma < Riley < Sophia
    expect(text.indexOf('Emma Johnson')).toBeLessThan(text.indexOf('Riley Sam'))
    expect(text.indexOf('Riley Sam')).toBeLessThan(text.indexOf('Sophia Martinez'))
  }, 30000)
})

describe('BunkPlanReport (PDF) — Impossibility detail pages', () => {
  it('renders full impossibility detail grouped by reason with friendly labels', async () => {
    const items = [
      { request_id: 'r1', reason_code: 'grade_compatibility', reason_message: 'wide', request_type: 'bunk_with', requester: { cm_id: 1, name: 'Emma Johnson', grade: 5, gender: 'F' }, requestee: { cm_id: 2, name: 'Liam Garcia', grade: 8, gender: 'M' }, detail: {}, bucket: null },
      { request_id: 'r2', reason_code: 'grade_compatibility', reason_message: 'wide', request_type: 'bunk_with', requester: { cm_id: 3, name: 'Olivia Chen', grade: 4, gender: 'F' }, requestee: { cm_id: 4, name: 'Riley Sam', grade: 9, gender: 'F' }, detail: {}, bucket: null },
    ]
    const buf = await renderToBuffer(
      <BunkPlanReport
        sessionName="Session 3"
        year={2026}
        plannerName="Test Staff"
        statistics={makeStats()}
        impossibilityReport={{
          by_reason: { grade_compatibility: items },
          total_impossible: 2,
          affected_campers: 4,
          flat: items,
          mp_campers_entirely_impossible: [],
        } as any}
      />
    )
    const parser = new PDFParse({ data: buf })
    const result = await parser.getText()
    await parser.destroy()
    const text = result.text
    const flat = stripSpaces(text)

    expect(flat).toMatch(/IMPOSSIBILITYDETAIL/)
    // Reason heading with count
    expect(text).toMatch(/Grade range too wide \(2\)/)
    // Each requester + requestee visible
    expect(text).toMatch(/Emma Johnson/)
    expect(text).toMatch(/Liam Garcia/)
    expect(text).toMatch(/Olivia Chen/)
    expect(text).toMatch(/Riley Sam/)
  }, 30000)
})
