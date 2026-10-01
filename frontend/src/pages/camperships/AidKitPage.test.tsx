import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AidKitPage from './AidKitPage'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidKitPage (Decision 3: the finance kit on fictional data, admin only)', () => {
  it('shows every primitive, each under its own heading', () => {
    render(
      <MemoryRouter initialEntries={['/aid/kit']}>
        <AidKitPage />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Finance kit')
    for (const heading of [
      'Money',
      'Pills and chips',
      'Needs attention',
      'Table',
      'Receipt',
      'Definition notes',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument()
    }
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
  })
})
