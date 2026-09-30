import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router'
import { ProgramProvider } from '../contexts/ProgramContext'
import ProgramLandingPage from './ProgramLandingPage'

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function renderPage() {
  return render(
    <ProgramProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ProgramLandingPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ProgramProvider>
  )
}

const cardFor = (name: string) =>
  screen.getByRole('button', { name: new RegExp(name) }).querySelector('[data-glow-card]')

// setup.ts swaps localStorage for vi.fn()s, so assert on the write, not a read-back.
beforeEach(() => vi.mocked(localStorage.setItem).mockClear())

describe('ProgramLandingPage', () => {
  it('offers the three programs, in order', () => {
    renderPage()

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Summer Bunking', 'Weekend Housing', 'Camp Analytics'])
  })

  it('makes every program a glow card inside one pointer-tracked group', () => {
    renderPage()

    const cards = ['Summer Bunking', 'Weekend Housing', 'Camp Analytics'].map(cardFor)
    cards.forEach((card) => expect(card).toHaveClass('card-lodge', 'glow-card'))

    // One group, so a neighbour's edge can light as the pointer nears it.
    const group = cards[0]!.closest('[data-glow-group]')
    expect(group).not.toBeNull()
    cards.forEach((card) => expect(group).toContainElement(card as HTMLElement))
  })

  it.each([
    ['Summer Bunking', '/summer/sessions', 'summer'],
    ['Weekend Housing', '/weekend/sessions', 'weekend'],
    ['Camp Analytics', '/analytics', 'analytics'],
  ])('choosing %s remembers it and opens %s', async (name, path, stored) => {
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: new RegExp(name) }))

    expect(screen.getByTestId('where')).toHaveTextContent(path)
    expect(localStorage.setItem).toHaveBeenCalledWith('bunking-program-selection', stored)
  })

  it('keeps each card’s features and call to action', () => {
    renderPage()

    const summer = screen.getByRole('button', { name: /Summer Bunking/ })
    expect(within(summer).getByText('Bunk request matching')).toBeInTheDocument()
    expect(within(summer).getByText('Enter Summer Bunking')).toBeInTheDocument()
  })
})
