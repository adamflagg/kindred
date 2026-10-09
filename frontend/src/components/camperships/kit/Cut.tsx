import { CS_CUT } from './csType'

/**
 * Text its column may cut (design-language §13; kit CF.cut): one line, an ellipsis, and always a
 * native title with the full words. `title` overrides when the visible words are a short form
 * ("FC2" titled "Family Camp 2").
 */
export function Cut({
  text,
  title,
  className,
}: {
  text: string
  title?: string
  className?: string
}) {
  return (
    <span className={className ? `${CS_CUT} ${className}` : CS_CUT} title={title ?? text}>
      {text}
    </span>
  )
}
