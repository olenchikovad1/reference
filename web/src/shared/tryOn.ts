import { EMPTY, type Composition } from './composition'

/** Размещение на базовом размере: сантиметры от горловины, не пиксели превью. */
export function tryOnComposition(src: string, name: string, aspect: number, hasAlpha: boolean): Composition {
  return { ...EMPTY, elements: [{
    id: 'try-on', kind: 'image', name, src, aspect, hasAlpha,
    placement: { side: 'front', anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 18, rotation: 0 },
  }] }
}
