import { fireEvent, render, screen } from '@testing-library/react'
import { CalendarDays, House, UsersRound } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { ChipCapsule, ChoiceRow, NoteRow, RowChip, RowText } from './panelRows'

describe('panel rows', () => {
  it('ChoiceRow draws the chip, a bold label and an optional provenance tag', () => {
    render(
      <ul>
        <ChoiceRow
          chip={<RowChip Icon={CalendarDays} className="rounded-full" testId="chip" />}
          label="Submitted Aug 31"
          tag="Jotform"
        />
      </ul>
    )
    expect(screen.getByTestId('chip').className).toContain('h-[22px]')
    expect(screen.getByText('Submitted Aug 31').className).toContain('font-semibold')
    expect(screen.getByText('Jotform').className).toContain('uppercase')
  })

  it('ChipCapsule caps by list position', () => {
    render(
      <ChipCapsule
        chips={[
          { key: 'family', Icon: House, className: 'bg-muted', testId: 'c-family' },
          { key: 'friends', Icon: UsersRound, className: 'bg-muted', testId: 'c-friends' },
        ]}
      />
    )
    expect(screen.getByTestId('c-family').className).toContain('rounded-l-full')
    expect(screen.getByTestId('c-friends').className).toContain('rounded-r-full')
  })

  it('NoteRow is a whole-row disclosure button whose body shows only when expanded', () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <ul>
        <NoteRow chip={<span />} label="Bunking request" tag="Jotform" expanded onToggle={onToggle}>
          <RowText text="Liam Garcia" testId="body" />
        </NoteRow>
      </ul>
    )
    fireEvent.click(screen.getByRole('button', { name: /Bunking request/ }))
    expect(onToggle).toHaveBeenCalledOnce()
    expect(screen.getByTestId('body')).toHaveTextContent('Liam Garcia')
    rerender(
      <ul>
        <NoteRow chip={<span />} label="Bunking request" expanded={false} onToggle={onToggle}>
          <RowText text="Liam Garcia" testId="body" />
        </NoteRow>
      </ul>
    )
    expect(screen.queryByTestId('body')).toBeNull()
  })
})
