import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

vi.mock('../lib/pocketbase', () => ({
  pb: {
    files: { getURL: vi.fn().mockReturnValue('') },
  },
}))

let mockUser: Record<string, unknown> | null = null
let mockIsBypassMode = false

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    isLoading: false,
    isAuthenticated: mockUser != null,
    isBypassMode: mockIsBypassMode,
    logout: vi.fn(),
    error: null,
  }),
}))

const User = (await import('./User')).default

function renderUser() {
  return render(
    <MemoryRouter>
      <User />
    </MemoryRouter>
  )
}

describe('Account Information card structure', () => {
  beforeEach(() => {
    mockUser = {
      id: 'user-1',
      name: 'Emma Johnson',
      email: 'emma@example.com',
      avatar: '',
      last_login: '2026-03-17 10:30:00.000Z',
    }
    mockIsBypassMode = false
  })

  it('renders all 3 profile rows with labels', () => {
    renderUser()
    expect(screen.getByText('Email Address')).toBeTruthy()
    expect(screen.getByText('Account Status')).toBeTruthy()
    expect(screen.getByText('Last Login')).toBeTruthy()
  })
})

describe('User Profile - Last Login', () => {
  it('shows last login when available', () => {
    mockUser = {
      id: 'user-1',
      name: 'Emma Johnson',
      email: 'emma@example.com',
      avatar: '',
      last_login: '2026-03-17 10:30:00.000Z',
    }
    mockIsBypassMode = false
    renderUser()

    const container = screen.getByTestId('profile-last-login')
    expect(container).toBeTruthy()
    // Should show relative time, not "Never"
    expect(within(container).queryByText('Never')).toBeNull()
  })

  it('shows "Never" when last_login is empty', () => {
    mockUser = {
      id: 'user-1',
      name: 'Emma Johnson',
      email: 'emma@example.com',
      avatar: '',
      last_login: '',
    }
    mockIsBypassMode = false
    renderUser()

    const container = screen.getByTestId('profile-last-login')
    expect(within(container).getByText('Never')).toBeTruthy()
  })
})
