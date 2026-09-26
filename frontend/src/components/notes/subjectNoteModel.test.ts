import { describe, expect, it } from 'vitest'

import type { SubjectNoteRow } from '../../types/subjectNotes'
import {
  camperSubject,
  changedDrafts,
  cornerState,
  editedLine,
  extraLayerCount,
  indexNotes,
  partySubject,
  previewText,
  subjectKey,
} from './subjectNoteModel'

const FC5 = 1000005
const FC6 = 1000006

function row(overrides: Partial<SubjectNoteRow> = {}): SubjectNoteRow {
  return {
    subject_kind: 'household',
    subject_cm_id: 2000001,
    session_cm_id: FC5,
    scenario: '',
    body: 'Grandma is coming Saturday only.',
    updated_by: 'Test Staff',
    updated: '2026-09-25 12:00:00.000Z',
    ...overrides,
  }
}

describe('subjectKey / indexNotes', () => {
  it('keeps a family on FC5 and FC6 apart', () => {
    const index = indexNotes([row(), row({ session_cm_id: FC6, body: 'Just the kids.' })])
    const fc5 = index.get(subjectKey({ kind: 'household', cmId: 2000001, sessionCmId: FC5 }))
    const fc6 = index.get(subjectKey({ kind: 'household', cmId: 2000001, sessionCmId: FC6 }))
    expect(fc5?.standard?.body).toBe('Grandma is coming Saturday only.')
    expect(fc6?.standard?.body).toBe('Just the kids.')
  })

  it('keeps a person and a household with the same cm id apart', () => {
    expect(subjectKey({ kind: 'person', cmId: 5, sessionCmId: FC5 })).not.toBe(
      subjectKey({ kind: 'household', cmId: 5, sessionCmId: FC5 })
    )
  })

  it('files a scenario row as the plan layer', () => {
    const layers = indexNotes([row(), row({ scenario: 'scnA', body: 'Try Pine' })]).get(
      subjectKey({ kind: 'household', cmId: 2000001, sessionCmId: FC5 })
    )
    expect(layers?.plan?.body).toBe('Try Pine')
  })
})

describe('cornerState', () => {
  it('is a ghost with no note, standard with one, plan with only a plan note, and dotted with both', () => {
    expect(cornerState({})).toEqual({ mode: 'ghost', both: false })
    expect(cornerState({ standard: row() })).toEqual({ mode: 'standard', both: false })
    expect(cornerState({ plan: row({ scenario: 'scnA' }) })).toEqual({ mode: 'plan', both: false })
    expect(cornerState({ standard: row(), plan: row({ scenario: 'scnA' }) })).toEqual({
      mode: 'standard',
      both: true,
    })
  })
})

describe('previewText', () => {
  it('keeps 120 characters and marks the cut', () => {
    const body = `${'a'.repeat(118)} bcdef`
    expect(previewText(body)).toBe(`${'a'.repeat(118)} b…`)
    expect(previewText('short')).toBe('short')
  })

  it('counts one more layer only when both exist', () => {
    expect(extraLayerCount({ standard: row() })).toBe(0)
    expect(extraLayerCount({ standard: row(), plan: row({ scenario: 'scnA' }) })).toBe(1)
  })
})

describe('partySubject / camperSubject', () => {
  it('keys a household party by its household id', () => {
    expect(
      partySubject({ grain: 'household', household_cm_id: 2000001, person_cm_id: 0 }, FC5)
    ).toEqual({
      kind: 'household',
      cmId: 2000001,
      sessionCmId: FC5,
    })
  })

  it('keys an adult guest by the person id', () => {
    expect(
      partySubject({ grain: 'person', household_cm_id: 0, person_cm_id: 1000004 }, FC5)
    ).toEqual({
      kind: 'person',
      cmId: 1000004,
      sessionCmId: FC5,
    })
  })

  it('gives a party with a 0 id no subject at all (RosterParty serialises the unused id as 0)', () => {
    expect(
      partySubject({ grain: 'household', household_cm_id: 0, person_cm_id: 0 }, FC5)
    ).toBeNull()
  })

  it('keys an AG camper by the AG session, never the board session', () => {
    expect(camperSubject({ person_cm_id: 1000102, session_cm_id: 1000002 })).toEqual({
      kind: 'person',
      cmId: 1000102,
      sessionCmId: 1000002,
    })
  })
})

describe('changedDrafts', () => {
  it('reports only layers whose trimmed text moved', () => {
    const layers = { standard: row({ body: 'Same' }) }
    expect(changedDrafts(layers, { standard: 'Same  ', plan: null })).toEqual({})
    expect(changedDrafts(layers, { standard: 'New', plan: null })).toEqual({ standard: 'New' })
    expect(changedDrafts(layers, { standard: 'Same', plan: 'Only here' })).toEqual({
      plan: 'Only here',
    })
  })
})

describe('editedLine', () => {
  it('says nothing is saved yet, or when and who', () => {
    expect(editedLine(undefined)).toBe('Nothing saved yet')
    expect(editedLine(row())).toBe('edited Sep 25 · Test Staff')
  })
})
