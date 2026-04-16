import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RawDataPanel } from './RawDataPanel'

const fixture = {
  share_bunk_with: 'fixture share',
  do_not_share_bunk_with: 'fixture do-not',
  internal_bunk_notes: 'fixture internal',
  bunking_notes_notes: 'fixture bunking',
  ret_parent_socialize_with_best: 'fixture social',
  first_name: 'Emma',
  last_name: 'Johnson',
  person_cm_id: 1000001,
}

describe('RawDataPanel labels', () => {
  it('renders the updated CSV source-field labels', () => {
    render(<RawDataPanel data={fixture as never} year={2026} defaultExpanded={true} />)
    expect(screen.getByText('Bunk Request Form')).toBeTruthy()
    expect(screen.getByText('Do NOT Share Bunk With')).toBeTruthy()
    expect(screen.getByText('Social With Checkbox')).toBeTruthy()
    expect(screen.getByText('Internal Notes')).toBeTruthy()
    expect(screen.getByText('Bunking Notes')).toBeTruthy()
  })
})
