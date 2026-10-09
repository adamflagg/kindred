/**
 * The explanatory copy primitives (design-language §16; kit CF.does / CF.fx): a callout with a bold
 * lead under a 3px rule, and one effect per line with ✓ ○ ⚠ and a muted → line. Fictional words.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Does, Effects } from './Effects'

describe('Does: the callout under a group heading', () => {
  it('sits on its own line under a 3px primary rule, 12.5px', () => {
    render(
      <Does>
        <b>Confirm</b> → marks the round Posted ✓
      </Does>
    )
    const box = screen.getByText('→', { exact: false }).closest('[data-does]') as HTMLElement
    expect(box).toHaveClass('border-l-[3px]')
    expect(box).toHaveClass('border-primary')
    expect(box).toHaveClass('text-[12.5px]')
  })

  it('draws the grant rule sky and the nothing-to-mark rule amber', () => {
    const { rerender } = render(<Does tone="grant">x</Does>)
    expect(screen.getByText('x')).toHaveClass('border-sky-600')
    rerender(<Does tone="warn">x</Does>)
    expect(screen.getByText('x')).toHaveClass('border-amber-500')
  })

  it('keeps a line break between lines of one callout', () => {
    render(
      <Does
        lines={[
          'Confirm → lowers the camper’s share in that round',
          'Posted and the camp’s budget don’t move',
        ]}
      />
    )
    expect(screen.getByText('Posted and the camp’s budget don’t move')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-does] > div')).toHaveLength(2)
  })
})

describe('Effects: one effect per line', () => {
  it('puts a symbol in front of each line, coloured by its state', () => {
    render(
      <Effects
        items={[
          { sym: 'ok', text: 'Marks Posted · R2 · $780' },
          {
            sym: 'hand',
            text: 'R1 stays unchecked',
            then: '→ Mark Posted by hand if that’s right',
          },
          { sym: 'warn', text: 'R2 not marked Posted' },
          { sym: 'info', text: 'Places $1,420' },
        ]}
      />
    )
    const items = document.querySelectorAll('[data-effect]')
    expect(items).toHaveLength(4)
    expect(items[0]?.querySelector('[data-sym]')).toHaveTextContent('✓')
    expect(items[0]?.querySelector('[data-sym]')).toHaveClass('text-forest-700')
    expect(items[1]?.querySelector('[data-sym]')).toHaveTextContent('○')
    expect(items[1]?.querySelector('[data-sym]')).toHaveClass('text-muted-foreground')
    expect(items[2]?.querySelector('[data-sym]')).toHaveTextContent('⚠')
    expect(items[2]?.querySelector('[data-sym]')).toHaveClass('text-amber-700')
    expect(items[3]?.querySelector('[data-sym]')).toHaveTextContent('·')
  })

  it('puts the → next step on its own muted line, indented under the words', () => {
    render(
      <Effects
        items={[
          {
            sym: 'hand',
            text: 'R1 stays unchecked',
            then: '→ Mark Posted by hand if that’s right',
          },
        ]}
      />
    )
    const then = screen.getByText('→ Mark Posted by hand if that’s right')
    expect(then).toHaveClass('block', 'ml-4', 'text-muted-foreground')
  })
})
