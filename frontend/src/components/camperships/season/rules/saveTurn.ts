import { createContext, useContext, useEffect } from 'react'

/** Why a card's Save waits while another card saves (its title). */
export const ANOTHER_SAVING = 'Another card is saving: this one can save once it is done.'

export interface SaveTurn {
  readonly busy: ReadonlySet<string>
  readonly mark: (key: string, saving: boolean) => void
}

/**
 * One save at a time on Season › Rules (owner 2026-10-14: several cards edited at once). A save reads the draft, then
 * sends the version it read; a second save sent before the first lands names a version that is gone and meets a 409.
 * So while one card saves, the others' Save waits. Without a provider (SaveTurnProvider) nothing waits.
 */
export const SaveTurnContext = createContext<SaveTurn>({ busy: new Set(), mark: () => undefined })

/** Says when this card (`key`) is saving; true while ANOTHER card is, so this one's Save waits. */
export function useSaveTurn(key: string, saving: boolean): boolean {
  const { busy, mark } = useContext(SaveTurnContext)
  useEffect(() => {
    mark(key, saving)
  }, [key, saving, mark])
  // A card that closes lets go.
  useEffect(() => () => mark(key, false), [key, mark])
  return [...busy].some((other) => other !== key)
}
