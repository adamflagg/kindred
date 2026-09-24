import { render, screen } from '@testing-library/react'
import { Handshake, House, UsersRound } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import type { MarkRunSpec } from './markSpec'
import { MarkRun, MarkRuns } from './MarkRun'
import { SHARE_GLOW_CLASS, SHARE_MOTION_SELECTOR } from './shareEmphasis'

const mark = (key: string, Icon = Handshake) => ({
  key,
  Icon,
  className: 'bg-muted text-muted-foreground',
  tooltip: `tip ${key}`,
  ariaLabel: `aria ${key}`,
})

describe('MarkRun', () => {
  it('draws a single mark as a solo circle', () => {
    render(<MarkRun run={{ key: 'a', hot: false, marks: [mark('a')] }} />)
    expect(screen.getByRole('button', { name: 'aria a' }).className).toContain('rounded-full')
  })

  it('flushes several marks into a capsule by list position', () => {
    const run: MarkRunSpec = {
      key: 'c',
      hot: false,
      testId: 'capsule',
      marks: [mark('family', House), mark('friends', UsersRound)],
    }
    render(<MarkRun run={run} />)
    expect(screen.getByRole('button', { name: 'aria family' }).className).toContain(
      'rounded-l-full'
    )
    expect(screen.getByRole('button', { name: 'aria friends' }).className).toContain(
      'rounded-r-full'
    )
    expect(screen.getByTestId('capsule')).toBeInTheDocument()
  })

  it('glows and carries the motion handle only when hot', () => {
    const { container, rerender } = render(
      <MarkRun run={{ key: 'a', hot: true, marks: [mark('a')] }} />
    )
    expect(container.querySelector(SHARE_MOTION_SELECTOR)?.className).toContain(SHARE_GLOW_CLASS)
    rerender(<MarkRun run={{ key: 'a', hot: false, marks: [mark('a')] }} />)
    expect(container.querySelector(SHARE_MOTION_SELECTOR)).toBeNull()
  })

  it('draws the corner dot, positioned, only when asked', () => {
    const { container } = render(
      <MarkRun run={{ key: 'a', hot: false, dotTestId: 'changed-dot', marks: [mark('a')] }} />
    )
    expect(screen.getByTestId('changed-dot').className).toContain('bg-amber-500')
    expect(container.firstElementChild?.className).toContain('relative')
  })

  it('renders nothing for an empty run or an empty list', () => {
    const { container } = render(
      <>
        <MarkRun run={{ key: 'a', hot: false, marks: [] }} />
        <MarkRuns runs={[]} />
      </>
    )
    expect(container).toBeEmptyDOMElement()
  })
})
