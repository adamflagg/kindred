/**
 * TDD Tests for useUndoStack Hook
 *
 * Tests the in-session undo stack for request actions (approve/decline).
 * Stack is client-only: React state, cleared on page refresh.
 * Capacity: up to 3 entries (oldest drops off when a 4th is pushed).
 *
 * Following TDD: These tests are written FIRST to define expected behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useUndoStack, type UndoEntry } from './useUndoStack'

describe('useUndoStack', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('initial state', () => {
    it('starts with an empty stack and canUndo false', () => {
      const { result } = renderHook(() => useUndoStack())

      expect(result.current.stackSize).toBe(0)
      expect(result.current.canUndo).toBe(false)
    })
  })

  describe('push', () => {
    it('pushes an entry and sets canUndo to true', () => {
      const { result } = renderHook(() => useUndoStack())
      const inverse = vi.fn().mockResolvedValue(undefined)

      act(() => {
        result.current.push({ id: 'req1', label: 'Approved Emma Johnson → Liam Garcia', inverse })
      })

      expect(result.current.stackSize).toBe(1)
      expect(result.current.canUndo).toBe(true)
    })

    it('stacks up to 3 entries', () => {
      const { result } = renderHook(() => useUndoStack())

      act(() => {
        result.current.push({
          id: 'req1',
          label: 'Action 1',
          inverse: vi.fn().mockResolvedValue(undefined),
        })
        result.current.push({
          id: 'req2',
          label: 'Action 2',
          inverse: vi.fn().mockResolvedValue(undefined),
        })
        result.current.push({
          id: 'req3',
          label: 'Action 3',
          inverse: vi.fn().mockResolvedValue(undefined),
        })
      })

      expect(result.current.stackSize).toBe(3)
      expect(result.current.canUndo).toBe(true)
    })

    it('drops the oldest entry when a 4th is pushed (capacity 3)', () => {
      const { result } = renderHook(() => useUndoStack())
      const inv1 = vi.fn().mockResolvedValue(undefined)
      const inv2 = vi.fn().mockResolvedValue(undefined)
      const inv3 = vi.fn().mockResolvedValue(undefined)
      const inv4 = vi.fn().mockResolvedValue(undefined)

      act(() => {
        result.current.push({ id: 'req1', label: 'Action 1', inverse: inv1 })
        result.current.push({ id: 'req2', label: 'Action 2', inverse: inv2 })
        result.current.push({ id: 'req3', label: 'Action 3', inverse: inv3 })
        result.current.push({ id: 'req4', label: 'Action 4', inverse: inv4 })
      })

      // Stack stays at 3
      expect(result.current.stackSize).toBe(3)
      expect(result.current.canUndo).toBe(true)
      // Peek should show the most recent entry
      expect(result.current.peek()?.label).toBe('Action 4')
    })

    it('deduplicates by id — pushing same id twice yields stack length 1 with latest entry', () => {
      const { result } = renderHook(() => useUndoStack())
      const inv1 = vi.fn().mockResolvedValue(undefined)
      const inv2 = vi.fn().mockResolvedValue(undefined)

      act(() => {
        result.current.push({ id: 'req-a', label: 'First push for req-a', inverse: inv1 })
      })
      act(() => {
        result.current.push({ id: 'req-a', label: 'Second push for req-a', inverse: inv2 })
      })

      // Only one entry — the second replaces the first
      expect(result.current.stackSize).toBe(1)
      expect(result.current.peek()?.label).toBe('Second push for req-a')
      expect(result.current.peek()?.inverse).toBe(inv2)
    })

    it('peek() returns the top (most recent) entry without modifying the stack', () => {
      const { result } = renderHook(() => useUndoStack())
      const inverse = vi.fn().mockResolvedValue(undefined)

      act(() => {
        result.current.push({ id: 'req1', label: 'First action', inverse })
        result.current.push({ id: 'req2', label: 'Second action', inverse })
      })

      const peeked = result.current.peek()
      expect(peeked?.label).toBe('Second action')
      // Stack unchanged
      expect(result.current.stackSize).toBe(2)
    })
  })

  describe('undo (pop)', () => {
    it('undo() returns the most recent entry and shrinks stack by 1', async () => {
      const { result } = renderHook(() => useUndoStack())
      const inv1 = vi.fn().mockResolvedValue(undefined)
      const inv2 = vi.fn().mockResolvedValue(undefined)
      const inv3 = vi.fn().mockResolvedValue(undefined)

      act(() => {
        result.current.push({ id: 'req1', label: 'Action 1', inverse: inv1 })
        result.current.push({ id: 'req2', label: 'Action 2', inverse: inv2 })
        result.current.push({ id: 'req3', label: 'Action 3', inverse: inv3 })
      })

      // Undo once — capture result outside act to avoid TS control-flow narrowing to never
      const popped: { value: UndoEntry | undefined } = { value: undefined }
      act(() => {
        popped.value = result.current.pop()
      })

      expect(popped.value?.label).toBe('Action 3')
      expect(popped.value?.inverse).toBe(inv3)
      expect(result.current.stackSize).toBe(2)
    })

    it('undo() is a no-op when stack is empty, canUndo stays false', () => {
      const { result } = renderHook(() => useUndoStack())

      let popped: UndoEntry | undefined = undefined
      act(() => {
        popped = result.current.pop()
      })

      expect(popped).toBeUndefined()
      expect(result.current.stackSize).toBe(0)
      expect(result.current.canUndo).toBe(false)
    })

    it('canUndo becomes false after undoing the last entry', () => {
      const { result } = renderHook(() => useUndoStack())
      const inverse = vi.fn().mockResolvedValue(undefined)

      act(() => {
        result.current.push({ id: 'req1', label: 'Action 1', inverse })
      })

      expect(result.current.canUndo).toBe(true)

      act(() => {
        result.current.pop()
      })

      expect(result.current.canUndo).toBe(false)
      expect(result.current.stackSize).toBe(0)
    })

    it('undoes in LIFO order (last in, first out)', () => {
      const { result } = renderHook(() => useUndoStack())
      const labels: string[] = []

      act(() => {
        result.current.push({
          id: 'req1',
          label: 'Approved Olivia Chen',
          inverse: vi.fn().mockResolvedValue(undefined),
        })
        result.current.push({
          id: 'req2',
          label: 'Declined Liam Garcia',
          inverse: vi.fn().mockResolvedValue(undefined),
        })
        result.current.push({
          id: 'req3',
          label: 'Approved Emma Johnson',
          inverse: vi.fn().mockResolvedValue(undefined),
        })
      })

      act(() => {
        labels.push(result.current.pop()?.label ?? '')
      })
      act(() => {
        labels.push(result.current.pop()?.label ?? '')
      })
      act(() => {
        labels.push(result.current.pop()?.label ?? '')
      })

      expect(labels).toEqual([
        'Approved Emma Johnson',
        'Declined Liam Garcia',
        'Approved Olivia Chen',
      ])
    })
  })

  describe('clear', () => {
    it('clear() empties the stack', () => {
      const { result } = renderHook(() => useUndoStack())

      act(() => {
        result.current.push({
          id: 'req1',
          label: 'Action 1',
          inverse: vi.fn().mockResolvedValue(undefined),
        })
        result.current.push({
          id: 'req2',
          label: 'Action 2',
          inverse: vi.fn().mockResolvedValue(undefined),
        })
      })

      expect(result.current.stackSize).toBe(2)

      act(() => {
        result.current.clear()
      })

      expect(result.current.stackSize).toBe(0)
      expect(result.current.canUndo).toBe(false)
    })
  })
})
