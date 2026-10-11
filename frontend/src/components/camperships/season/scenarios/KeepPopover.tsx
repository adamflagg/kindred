import { useState, type RefObject } from 'react'

import { EditorActions, EditorField, EditorForm, EditorGrid } from '../../kit/EditorLayout'
import { CS_BTN, CS_BTN2, CS_FIELD } from '../../kit/csType'
import { KEEP_NAME_MAX, keepName } from './controlsModel'
import { ScenarioPopover } from './ScenarioPopover'

/** Keep… (§S5 B): a name, prefilled from the draft's label in staff words; Keep as ‹C›; Enter keeps, Esc cancels.
 * Every keep is the next flat letter: there is no variant choice. Mounted only while open, so it opens fresh.
 * The box follows `prefill` until the person types (plan review M3): the click on Keep… blurs the box it left, so
 * that release can land after the popover opened, and its label is the one to offer. It holds the server's 80
 * characters, and a longer label is cut as the server cuts a blank name, so keeping the default is never refused. */
export function KeepPopover({
  anchor,
  prefill,
  nextCode,
  figure,
  onKeep,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>
  prefill: string
  nextCode: string
  figure: string
  onKeep: (name: string) => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState<string | null>(null)
  const name = typed ?? keepName(prefill)
  const keep = () => {
    onKeep(name)
    onClose()
  }
  return (
    <ScenarioPopover
      open
      onClose={onClose}
      anchor={anchor}
      align="right"
      width={520}
      testId="keep-popover"
      editor
    >
      <EditorForm
        actions={
          <EditorActions {...(figure !== '' ? { reason: figure } : {})}>
            <button type="button" className={CS_BTN} onClick={keep}>
              {`Keep as ${nextCode}`}
            </button>
            <button type="button" className={CS_BTN2} onClick={onClose}>
              Cancel
            </button>
          </EditorActions>
        }
      >
        <EditorGrid columns={2}>
          <EditorField label="Name">
            <input
              aria-label="Name"
              maxLength={KEEP_NAME_MAX}
              className={`${CS_FIELD} w-full`}
              value={name}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') keep()
              }}
            />
          </EditorField>
        </EditorGrid>
      </EditorForm>
    </ScenarioPopover>
  )
}
