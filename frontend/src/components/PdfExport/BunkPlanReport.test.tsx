import { describe, it, expect } from 'vitest'
import { pdf } from '@react-pdf/renderer'
import type { DocumentProps } from '@react-pdf/renderer'
import { PDFParse } from 'pdf-parse'
import { BunkPlanReport } from './BunkPlanReport'
import type { ReactElement } from 'react'

// Render through the SAME build the app ships. `vitest.config.ts` gives this
// file its own project with resolve.conditions: ['browser'], so @react-pdf
// resolves exactly as Vite bundles it. The node build's renderToBuffer() is
// not a code path any user exercises.
async function renderToBuffer(el: ReactElement<DocumentProps>): Promise<Buffer> {
  const blob = await pdf(el).toBlob()
  return Buffer.from(await blob.arrayBuffer())
}

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
              session_cm_id: 1000001,
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
            capacity_by_gender: {
              female: { capacity: 65, assigned: 62 },
              male: { capacity: 85, assigned: 66 },
            },
          })}
          impossibilityReport={
            {
              by_reason: { grade_compatibility: [{}, {}, {}, {}, {}, {}, {}] },
              total_impossible: 7,
              affected_campers: 5,
              flat: [],
              mp_campers_entirely_impossible: [],
            } as any
          }
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

