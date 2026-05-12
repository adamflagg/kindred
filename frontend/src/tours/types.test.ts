import { describe, it, expect } from 'vitest'
import type {
  LayerDefinition,
  LayerCompletionRecord,
  TourDefinition,
  TourStorageData,
} from './types'

describe('tour types', () => {
  it('LayerDefinition has required fields', () => {
    const layer: LayerDefinition = {
      id: 'metrics-header',
      version: 1,
      steps: [],
    }
    expect(layer.id).toBe('metrics-header')
    expect(layer.version).toBe(1)
    expect(layer.steps).toEqual([])
  })

  it('LayerCompletionRecord has required fields', () => {
    const record: LayerCompletionRecord = {
      layerId: 'metrics-header',
      completedVersion: 1,
      completedAt: '2026-03-26T00:00:00.000Z',
    }
    expect(record.layerId).toBe('metrics-header')
    expect(record.completedVersion).toBe(1)
    expect(record.completedAt).toBeTruthy()
  })

  it('TourStorageData has only layers field', () => {
    const data: TourStorageData = {
      layers: {
        'metrics-header': {
          layerId: 'metrics-header',
          completedVersion: 1,
          completedAt: '2026-03-26T00:00:00.000Z',
        },
      },
    }
    expect(data.layers['metrics-header']).toBeDefined()
    // @ts-expect-error - completed field has been removed
    expect(data.completed).toBeUndefined()
  })

  it('TourDefinition includes layers array', () => {
    const def: TourDefinition = {
      id: 'registration-overview',
      version: 1,
      layers: ['metrics-header', 'registration-intro'],
      steps: [],
    }
    expect(def.layers).toEqual(['metrics-header', 'registration-intro'])
  })
})
