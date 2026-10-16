import { createContext } from 'react'

/**
 * Season's toolbar status slot (design-language §5–6): an action inside a tab (Add a Request… on Rounds & budget's
 * CampMinder-aid line, PR 3) says its result in the tab row's right slot, before Download CSV. AidSeasonPage provides
 * the setter; outside it the words go nowhere.
 */
export const SeasonStatusContext = createContext<(words: string) => void>(() => undefined)