describe('BunkPlanReport (PDF) — Bunks/Other page', () => {
  it('renders Bunks needing attention, Other issues, and families-to-contact for sacrificed MP', async () => {
    const buf = await renderToBuffer(
      <BunkPlanReport
        sessionName="Session 3"
        year={2026}
        plannerName="Test Staff"
        statistics={makeStats({
          // Stream D Phase 3: unsatisfied_material_parent_detail entries now appear
          // in "Families to contact" (sacrificed_mp cohort) so staff can follow up.
          // unsatisfied_material_parent_persons (per-person view) does NOT drive any
          // PDF section — only the per-request detail list does.
          unsatisfied_material_parent_detail: [
            {
              requester_cm_id: '1',
              requester_name: 'Emma Johnson',
              request_type: 'bunk_with',
              target_cm_id: '2',
              target_name: 'Liam Garcia',
              requester_bunk_name: 'Pine 3',
              target_bunk_name: 'Oak 2',
            },
          ],
          unsatisfied_material_parent_persons: [{ cm_id: 2001, name: 'Riley Sam' }],
        })}
        impossibilityReport={
          {
            by_reason: {},
            total_impossible: 0,
            affected_campers: 0,
            flat: [],
            mp_campers_entirely_impossible: [],
          } as any
        }
        issues={[
          {
            type: 'capacity_violation',
            severity: 'error',
            message: 'Bunk Pine 3 is over capacity',
          },
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
    // sacrificed_mp entries now appear in "Families to contact" (Stream D Phase 3).
    expect(text).toMatch(/Emma Johnson/)
    // unsatisfied_material_parent_persons (per-person list) does NOT drive any PDF section.
    expect(text).not.toMatch(/Riley Sam/)
  }, 30000)
})

describe('BunkPlanReport (PDF) — Families to contact page', () => {
  it('renders Families to contact with all 3 cohorts in grade-first order', async () => {
    const buf = await renderToBuffer(
      <BunkPlanReport
        sessionName="Session 3"
        year={2026}
        plannerName="Test Staff"
        statistics={makeStats({
          negative_request_violations_detail: [
            {
              requester_cm_id: '1',
              target_cm_id: '2',
              requester_name: 'Riley Sam',
              target_name: 'Samuel Johnson',
              bunk_cm_id: '10',
              bunk_name: 'Pine 3',
              session_cm_id: '1000001',
              requester_grade: 6, // grade 6 — appears after grade 5
            },
          ],
          priority_unsuccessfuls: [
            {
              requester_cm_id: '3',
              target_cm_id: '4',
              requester_name: 'Sophia Martinez',
              target_name: 'Mia Wilson',
              raw_text: 'top priority',
              session_cm_id: '1000001',
              requester_grade: 7, // grade 7 — appears last
            },
          ],
        })}
        impossibilityReport={
          {
            by_reason: {},
            total_impossible: 0,
            affected_campers: 0,
            flat: [],
            mp_campers_entirely_impossible: [
              {
                cm_id: 5,
                name: 'Emma Johnson',
                grade: 5,
                gender: 'F',
                reason_codes: ['grade_compatibility'],
                session_cm_id: 1000001,
              },
            ],
          } as any
        }
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
    // Grade-first order: Emma (5) < Riley (6) < Sophia (7)
    expect(text.indexOf('Emma Johnson')).toBeLessThan(text.indexOf('Riley Sam'))
    expect(text.indexOf('Riley Sam')).toBeLessThan(text.indexOf('Sophia Martinez'))
  }, 30000)
})

describe('BunkPlanReport (PDF) — Families to contact: sub-rows always visible', () => {
  it('renders all sub-rows beneath each camper without session-label prefixes', async () => {
    // Emma Johnson is enrolled in two sessions — should appear once with both
    // detail sub-rows always visible in the PDF. No S0001/S0003 session labels.
    const buf = await renderToBuffer(
      <BunkPlanReport
        sessionName="Session 3"
        year={2026}
        plannerName="Test Staff"
        statistics={makeStats()}
        impossibilityReport={{
          total_impossible: 2,
          affected_campers: 1,
          by_reason: {},
          flat: [],
          mp_campers_entirely_impossible: [
            {
              cm_id: 1,
              name: 'Emma Johnson',
              grade: 4,
              gender: 'F',
              session_cm_id: 1000001,
              reason_codes: ['no_valid_bunk'],
            },
            {
              cm_id: 1,
              name: 'Emma Johnson',
              grade: 4,
              gender: 'F',
              session_cm_id: 1000003,
              reason_codes: ['no_valid_bunk'],
            },
          ],
        }}
      />
    )
    const parser = new PDFParse({ data: buf })
    const result = await parser.getText()
    await parser.destroy()
    const text = result.text

    // Camper name appears
    expect(text).toMatch(/Emma Johnson/)
    // Sub-rows contain "All requests impossible" detail for each session
    expect(text).toMatch(/All requests impossible/)
    // Session-label prefixes (S0001, S0003) should NOT appear
    expect(text).not.toMatch(/S0001/)
    expect(text).not.toMatch(/S0003/)
  }, 30000)
})

describe('BunkPlanReport (PDF) — Impossibility detail pages', () => {
  it('renders full impossibility detail grouped by reason with friendly labels', async () => {
    const items = [
      {
        request_id: 'r1',
        reason_code: 'grade_compatibility',
        reason_message: 'wide',
        request_type: 'bunk_with',
        requester: { cm_id: 1, name: 'Emma Johnson', grade: 5, gender: 'F' },
        requestee: { cm_id: 2, name: 'Liam Garcia', grade: 8, gender: 'M' },
        detail: {},
        bucket: null,
      },
      {
        request_id: 'r2',
        reason_code: 'grade_compatibility',
        reason_message: 'wide',
        request_type: 'bunk_with',
        requester: { cm_id: 3, name: 'Olivia Chen', grade: 4, gender: 'F' },
        requestee: { cm_id: 4, name: 'Riley Sam', grade: 9, gender: 'F' },
        detail: {},
        bucket: null,
      },
    ]
    const buf = await renderToBuffer(
      <BunkPlanReport
        sessionName="Session 3"
        year={2026}
        plannerName="Test Staff"
        statistics={makeStats()}
        impossibilityReport={
          {
            by_reason: { grade_compatibility: items },
            total_impossible: 2,
            affected_campers: 4,
            flat: items,
            mp_campers_entirely_impossible: [],
          } as any
        }
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

describe('BunkPlanReport (PDF) — off-roster requester (kindred#2689)', () => {
  it('renders "#<cm_id>" on the impossibility detail page, matching the families table', async () => {
    // impossibility.py emits requester={"cm_id": ...} when the requester person
    // is not in the solver's roster. This page carried a stale inline copy of
    // the requester type, so it rendered an em dash where the four standardized
    // sites render "#<cm_id>" -- and both appear in THIS SAME PDF. kindred#2692
    // scan, finding 4.
    const offRoster = {
      request_id: 'r_off',
      reason_code: 'malformed',
      reason_message: 'missing requestee_id',
      request_type: 'bunk_with',
      requester: { cm_id: 999 },
      requestee: null,
      detail: {},
      bucket: 'material_parent' as const,
    }
    const buf = await renderToBuffer(
      <BunkPlanReport
        sessionName="Session 4"
        year={2026}
        plannerName="Test Staff"
        statistics={makeStats()}
        impossibilityReport={{
          total_impossible: 1,
          affected_campers: 1,
          by_reason: { malformed: [offRoster] },
          flat: [offRoster],
          mp_campers_entirely_impossible: [],
        }}
      />
    )
    const result = await new PDFParse({ data: buf }).getText()
    // "#999" must appear TWICE: once in the families-to-contact table (page 3)
    // and once in the impossibility detail table (pages 4-N). Asserting mere
    // presence is a false green -- the families table alone satisfies it, which
    // is exactly how the two pages disagreed inside one document.
    const hits = (result.text.match(/#999/g) ?? []).length
    expect(hits).toBeGreaterThanOrEqual(2)
  }, 30000)
})
