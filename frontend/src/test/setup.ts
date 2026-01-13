import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, vi, beforeEach } from 'vitest'

// Cleanup after each test case
afterEach(() => {
  cleanup()
})

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
})

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock IntersectionObserver
globalThis.IntersectionObserver = class IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: readonly number[] = [];
  
  disconnect() {}
  observe() {}
  unobserve() {}
  takeRecords() { return []; }
} as unknown as typeof IntersectionObserver

// Mock fetch globally
globalThis.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
    blob: async () => new Blob(),
    headers: new Headers(),
  } as Response)
)

// Mock localStorage for auth
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
}
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Mock console methods to reduce noise in tests
globalThis.console = {
  ...console,
  error: vi.fn(),
  warn: vi.fn(),
  log: vi.fn(),
}