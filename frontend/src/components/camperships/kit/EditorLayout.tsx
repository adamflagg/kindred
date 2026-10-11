import type { ReactNode } from 'react'

import {
  CS_CARD_HEADING,
  CS_EDITOR,
  CS_EDITOR_ON_WHITE,
  CS_EDROW,
  CS_FGRID,
  CS_FGRID_LABEL,
  CS_FGRID_PAYER,
  CS_FGRID_TWO,
  CS_FORM2,
  CS_FORM2_MAIN,
  CS_FORM2_SIDE,
  CS_PHEAD,
  CS_TOOLBAR_STATUS,
} from './csType'

/**
 * The editor (design-language §24; kit .cf-ed / .cf-form2): wide and short. The fields sit left; the
 * choices that depend on them sit right (3 : 2, a dashed rule between), shown switched off rather
 * than hidden. With nothing dependent it is one column. The buttons go last, on one row.
 *
 * `onWhite` (owner 10-10: "white on not white, and green on white"): the card is white wherever it sits
 * on a surface that is not white (the page, an opened row's cream, a popover). Inside a white card it
 * takes the band tint instead. The prop swaps only the colour classes; it is the same card.
 */
export function EditorForm({
  title,
  side,
  actions,
  children,
  className,
  heading = 'card',
  onWhite = false,
}: {
  readonly heading?: 'card' | 'phead'
  /** The editor sits on a WHITE surface (inside a white card): the band tint, not the card white. */
  readonly onWhite?: boolean
  readonly title?: ReactNode
  readonly side?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}) {
  const card = onWhite ? CS_EDITOR_ON_WHITE : CS_EDITOR
  return (
    <div className={className ? `${card} ${className}` : card}>
      {title !== undefined &&
        (heading === 'phead' ? (
          // The mock's .cf-phead inside .cf-ed (ux3 to-place-3): a span, as bare headings are styled outside the layers.
          <span className={`${CS_PHEAD} block`}>{title}</span>
        ) : (
          <h3 className={CS_CARD_HEADING}>{title}</h3>
        ))}
      <div data-testid="aid-editor-form" className={side !== undefined ? CS_FORM2 : undefined}>
        <div className={side !== undefined ? CS_FORM2_MAIN : undefined}>{children}</div>
        {side !== undefined && <div className={CS_FORM2_SIDE}>{side}</div>}
      </div>
      {actions}
    </div>
  )
}

/**
 * The fields' grid: label · field · label · field (or label · field with `columns={2}`). `'payer'` is
 * Payer Shares' five columns (name · share · %).
 */
export function EditorGrid({
  columns = 4,
  children,
}: {
  readonly columns?: 2 | 4 | 'payer'
  readonly children: ReactNode
}) {
  return (
    <div
      data-testid="aid-editor-grid"
      className={columns === 2 ? CS_FGRID_TWO : columns === 'payer' ? CS_FGRID_PAYER : CS_FGRID}
    >
      {children}
    </div>
  )
}

/**
 * One label and its field, as two grid cells. `off` dims the label of a field that is switched off:
 * it stays on screen, so staff see the choice exists and what turns it on.
 */
export function EditorField({
  label,
  off = false,
  wide = false,
  htmlFor,
  top = false,
  children,
}: {
  readonly label: ReactNode
  readonly off?: boolean
  /** The control's id: the caption becomes a real <label>, so a click on it focuses the field. Leave it
   *  off for a picker, whose options inside a label would hand every click back to its button. */
  readonly htmlFor?: string | undefined
  /** The field takes the rest of the row (the mock's span3): a typed reason or note. */
  readonly wide?: boolean
  /** A tall control (a text box): the label sits at the box's top line, not its middle. */
  readonly top?: boolean
  readonly children: ReactNode
}) {
  const captionClass = [CS_FGRID_LABEL, off && 'opacity-50', top && 'self-start pt-[7px]']
    .filter(Boolean)
    .join(' ')
  return (
    <>
      {htmlFor === undefined ? (
        <span className={captionClass}>{label}</span>
      ) : (
        <label htmlFor={htmlFor} className={captionClass}>
          {label}
        </label>
      )}
      <div className={wide ? 'col-[2/-1] min-w-0' : 'min-w-0'}>{children}</div>
    </>
  )
}

/** The Title Case buttons on one row, with the required-field reason (or logged-with-who) beside them. */
export function EditorActions({
  reason,
  children,
}: {
  readonly reason?: string | undefined
  readonly children: ReactNode
}) {
  return (
    <div className={CS_EDROW}>
      {children}
      {reason && (
        // An editor row has the room: the line is not held to the toolbar's 340px.
        <span className={CS_TOOLBAR_STATUS.replace('max-w-[340px]', 'max-w-none')} title={reason}>
          {reason}
        </span>
      )}
    </div>
  )
}
