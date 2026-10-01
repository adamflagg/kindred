import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isPageKey, isTypingTarget } from './keyboard'

let modalOpen = false
vi.mock('../../ui/modalStack', () => ({ hasOpenModal: () => modalOpen }))

function input(type: string): HTMLInputElement {
  const el = document.createElement('input')
  el.type = type
  return el
}

const plain = { ctrlKey: false, metaKey: false, altKey: false }

beforeEach(() => {
  modalOpen = false
})

// Ruling 2026-10-01 (plan review): every field whose own keys use the arrows counts as typing.
describe('isTypingTarget (page keys stand aside while you type; Decision 6)', () => {
  it.each([
    'text',
    'search',
    'number',
    'email',
    'date',
    'time',
    'datetime-local',
    'month',
    'week',
    'range',
    'radio',
  ])('is true in a %s input', (type) => {
    expect(isTypingTarget(input(type))).toBe(true)
  })

  it('is true in a textarea, a select, and inside contenteditable', () => {
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(document.createElement('select'))).toBe(true)
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    editable.appendChild(inner)
    document.body.appendChild(editable)
    expect(isTypingTarget(inner)).toBe(true)
    editable.remove()
  })

  it('is false on a checkbox, a button, contenteditable="false", the page, or nothing', () => {
    expect(isTypingTarget(input('checkbox'))).toBe(false)
    expect(isTypingTarget(document.createElement('button'))).toBe(false)
    const off = document.createElement('div')
    off.setAttribute('contenteditable', 'false')
    expect(isTypingTarget(off)).toBe(false)
    expect(isTypingTarget(document.body)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('isPageKey', () => {
  it('is true for a plain key on the page', () => {
    expect(isPageKey({ target: document.body, ...plain })).toBe(true)
  })

  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)(
    'stands aside while %s is held',
    (modifier) => {
      expect(isPageKey({ target: document.body, ...plain, [modifier]: true })).toBe(false)
    }
  )

  it('stands aside in a field, and while a modal is open', () => {
    expect(isPageKey({ target: input('text'), ...plain })).toBe(false)
    modalOpen = true
    expect(isPageKey({ target: document.body, ...plain })).toBe(false)
  })
})
