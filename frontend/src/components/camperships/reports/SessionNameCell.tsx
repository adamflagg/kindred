import { Home } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

import { sessionName } from '../../../utils/sessionName'
import { sessionNameTitle } from './sessionNameTitle'

/**
 * A session's name where a column may cut it (final mock; owner 10-09): the FULL name while it fits the
 * column on one line, else the SHORT form (the owner's ruled vocabulary, never tiny); the full name is
 * always the title, and a short form that still overflows cuts with an ellipsis. Measured after render,
 * and again when the column resizes. Family Camp sessions carry a small house before the name.
 */
export function SessionNameCell({
  name,
  sessionType,
}: {
  readonly name: string
  readonly sessionType: string
}) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [short, setShort] = useState(false)
  const shortRef = useRef(false)
  useLayoutEffect(() => {
    shortRef.current = short
  }, [short])
  const shortForm = sessionName(name, sessionType, 'short')

  // A new name starts from the full form again.
  const [seen, setSeen] = useState(name)
  if (seen !== name) {
    setSeen(name)
    setShort(false)
  }

  useLayoutEffect(() => {
    const element = textRef.current
    if (element === null) return
    // Only the full form is measured: the short form is the fallback, cut if it must be.
    if (!short && element.scrollWidth > element.clientWidth) setShort(true)
  }, [short, name, sessionType])

  useLayoutEffect(() => {
    const element = textRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      // Back to the full form, which the effect above then measures against the new width.
      if (shortRef.current) {
        setShort(false)
      } else if (element.scrollWidth > element.clientWidth) {
        setShort(true)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <span className="flex min-w-0 items-center gap-1" title={sessionNameTitle(name, sessionType)}>
      {sessionType === 'family' && (
        <Home className="text-muted-foreground h-3 w-3 flex-none" aria-hidden />
      )}
      <span ref={textRef} className="min-w-0 truncate">
        {short ? shortForm : name}
      </span>
    </span>
  )
}
