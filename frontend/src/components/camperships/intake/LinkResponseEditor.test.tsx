/**
 * Link… (adult aid form mock v2, steps 7–10 and 19; K3 a): the typed line (the respondent email shows only here), the
 * candidates first with their evidence, a search for someone else, what linking does, and Link Response.
 * Fictional data (adultFormFixtures).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { LinkCandidatesOut } from './intakeTypes'
import { ADULT_SESSIONS, CASEY, DANA, DANA_LINK, FC4A, LIN } from './adultFormFixtures'
import { sessionIndex } from './intakeModel'
import { LinkResponseEditor } from './LinkResponseEditor'

const names = sessionIndex(ADULT_SESSIONS)
const NOBODY: LinkCandidatesOut = {
  id: CASEY.id,
  response_id: CASEY.response_id,
  name_typed: 'Casey Sam',
  birthdate_typed: '1977-12-02',
  respondent_email: 'csam@example.com',
  program_choice: "Women's Weekend (Oct 14-17)",
  candidates: [],
}

function renderEditor(extra: Partial<Parameters<typeof LinkResponseEditor>[0]> = {}): {
  onLink: ReturnType<typeof vi.fn>
  onCancel: ReturnType<typeof vi.fn>
  search: ReturnType<typeof vi.fn>
} {
  const onLink = vi.fn(() => Promise.resolve())
  const onCancel = vi.fn()
  const search = vi.fn(() =>
    Promise.resolve([
      {
        person_cm_id: 1000201,
        household_cm_id: 1000020,
        camper_name: 'Dana Ochoa',
        household_label: 'Dana & Luis Ochoa',
        signals: [],
        session_cm_ids: [FC4A],
        registration_status: 'enrolled' as const,
        birthdate: '1988-02-10',
        email: 'dochoa@example.com',
      },
    ])
  )
  render(
    <MemoryRouter>
      <LinkResponseEditor
        response={DANA}
        link={DANA_LINK}
        names={names}
        onLink={onLink}
        onCancel={onCancel}
        search={search}
        {...extra}
      />
    </MemoryRouter>
  )
  return { onLink, onCancel, search }
}
const rowOf = (key: number) =>
  document.querySelector(`tr[data-row-key="${String(key)}"]`) as HTMLElement

describe('Link…', () => {
  it('is titled with the typed name, and shows what the response says, the respondent email only here', () => {
    renderEditor()
    expect(screen.getByText('Link a Response · “Dana Okafor”')).toBeInTheDocument()
    const typed = screen.getByTestId('link-typed')
    expect(typed).toHaveTextContent(
      'Typed: “Dana Okafor” · born 1986-03-12 · sam.lee@example.com · chose Family Camp 4: Labor Day (Sep 3-6)'
    )
  })

  it('K3 a: shows the candidates first, with their registration and each clue checked or not', () => {
    renderEditor()
    expect(
      screen.getByText('The suggestions, registered for the weekend chosen')
    ).toBeInTheDocument()
    const first = rowOf(1000121)
    expect(within(first).getByText('Dana Okafor')).toBeInTheDocument()
    expect(within(first).getByText('⌂ Dana Okafor & Sam Lee')).toBeInTheDocument()
    expect(within(first).getByText('FC4 Adults · enrolled')).toBeInTheDocument()
    expect(first).toHaveTextContent('✓ name')
    expect(first).toHaveTextContent('✗ 1985-09-30')
    expect(first).toHaveTextContent(
      "the typed email is someone else's in their household (a tie-break, never a match)"
    )
    expect(rowOf(1000131)).toHaveTextContent('FC4 Adults · applied')
  })

  it('picks the first candidate, says what linking does, and links the one picked', async () => {
    const { onLink } = renderEditor()
    expect(within(rowOf(1000121)).getByRole('radio')).toBeChecked()
    expect(screen.getByText('Links the response to Dana Okafor')).toBeInTheDocument()
    await userEvent.click(within(rowOf(1000131)).getByRole('radio'))
    expect(screen.getByText('Links the response to Dana Okafor-Reyes')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Link Response' }))
    expect(onLink).toHaveBeenCalledWith(1000131)
  })

  it('finds someone else: Enter in the search adds them under the candidates', async () => {
    const { search, onLink } = renderEditor()
    await userEvent.type(screen.getByLabelText('Someone else'), 'Ochoa{Enter}')
    expect(search).toHaveBeenCalledWith('Ochoa')
    expect(onLink).not.toHaveBeenCalled()
    expect(await screen.findByText('Dana Ochoa')).toBeInTheDocument()
    expect(rowOf(1000201)).toHaveTextContent('✗ name')
  })

  it('with no one to offer: says so, and Link Response stays off', () => {
    renderEditor({ response: CASEY, link: NOBODY })
    expect(
      screen.getByText(
        'No 2027 registration matches “Casey Sam” by name, birthdate or email. Checked every hour.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Link Response' })).toBeDisabled()
    expect(screen.getByText('Nothing to link yet: leave it')).toBeInTheDocument()
  })

  it('on an ignored response: says it undoes the ignore, and who it matches', () => {
    renderEditor({
      response: LIN,
      link: {
        ...DANA_LINK,
        id: LIN.id,
        name_typed: 'Lin Chen',
        candidates: [DANA_LINK.candidates![0]!],
      },
    })
    expect(screen.getByText('Link a Response · “Lin Chen” · undoes the ignore')).toBeInTheDocument()
    expect(
      screen.getByText('Who it matches, registered for the weekend chosen')
    ).toBeInTheDocument()
    expect(screen.getByText('Undoes the ignore')).toBeInTheDocument()
  })

  it('shows a refusal beside the buttons, and Esc cancels', async () => {
    const { onCancel } = renderEditor({
      onLink: vi.fn(() => Promise.reject(new Error('Already linked'))),
    })
    await userEvent.click(screen.getByRole('button', { name: 'Link Response' }))
    expect(await screen.findByText('Already linked')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Someone else'), '{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })
})
