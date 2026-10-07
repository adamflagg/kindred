import { CS_INPUT, CS_META, CS_SMALL } from '../../kit/csType'
import { keyLocked, type SandboxBinding } from './sandboxModel'
import { BOX_BAD, BOX_CHANGED, WAS_INK } from './scenarioStyles'

// Sandbox density (§S5 F): the kit's box with tighter padding.
const BOX = `${CS_INPUT.replace(/\bp[xy]-\S+/g, '')} px-1.5 py-0.5 tabular-nums`

/**
 * One editable value (§S5 F). Typing reports each keystroke (the strip prices it, nothing is recorded); leaving the
 * box, or Enter, releases it (one trail row). A bad figure gives a red border and isn't priced; a changed value
 * is amber with "was ‹old›". `label` is the test handle (frontend/CLAUDE.md: no ARIA beyond that).
 */
export function SandboxBox({
  boxKey,
  label,
  width,
  unit,
  placeholder,
  binding,
}: {
  boxKey: string
  label: string
  width: 96 | 64 | 46
  unit: '$' | '%' | null
  placeholder?: string
  binding: SandboxBinding
}) {
  const bad = binding.bad(boxKey)
  const was = binding.was(boxKey)
  const off = !binding.canEdit || keyLocked(boxKey, binding.locked)
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      {unit === '$' && <span className={CS_SMALL}>$</span>}
      <input
        aria-label={label}
        className={`${BOX} ${bad ? BOX_BAD : was !== null ? BOX_CHANGED : ''}`}
        style={{ width: `${String(width)}px` }}
        value={binding.value(boxKey)}
        placeholder={placeholder}
        disabled={off}
        onChange={(event) => binding.type(boxKey, event.target.value)}
        onBlur={() => binding.release()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      {unit === '%' && <span className={CS_SMALL}>%</span>}
      {was !== null && !bad && <span className={`${CS_META} ${WAS_INK}`}>{was}</span>}
    </span>
  )
}
