import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AidDefinitionNotes } from './AidDefinitionNotes'

let state: { notes: Array<{ n: number; text: string }>; isPending: boolean; error: Error | null }
vi.mock('../../../hooks/camperships/useAidDefinitions', () => ({
  useAidDefinitions: () => ({ ...state, numberOf: () => null }),
}))

describe('AidDefinitionNotes', () => {
  it("lists the surface's notes", () => {
    state = {
      notes: [{ n: 1, text: 'Decided: the award computed or decided for the round.' }],
      isPending: false,
      error: null,
    }
    render(<AidDefinitionNotes surface="requests" />)
    expect(screen.getByRole('listitem')).toHaveTextContent('1. Decided')
  })

  it('draws nothing while loading', () => {
    state = { notes: [], isPending: true, error: null }
    const { container } = render(<AidDefinitionNotes surface="requests" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says so when the definitions cannot load, rather than showing figures without them', () => {
    state = { notes: [], isPending: false, error: new Error('boom') }
    render(<AidDefinitionNotes surface="requests" />)
    expect(screen.getByText("The definitions for these figures couldn't load.")).toBeInTheDocument()
  })

  it('keeps the notes it has when a later refetch fails', () => {
    state = {
      notes: [{ n: 1, text: 'Decided: the award computed or decided for the round.' }],
      isPending: false,
      error: new Error('refetch failed'),
    }
    render(<AidDefinitionNotes surface="requests" />)
    expect(screen.getByRole('listitem')).toHaveTextContent('1. Decided')
    expect(screen.queryByText(/couldn't load/)).not.toBeInTheDocument()
  })
})
