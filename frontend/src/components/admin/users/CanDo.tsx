import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, Check, Minus } from 'lucide-react'
import { NOT_CHECKED_PILL, OK_TEXT, TAG_ADD, TAG_REMOVE, WARN_TEXT } from './styles'

interface Screen {
  name: string
  path: string
}

/** A screen a permission opens. The arrow leads; size comes from the parent. */
export function ScreenLink({ screen }: { screen: Screen }) {
  return (
    <Link
      to={screen.path}
      className="text-primary inline-flex items-center gap-[3px] font-medium whitespace-nowrap hover:underline"
    >
      <ArrowUpRight className="h-[13px] w-[13px] flex-shrink-0" />
      {screen.name}
    </Link>
  )
}

/** One registry area of a "what they can do" list (user drawer, role view). */
export function CanDoArea({ area, children }: { area: string; children: ReactNode }) {
  return (
    <div className="mb-2.5">
      <div className="text-muted-foreground mb-1 text-xs font-bold tracking-[0.06em] uppercase">
        {area}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">{children}</ul>
    </div>
  )
}

interface CanDoItemProps {
  short: string
  screens: Screen[]
  /** Role names that grant it; omitted where the context is one role. */
  via?: string
  state?: 'gain' | 'lose' | null
}

/**
 * A permission someone has: green check, its name, where it comes from and
 * the screens it opens. A draft loss is struck through with a rose minus.
 */
export function CanDoItem({ short, screens, via, state = null }: CanDoItemProps) {
  const lost = state === 'lose'
  const Icon = lost ? Minus : Check
  return (
    <li
      className={`flex items-start gap-2 text-sm leading-[1.4] ${lost ? 'text-muted-foreground' : ''}`}
    >
      <Icon className={`mt-0.5 h-[15px] w-[15px] flex-shrink-0 ${lost ? WARN_TEXT : OK_TEXT}`} />
      <span className="min-w-0">
        <span className={`font-semibold ${lost ? 'line-through' : ''}`}>{short}</span>
        {state === 'gain' && <span className={`ml-1.5 ${TAG_ADD}`}>new</span>}
        {lost && <span className={`ml-1.5 ${TAG_REMOVE}`}>removed</span>}
        {screens.length === 0 && (
          <span className={`ml-1.5 ${NOT_CHECKED_PILL}`}>not checked anywhere</span>
        )}
        {via !== undefined && (
          <span className="text-muted-foreground block text-[13px]">via {via}</span>
        )}
        {screens.length > 0 && (
          <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[13px]">
            {screens.map((s) => (
              <ScreenLink key={s.path} screen={s} />
            ))}
          </span>
        )}
      </span>
    </li>
  )
}

/** Shown when someone holds no permissions at all. */
export function CanDoNothing() {
  return (
    <ul className="m-0 list-none p-0">
      <li className="text-muted-foreground flex items-start gap-2 text-sm leading-[1.4]">
        <Minus className="mt-0.5 h-[15px] w-[15px] flex-shrink-0" />
        <span>Sign in and see the shared screens. Nothing gated.</span>
      </li>
    </ul>
  )
}
