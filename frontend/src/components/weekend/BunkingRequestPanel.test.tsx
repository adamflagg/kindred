import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { BunkingRequest } from '../../types/lodging'
import { BunkingRequestPanel } from './BunkingRequestPanel'

const base = (overrides: Partial<BunkingRequest> = {}): BunkingRequest => ({
  state: 'request',
  current_text: 'Emma Johnson, Olivia Chen',
  submitted: ['2026-08-03 09:00:00', '2026-08-31 09:00:00'],
  coming_with: ['family', 'friends'],
  ...overrides,
})

describe('BunkingRequestPanel', () => {
  it('shows the request with changes inline and the changed caption', () => {
    render(
      <BunkingRequestPanel
        request={base({
          change: {
            kind: 'list',
            from_date: '2026-08-03 09:00:00',
            to_date: '2026-08-31 09:00:00',
            items: [
              { text: 'Emma Johnson', op: 'keep' },
              { text: 'Liam Garcia', op: 'remove' },
              { text: 'Riley Samm', op: 'respell', was: 'Sam' },
              { text: 'Olivia Chen', op: 'add' },
            ],
          },
        })}
      />
    )
    const inline = screen.getByTestId('bunking-request-inline')
    expect(within(inline).getByText('Liam Garcia').className).toContain('line-through')
    expect(within(inline).getByText('Olivia Chen').className).toContain('text-green-700')
    expect(inline).toHaveTextContent('Riley Samm (was Sam)')
    expect(screen.getByText('Changed · Aug 3 → Aug 31')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bunking request/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('falls back to every version for prose', () => {
    render(
      <BunkingRequestPanel
        request={base({
          change: {
            kind: 'prose',
            from_date: '2026-08-03 09:00:00',
            to_date: '2026-08-31 09:00:00',
            versions: [
              { submitted_at: '2026-08-03 09:00:00', text: 'Emma Johnson' },
              {
                submitted_at: '2026-08-31 09:00:00',
                text: 'I would love Emma Johnson if possible',
              },
            ],
          },
        })}
      />
    )
    const versions = screen.getByTestId('bunking-request-versions')
    expect(versions).toHaveTextContent('Aug 3')
    expect(versions).toHaveTextContent('Aug 31 · current')
    // An earlier version is DIMMED below the current one: `opacity-60` as its
    // own token, in place of MK_SAY's `.85` (both on one element leaves the
    // .85 winning, and a glued "opacity-[.85]opacity-60" renders neither, so
    // the earlier version came out brighter than the current one).
    const [earlier, current] = Array.from(versions.querySelectorAll('p'))
    expect(earlier?.classList.contains('opacity-60')).toBe(true)
    expect(earlier?.classList.contains('opacity-[.85]')).toBe(false)
    expect(current?.classList.contains('opacity-[.85]')).toBe(true)
    expect(current?.classList.contains('opacity-60')).toBe(false)
  })

  it('captions identical re-filings', () => {
    render(<BunkingRequestPanel request={base({ change: { kind: 'identical', count: 2 } })} />)
    expect(screen.getByText('Filed 2 times · identical')).toBeInTheDocument()
    expect(screen.getByTestId('bunking-request-text')).toHaveTextContent(
      'Emma Johnson, Olivia Chen'
    )
  })

  it('shows coming-with ticks as a capsule and the submitted dates', () => {
    render(<BunkingRequestPanel request={base({ staff_linked: true })} />)
    expect(screen.getByText('Coming with family + with friends')).toBeInTheDocument()
    expect(screen.getByTestId('coming-with-chip-family').className).toContain('rounded-l-full')
    expect(screen.getByText('Submitted Aug 31')).toBeInTheDocument()
    expect(screen.getByText('also Aug 3')).toBeInTheDocument()
    expect(screen.getByText('Staff link')).toBeInTheDocument()
    expect(screen.getAllByText('Jotform · Aug 31').length).toBeGreaterThan(0)
  })

  it('says "No bunking request" for a filing without one', () => {
    render(
      <BunkingRequestPanel request={base({ state: 'none', current_text: '', coming_with: [] })} />
    )
    expect(screen.getByText('No bunking request')).toBeInTheDocument()
    expect(screen.queryByTestId('bunking-request-inline')).toBeNull()
  })

  it('is one dotted row when there is no form yet', () => {
    render(<BunkingRequestPanel request={{ state: 'no_form' }} />)
    expect(screen.getByText('No Jotform submission yet')).toBeInTheDocument()
    expect(screen.getByTestId('bunking-request-chip').className).toContain('border-dotted')
    expect(screen.queryByText(/Submitted/)).toBeNull()
  })

  // P8 (controller ruling): the change body shows whenever `change` is set,
  // `state: 'none'` included — a blank re-file WITHDRAWS the request.
  it('shows a blank re-file’s earlier requestees struck, under "No bunking request"', () => {
    render(
      <BunkingRequestPanel
        request={base({
          state: 'none',
          current_text: '',
          coming_with: [],
          changed: true,
          change: {
            kind: 'list',
            from_date: '2026-08-03 09:00:00',
            to_date: '2026-08-31 09:00:00',
            items: [
              { text: 'Emma Johnson', op: 'remove' },
              { text: 'Liam Garcia', op: 'remove' },
            ],
          },
        })}
      />
    )
    expect(screen.getByRole('button', { name: /No bunking request/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    const inline = screen.getByTestId('bunking-request-inline')
    expect(within(inline).getByText('Emma Johnson').className).toContain('line-through')
    expect(within(inline).getByText('Liam Garcia').className).toContain('line-through')
    expect(screen.getByText('Changed · Aug 3 → Aug 31')).toBeInTheDocument()
    expect(screen.getByTestId('bunking-request-chip').className).toContain('bg-muted')
  })

  it('renders a blank prose version as "No request"', () => {
    render(
      <BunkingRequestPanel
        request={base({
          state: 'none',
          current_text: '',
          coming_with: [],
          changed: true,
          change: {
            kind: 'prose',
            from_date: '2026-08-03 09:00:00',
            to_date: '2026-08-31 09:00:00',
            versions: [
              { submitted_at: '2026-08-03 09:00:00', text: 'Whoever Emma Johnson rooms with' },
              { submitted_at: '2026-08-31 09:00:00', text: '' },
            ],
          },
        })}
      />
    )
    const versions = screen.getByTestId('bunking-request-versions')
    expect(versions).toHaveTextContent('Whoever Emma Johnson rooms with')
    expect(versions).toHaveTextContent('Aug 31 · current')
    expect(within(versions).getByText('No request')).toBeInTheDocument()
  })
})
