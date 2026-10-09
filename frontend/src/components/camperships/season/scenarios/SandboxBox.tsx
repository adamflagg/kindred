import { CS_META, CS_SMALL } from '../../kit/csType'
import { keyLocked, type SandboxBinding } from './sandboxModel'
import { BOX_BAD, BOX_CHANGED, WAS_INK } from './scenarioStyles'

// Sandbox density (§S5 F): a compact box on card white (§3), not the 30px editor field CS_INPUT is now.
const BOX =
  'bg-card border-border text-foreground rounded-md border px-1.5 py-0.5 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none'

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
