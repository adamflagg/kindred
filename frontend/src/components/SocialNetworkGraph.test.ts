import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('SocialNetworkGraph effect dependencies', () => {
  const source = readFileSync(
    resolve(__dirname, './SocialNetworkGraph.tsx'),
    'utf-8'
  )

  it('does not include showBubbles in the main initialization useEffect deps', () => {
    const initEffectPattern = /\},\s*\[([^\]]*graphData[^\]]*viewMode[^\]]*)\]/
    const match = source.match(initEffectPattern)
    expect(match).toBeTruthy()
    expect(match![1]).not.toContain('showBubbles')
  })

  it('includes showBubbles in the resize/bubble useEffect deps', () => {
    const resizeEffectPattern = /\},\s*\[([^\]]*isExpanded[^\]]*showBubbles[^\]]*)\]/
    const match = source.match(resizeEffectPattern)
    expect(match).toBeTruthy()
    expect(match![1]).toContain('showBubbles')
  })

  it('clears bubbles when showBubbles is toggled OFF in the resize effect', () => {
    const hasElseClear = source.includes('} else {') || source.includes('else if (!showBubbles)')
    expect(hasElseClear).toBe(true)
    expect(source).toContain('clearBubbles(bubbleRefs)')
  })
})
