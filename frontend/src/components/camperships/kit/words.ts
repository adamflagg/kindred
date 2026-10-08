/** A pill's words in sentence case: the first letter capitalised, the rest left as the source wrote it. */
export const sentenceCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
