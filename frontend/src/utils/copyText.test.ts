import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { copyText } from './copyText'

describe('copyText', () => {
  let originalClipboardDescriptor: PropertyDescriptor | undefined
  let originalExec: typeof document.execCommand

  beforeEach(() => {
    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    originalExec = document.execCommand
  })

  afterEach(() => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor)
    } else {
      // Best-effort cleanup in environments where clipboard didn't exist beforehand.
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        configurable: true,
      })
    }
    document.execCommand = originalExec
  })

  it('prefers navigator.clipboard.writeText when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const exec = vi.fn(() => true)
    document.execCommand = exec as typeof document.execCommand

    const ok = await copyText('hello')

    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(exec).not.toHaveBeenCalled()
  })

  it('falls back to execCommand when navigator.clipboard is undefined', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    })
    const exec = vi.fn(() => true)
    document.execCommand = exec as typeof document.execCommand
    const removeSpy = vi.spyOn(document.body, 'removeChild')

    const ok = await copyText('payload')

    expect(ok).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    // textarea was appended then removed — no DOM leak.
    expect(removeSpy).toHaveBeenCalledOnce()
    expect(document.querySelector('textarea[readonly]')).toBeNull()
  })

  it('falls back to execCommand when navigator.clipboard.writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'))
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const exec = vi.fn(() => true)
    document.execCommand = exec as typeof document.execCommand

    const ok = await copyText('after-reject')

    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalled()
    expect(exec).toHaveBeenCalledWith('copy')
  })

  it('returns false when both clipboard and execCommand fail, still cleans up the textarea', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    })
    document.execCommand = vi.fn(() => {
      throw new Error('not allowed')
    }) as typeof document.execCommand

    const ok = await copyText('boom')

    expect(ok).toBe(false)
    expect(document.querySelector('textarea[readonly]')).toBeNull()
  })
})
