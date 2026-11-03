import { expect, it } from 'vitest'
import { tryOnComposition } from './tryOn'

it('preserves a rectangular opaque print while placing it in centimetres', () => {
  const work = tryOnComposition('/preview', 'wide print', 2.5, false)
  expect(work.elements[0]).toMatchObject({ aspect: 2.5, hasAlpha: false,
    placement: { side: 'front', anchor: 'neck', dyCm: 12, widthCm: 18 } })
})
