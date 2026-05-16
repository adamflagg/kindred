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
