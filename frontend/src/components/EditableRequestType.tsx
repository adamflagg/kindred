import { useState, useRef, memo } from 'react'
import { ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { useClickOutside } from '../hooks/useClickOutside'

interface EditableRequestTypeProps {
  value: string
  onChange: (newType: string) => void
  disabled?: boolean
}

const requestTypes = [
  { value: 'bunk_with', label: 'Bunk With' },
  { value: 'not_bunk_with', label: 'Not Bunk With' },
  { value: 'age_preference', label: 'Age Preference' },
]

// Memoized component - only re-renders when value or disabled changes
const EditableRequestType = memo(
  function EditableRequestType({ value, onChange, disabled }: EditableRequestTypeProps) {
    const [isOpen, setIsOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    // Close dropdown when clicking outside
    useClickOutside(dropdownRef, () => setIsOpen(false), isOpen)

    const currentType = requestTypes.find((t) => t.value === value)
    const label = currentType?.label ?? value

    const handleSelect = (newType: string) => {
      if (newType !== value) {
        onChange(newType)
      }
      setIsOpen(false)
    }

    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={clsx(
            'inline-flex items-center gap-1 rounded px-2 py-1 text-sm transition-colors',
            'hover:bg-muted hover:border-border border border-transparent',
            'w-full max-w-full justify-between',
            disabled && 'cursor-not-allowed opacity-50'
          )}
          disabled={disabled}
        >
          <span className="whitespace-nowrap">{label}</span>
          <ChevronDown className="h-3 w-3" />
        </button>

        {isOpen && (
          <div className="bg-popover border-border absolute z-[60] mt-1 w-48 rounded-md border shadow-lg">
            <div className="py-1">
              {requestTypes.map((type) => (
                <button
                  key={type.value}
                  onClick={() => handleSelect(type.value)}
                  className={clsx(
                    'hover:bg-muted w-full px-3 py-2 text-left text-sm transition-colors',
                    value === type.value && 'bg-muted font-medium'
                  )}
                >
                  <span className="whitespace-nowrap">{type.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Custom comparison - only re-render if value or disabled changes
    return prevProps.value === nextProps.value && prevProps.disabled === nextProps.disabled
  }
)

export default EditableRequestType
