/**
 * The card's note marker, as the owner locked it (2026-09-25): the card's own
 * top-right corner, filled sticky-pad yellow, 16px. Its outer edge IS the
 * card's rounded border corner -- radius and border width are read off the
 * rendered card -- and its inner edge is a quarter circle centred on that
 * corner. A plan-only note is paler with a dashed edge; a card holding both
 * shows a dot beside the corner; an empty card shows a faint dashed ghost on
 * hover or focus-within only.
 *
 * It sits BESIDE the card's open control, never inside it, so it can be a
 * real button and use the real `ui/Tooltip` preview. `pointerdown`,
 * `mousedown` and `touchstart` all stop here, not `pointerdown` alone: both
 * boards register dnd-kit's `MouseSensor` and `TouchSensor`
 * (`LodgingBoard.tsx`, `BunkingBoardByArea.tsx`), whose activators are
 * exactly those two DOM event types -- dnd-kit never wires a `pointerdown`
 * listener for either sensor. Stopping only `pointerdown` left a real
 * mousedown/touchstart free to bubble to the card's drag listeners, so
 * pressing the corner still started a drag. Whichever of the three the
 * pointing device actually fires, pressing the corner is never a drag start
 * and never opens the panel.
 *
 * While a board drag is in progress (`[data-dragging]` on the board root) the
 * ghost disappears and no corner takes the pointer -- a CSS rule in
 * index.css, so memo'd cards never re-render for it.
 */
import { useLayoutEffect, useRef, useState } from 'react'

import type { NoteSubject } from '../../types/subjectNotes'
import { Tooltip } from '../ui/Tooltip'
import { useSubjectNotesScope } from './subjectNotesContext'
import {
  cornerState,
  extraLayerCount,
  NOTE_LABEL,
  previewText,
  subjectKey,
  type CornerMode,
} from './subjectNoteModel'

/** Locked: 16px (owner, 2026-09-25). */
const SIZE = 16
/** The click area, flush on the card's outer corner. */
const HIT = 20
/** Locked: yellow-200 fill, yellow-500 edge; plan-only is yellow-50. */
const FILL: Record<CornerMode, string> = { standard: '#fef08a', plan: '#fefce8', ghost: 'none' }
const EDGE = '#eab308'
const DOT = 'oklch(42% 0.14 168)'

function CornerCap({ radius, mode }: { radius: number; mode: CornerMode }) {
  const R = Math.min(radius, SIZE)
  // Card's outer top-right corner at (SIZE, 0): the outer edge traces the arc
  // the card's own border draws there; the inner edge is a quarter circle of
  // radius SIZE centred on that corner.
  const outer = `M 0 0 H ${String(SIZE - R)} A ${String(R)} ${String(R)} 0 0 1 ${String(SIZE)} ${String(R)} V ${String(SIZE)}`
  const inner = `A ${String(SIZE)} ${String(SIZE)} 0 0 1 0 0`
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
      style={{
        display: 'block',
        overflow: 'visible',
        filter: mode === 'ghost' ? undefined : 'drop-shadow(-0.5px 0.5px 0.4px rgba(0,0,0,.12))',
      }}
    >
      <path d={`${outer} ${inner} Z`} fill={FILL[mode]} />
      <path
        d={`M ${String(SIZE)} ${String(SIZE)} ${inner}`}
        fill="none"
        stroke={EDGE}
        strokeWidth={1}
        {...(mode === 'standard' ? {} : { strokeDasharray: '2 1.5' })}
      />
    </svg>
  )
}

export interface SubjectNoteCornerProps {
  subject: NoteSubject
  /** The card's own name, for the popover header. */
  label: string
  /** FamilyCard's frame positions against its padding box; CamperCard's wrapper against its border box. */
  containing: 'padding' | 'border'
}

const GHOST = 'opacity-0 transition-opacity group-hover:opacity-60 group-focus-within:opacity-60'
const TRIGGER = 'relative flex h-full w-full items-start justify-end'

export function SubjectNoteCorner({ subject, label, containing }: SubjectNoteCornerProps) {
  const scope = useSubjectNotesScope()
  const holderRef = useRef<HTMLSpanElement>(null)
  const [frame, setFrame] = useState({ radius: 12, border: 2 })
  const enabled = scope !== null

  useLayoutEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    const card =
      containing === 'padding'
        ? holder.parentElement
        : holder.parentElement?.querySelector<HTMLElement>('[data-camper-card]')
    if (!card) return
    const style = getComputedStyle(card)
    const radius = parseFloat(style.borderTopRightRadius) || 12
    const border = parseFloat(style.borderTopWidth) || 0
    setFrame((f) => (f.radius === radius && f.border === border ? f : { radius, border }))
    // Re-measured when the corner first appears (the permission can resolve late).
  }, [containing, enabled])

  if (scope === null) return null

  const layers = scope.notesFor(subject)
  const { mode, both } = cornerState(layers)
  const key = subjectKey(subject)
  const openHere = scope.editor?.surface === 'popover' && subjectKey(scope.editor.subject) === key
  const name = mode === 'ghost' ? `Add ${NOTE_LABEL.toLowerCase()}` : NOTE_LABEL
  const open = () => {
    scope.openEditor({ subject, label, surface: 'popover', anchorEl: holderRef.current })
  }

  const lead = layers.standard ?? layers.plan
  const more = extraLayerCount(layers)
  const preview =
    lead && !openHere ? (
      <div className="flex flex-col gap-0.5">
        <div className="font-semibold">{NOTE_LABEL}</div>
        <div className="whitespace-pre-wrap">{previewText(lead.body)}</div>
        {more > 0 && <div className="text-muted-foreground">+{more} more</div>}
      </div>
    ) : null

  const offset = containing === 'padding' ? -frame.border : 0
  const cap = (
    <>
      <CornerCap radius={frame.radius} mode={mode} />
      {both && (
        <span
          data-note-dot
          className="absolute block rounded-full"
          style={{
            width: 5,
            height: 5,
            background: DOT,
            top: Math.round(SIZE * 0.6),
            right: SIZE + 1,
          }}
        />
      )}
    </>
  )

  return (
    <span
      ref={holderRef}
      data-note-corner={mode}
      data-note-corner-for={key}
      className={`absolute z-[5] ${mode === 'ghost' ? GHOST : ''}`}
      style={{ top: offset, right: offset, width: HIT, height: HIT }}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      onMouseDown={(event) => {
        event.stopPropagation()
      }}
      onTouchStart={(event) => {
        event.stopPropagation()
      }}
    >
      {preview ? (
        <Tooltip content={preview} aria-label={name} className={TRIGGER} onActivate={open}>
          {cap}
        </Tooltip>
      ) : (
        <button type="button" aria-label={name} className={TRIGGER} onClick={open}>
          {cap}
        </button>
      )}
    </span>
  )
}
