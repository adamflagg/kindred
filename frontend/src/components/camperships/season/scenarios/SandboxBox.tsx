import { useState } from 'react'

import { boxText, type SandboxBinding } from './sandboxModel'
import { BOX_BAD, BOX_CHANGED } from './scenarioStyles'

/** The kit's small input (`.cf-input.sm`): 24px, 12.5px, right-aligned, tabular, radius 8, white; greyed only without
 * `rules` (`.cf-input:disabled`: a muted fill, muted ink, no shadow). A posted round never greys it: the sandbox never
 * locks (owner, 2026-10-10). */
const BOX =
  'bg-card border-border text-foreground box-border h-6 rounded-lg border px-1.5 text-right text-[12.5px] leading-[18px] tabular-nums shadow-[0_1px_2px_hsl(var(--shadow-color)/0.07)] hover:border-[color-mix(in_oklab,var(--color-primary)_50%,var(--color-border))] focus-visible:border-[color-mix(in_oklab,var(--color-primary)_50%,var(--color-border))] focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-[color-mix(in_oklab,var(--color-muted)_70%,var(--color-card))] disabled:text-muted-foreground disabled:shadow-none disabled:hover:border-border'
const UNIT = 'text-muted-foreground font-normal'

/**
 * One editable value (§S5 F). Typing reports each keystroke (the Spend table prices it, nothing is recorded); leaving
 * the box, or Enter, releases it (one trail row). A bad figure gives a red border and isn't priced; a changed value is
 * amber with its old value in the title ("was ‹old›"). Whole dollars show with thousands separators, raw while the box
 * has focus, and commas are stripped on input. `label` is the test handle (frontend/CLAUDE.md: no ARIA beyond that).
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
  width: 84 | 64 | 48
  unit: '$' | '%' | null
  placeholder?: string
  binding: SandboxBinding
}) {
  const [focused, setFocused] = useState(false)
  const bad = binding.bad(boxKey)
  const was = binding.was(boxKey)
  const raw = binding.value(boxKey)
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {unit === '$' && <span className={UNIT}>$</span>}
      <input
        aria-label={label}
        className={`${BOX} ${bad ? BOX_BAD : was !== null ? BOX_CHANGED : ''}`}
        style={{ width: `${String(width)}px` }}
        value={focused ? raw : boxText(boxKey, raw)}
        placeholder={placeholder}
        title={was !== null && !bad ? was : undefined}
        disabled={!binding.canEdit}
        onChange={(event) => binding.type(boxKey, event.target.value.replaceAll(',', ''))}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          binding.release()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      {unit === '%' && <span className={UNIT}>%</span>}
    </span>
  )
}
