import type { ReactNode } from 'react'

/** The state a line of explanation reports: ✓ done, ○ left for a person, ⚠ needs a look, · a plain fact. */
export type EffectSym = 'ok' | 'hand' | 'warn' | 'info'

const SYM_WORD: Record<EffectSym, string> = { ok: '✓', hand: '○', warn: '⚠', info: '·' }
const SYM_INK: Record<EffectSym, string> = {
  ok: 'text-forest-700 dark:text-forest-300',
  hand: 'text-muted-foreground',
  warn: 'text-amber-700 dark:text-amber-300',
  info: '',
}

/** The callout's rule: the dashboard's own is primary, an outside grant's sky, "nothing to do" amber. */
const DOES_RULE = {
  default: 'border-primary',
  grant: 'border-sky-600',
  warn: 'border-amber-500',
} as const

/**
 * The callout under a group heading (design-language §16; kit CF.does): 12.5px on its own line under a
 * 3px rule, a bold lead then → and the result. `lines` is one callout of several short lines.
 */
export function Does({
  tone = 'default',
  lines,
  children,
}: {
  readonly tone?: keyof typeof DOES_RULE
  readonly lines?: readonly ReactNode[]
  readonly children?: ReactNode
}) {
  return (
    <div
      data-does=""
      className={`${DOES_RULE[tone]} text-foreground mb-1.5 ml-0.5 border-l-[3px] px-2 py-px text-[12.5px] leading-[18px]`}
    >
      {lines !== undefined ? lines.map((line, i) => <div key={i}>{line}</div>) : children}
    </div>
  )
}

export interface EffectItem {
  readonly sym: EffectSym
  readonly text: ReactNode
  /** The next step, on its own muted line under the words ("→ Mark Posted by hand if that's right"). */
  readonly then?: ReactNode
}

/**
 * What an action does, one effect per line (design-language §16; kit CF.fx): a symbol, the words, and
 * where there is one a muted → line under them. Never a colon chain.
 */
export function Effects({ items }: { readonly items: readonly EffectItem[] }) {
  return (
    <ul className="m-0 list-none p-0 text-[13.5px] leading-normal">
      {items.map((item, i) => (
        <li key={i} data-effect="" className="mb-[3px]">
          <span data-sym="" className={`inline-block w-4 font-bold ${SYM_INK[item.sym]}`}>
            {SYM_WORD[item.sym]}
          </span>
          {item.text}
          {item.then !== undefined && (
            <span className="text-muted-foreground ml-4 block text-[12.5px]">{item.then}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
