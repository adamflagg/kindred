/**
 * The status slot (design-language §5–6): a result reads in its tone. The form-intake visual audit found an "ok"
 * result drawn muted, because the slot's muted ink and the tone's ink were both on it and the muted one won.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { StatusSlot } from './StatusSlot'

describe('StatusSlot', () => {
  it.each([
    ['ok', 'text-forest-700'],
    ['warn', 'text-amber-700'],
  ] as const)('draws a %s result in its own ink, never the muted one', (tone, ink) => {
    render(
      <StatusSlot
        status={{ text: '✓ Added', title: '✓ Added', tone, dismiss: 'result' }}
        onDismiss={vi.fn()}
      />
    )
    const words = screen.getByText('✓ Added')
    expect(words.className).toContain(ink)
    expect(words.className).not.toContain('text-muted-foreground')
  })

  it('draws a plain status muted', () => {
    render(
      <StatusSlot
        status={{ text: '3 checked', title: '3 checked', tone: 'muted' }}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.getByText('3 checked').className).toContain('text-muted-foreground')
  })
})
