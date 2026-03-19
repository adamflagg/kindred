import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import { SortIcon } from './SortIcon'

describe('SortIcon', () => {
  it('renders ascending icon when field matches and direction is asc', () => {
    const { container } = render(<SortIcon field="name" activeField="name" direction="asc" />)
    // ArrowUp is the default ascending icon — should render an SVG
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders descending icon when field matches and direction is desc', () => {
    const { container } = render(<SortIcon field="name" activeField="name" direction="desc" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders nothing when field does not match and no inactive icon', () => {
    const { container } = render(<SortIcon field="name" activeField="grade" direction="asc" />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders inactive icon when provided and field does not match', () => {
    const { container } = render(
      <SortIcon field="name" activeField="grade" direction="asc" inactiveIcon={ArrowUpDown} />
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('uses custom ascending and descending icons', () => {
    const { container: ascContainer } = render(
      <SortIcon
        field="name"
        activeField="name"
        direction="asc"
        ascIcon={ChevronUp}
        descIcon={ChevronDown}
      />
    )
    expect(ascContainer.querySelector('svg')).not.toBeNull()

    const { container: descContainer } = render(
      <SortIcon
        field="name"
        activeField="name"
        direction="desc"
        ascIcon={ChevronUp}
        descIcon={ChevronDown}
      />
    )
    expect(descContainer.querySelector('svg')).not.toBeNull()
  })
})
