import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { RecordModel } from 'pocketbase'

vi.mock('../../../lib/pocketbase', () => ({
  pb: { files: { getURL: () => '/api/files/users/u1/missing.png' } },
}))

const { UserAvatar } = await import('./UserAvatar')

const user = {
  id: 'u1',
  collectionId: 'users',
  collectionName: 'users',
  name: 'Emma Johnson',
  email: 'emma@example.com',
  avatar: 'missing.png',
} as unknown as RecordModel

describe('UserAvatar', () => {
  it('shows the photo while it loads', () => {
    const { container } = render(<UserAvatar user={user} />)
    expect(container.querySelector('img')).not.toBeNull()
  })

  it('falls back to the initial when the photo fails to load (#3)', () => {
    const { container } = render(<UserAvatar user={user} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('user-avatar')).toHaveTextContent('E')
  })
})
