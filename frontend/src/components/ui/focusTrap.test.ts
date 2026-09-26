import { afterEach, describe, expect, it } from 'vitest'

import { trapTab } from './focusTrap'

function build(): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML =
    '<button>One</button><textarea aria-label="Body"></textarea><a href="#x">Link</a><button>Last</button>'
  document.body.appendChild(root)
  return root
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('trapTab', () => {
  it('cycles through EVERY focusable, not only buttons', () => {
    const root = build()
    root.querySelector('button')?.focus()
    trapTab(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }), root)
    expect(document.activeElement?.tagName).toBe('TEXTAREA')
    trapTab(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }), root)
    expect(document.activeElement?.tagName).toBe('A')
  })

  it('wraps backwards from the first element', () => {
    const root = build()
    root.querySelector('button')?.focus()
    trapTab(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }), root)
    expect(document.activeElement?.textContent).toBe('Last')
  })

  it('ignores other keys', () => {
    const root = build()
    expect(trapTab(new KeyboardEvent('keydown', { key: 'Enter' }), root)).toBe(false)
  })

  it('skips a tabindex="-1" element -- a programmatic focus target, not a Tab stop', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<button>One</button><button tabindex="-1">Skip</button><textarea aria-label="Body"></textarea>'
    document.body.appendChild(root)
    root.querySelector('button')?.focus()
    trapTab(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }), root)
    expect(document.activeElement?.tagName).toBe('TEXTAREA')
  })
})
