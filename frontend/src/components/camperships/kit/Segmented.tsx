import { CS_SEG_BUTTON, CS_SEG_COUNT, CS_SEG_OFF, CS_SEG_ON, CS_SEG_WELL } from './csType'

export interface AidSegmentedOption<V extends string> {
  readonly value: V
  readonly label: string
  /** Shown inside the choice's own segment ("All 16"). */
  readonly count?: number
  /** The words behind the choice; on a disabled one, why it is off. */
  readonly title?: string
  /** Off: drawn dim, never reported ("Round" on Session rows). */
  readonly disabled?: boolean
}

/**
 * The segmented switcher (design-language §18; kit CF.seg): every single-choice view filter. A grey
 * 26px well, the picked choice filled with primary, each count inside its own segment. A count-bearing
 * lens strip is the Requests pipeline's alone.
 */
export function AidSegmented<V extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** The group's name, for tests and the title-less reader ("Grouping", "Show"). */
  readonly label: string
  readonly value: V
  readonly options: ReadonlyArray<AidSegmentedOption<V>>
  readonly onChange: (value: V) => void
  readonly className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={className ? `${CS_SEG_WELL} ${className}` : CS_SEG_WELL}
    >
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            title={option.title}
            disabled={option.disabled ?? false}
            className={`${CS_SEG_BUTTON} ${on ? CS_SEG_ON : CS_SEG_OFF} ${option.disabled ? 'cursor-not-allowed opacity-45' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {option.count !== undefined && (
              <>
                {' '}
                <span className={CS_SEG_COUNT}>{option.count}</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
