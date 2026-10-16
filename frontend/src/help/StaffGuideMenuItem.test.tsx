import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../config/branding', () => ({ getDocsUrl: vi.fn() }))
import { getDocsUrl } from '../config/branding'
import { StaffGuideMenuItem } from './StaffGuideMenuItem'

const at = (path: string, onNavigate: () => void = () => {}) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <StaffGuideMenuItem onNavigate={onNavigate} />
    </MemoryRouter>
  )

describe('StaffGuideMenuItem', () => {
  it('renders nothing without a docs_url', () => {
    vi.mocked(getDocsUrl).mockReturnValue(null)
    at('/aid/today')
    expect(screen.queryByText('Staff Guide')).toBeNull()
  })

  it('links to the guide /go/ page for the current screen, in a new tab', () => {
    vi.mocked(getDocsUrl).mockReturnValue('https://guide.example.test/')
    at('/aid/today')
    const link = screen.getByRole('link', { name: /Staff Guide/ })
    expect(link).toHaveAttribute('href', 'https://guide.example.test/go/aid.today/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('resolves a routed screen to its own key', () => {
    vi.mocked(getDocsUrl).mockReturnValue('https://guide.example.test')
    at('/aid/requests')
    expect(screen.getByRole('link', { name: /Staff Guide/ })).toHaveAttribute(
      'href',
      'https://guide.example.test/go/aid.requests/'
    )
  })

  it('falls back to an area page for a screen with no entry of its own', () => {
    vi.mocked(getDocsUrl).mockReturnValue('https://guide.example.test')
    at('/nowhere')
    expect(screen.getByRole('link', { name: /Staff Guide/ })).toHaveAttribute(
      'href',
      'https://guide.example.test/go/home/'
    )
  })

  it('calls onNavigate when clicked', () => {
    vi.mocked(getDocsUrl).mockReturnValue('https://guide.example.test')
    const onNavigate = vi.fn()
    at('/nowhere', onNavigate)
    fireEvent.click(screen.getByRole('link', { name: /Staff Guide/ }))
    expect(onNavigate).toHaveBeenCalled()
  })
})
