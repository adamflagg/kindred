import { useRef } from 'react'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import '../../styles/tour.css'
import type { HintDefinition } from '../../tours/types'

interface HintDotProps {
  hint: HintDefinition
  className?: string
}

export function HintDot({ hint, className = '' }: HintDotProps) {
  const driverRef = useRef<Driver | null>(null)

  const activate = () => {
    if (driverRef.current) {
      driverRef.current.destroy()
    }

    const d = driver({
      showButtons: ['close'],
      popoverClass: 'kindred-hint',
    })
    driverRef.current = d

    d.highlight({
      element: hint.element,
      popover: {
        title: hint.title,
        description: hint.description,
        popoverClass: 'kindred-hint',
      },
    })
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    activate()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      activate()
    }
  }

  return (
    <button
      type="button"
      aria-label={`Hint: ${hint.title}`}
      className={`hint-dot inline-flex shrink-0 items-center justify-center ${className}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span className="hint-dot-core" />
      <span className="hint-dot-pulse" />
    </button>
  )
}
