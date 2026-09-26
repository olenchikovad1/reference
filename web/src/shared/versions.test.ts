// Что считается несохранённой правкой и как листается история (US-0490).

import { describe, expect, it } from 'vitest'

import { EMPTY, type Composition } from './composition'
import { versionKey } from './keys'
import { neighbour, workKey } from './versions'

const withOne: Composition = {
  selectedId: null,
  elements: [
    {
      id: 'e1',
      kind: 'text',
      name: 'надпись',
      text: 'ЗИМА',
      fontFamily: 'Inter',
      weight: 600,
      colourCode: 'WHITE',
      rgb: [255, 255, 255],
      textAspect: 3,
      placement: { side: 'back', anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 18, rotation: 0 },
    } as unknown as Composition['elements'][number],
  ],
}

describe('несохранённое', () => {
  it('выбор элемента — не правка', () => {
    const picked = { ...withOne, selectedId: 'e1' }
    expect(workKey({ colourCode: 'BLACK', composition: picked })).toBe(workKey({ colourCode: 'BLACK', composition: withOne }))
  })

  it('добавленный элемент — правка', () => {
    expect(workKey({ colourCode: 'BLACK', composition: withOne })).not.toBe(workKey({ colourCode: 'BLACK', composition: EMPTY }))
  })

  it('порядок ключей из базы — не правка', () => {
    // JSONB возвращает ключи в своём порядке — та же работа, другой порядок.
    const shuffled = JSON.parse(JSON.stringify(withOne), (_, v) =>
      v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v,
    ) as Composition
    expect(workKey({ colourCode: 'BLACK', composition: shuffled })).toBe(workKey({ colourCode: 'BLACK', composition: withOne }))
  })

  it('смена цвета изделия — правка', () => {
    expect(workKey({ colourCode: 'BLACK', composition: withOne })).not.toBe(workKey({ colourCode: 'WHITE', composition: withOne }))
  })
})

describe('листание истории', () => {
  it('назад и вперёд по соседям, у краёв — некуда', () => {
    expect(neighbour([1, 2, 3], 2, 'older')).toBe(1)
    expect(neighbour([1, 2, 3], 2, 'newer')).toBe(3)
    expect(neighbour([1, 2, 3], 1, 'older')).toBeNull()
    expect(neighbour([1, 2, 3], 3, 'newer')).toBeNull()
  })

  it('дыра в номерах не ломает листание', () => {
    expect(neighbour([1, 2, 5], 5, 'older')).toBe(2)
  })
})

const k = (code: string, extra: Partial<KeyboardEventInit> = {}) =>
  ({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra }) as KeyboardEvent

describe('клавиши версий', () => {
  it('Ctrl+S — сохранить, Ctrl+Shift+S — сохранить как, в любой раскладке', () => {
    expect(versionKey(k('KeyS', { ctrlKey: true }))).toBe('save')
    expect(versionKey(k('KeyS', { ctrlKey: true, shiftKey: true }))).toBe('save-as')
    expect(versionKey(k('KeyS', { metaKey: true }))).toBe('save')
  })

  it('A и D — карточки, Q и E — история, с модификатором — ничего', () => {
    expect(versionKey(k('KeyA'))).toBe('prev-card')
    expect(versionKey(k('KeyD'))).toBe('next-card')
    expect(versionKey(k('KeyQ'))).toBe('older')
    expect(versionKey(k('KeyE'))).toBe('newer')
    expect(versionKey(k('KeyA', { shiftKey: true }))).toBeNull()
    expect(versionKey(k('KeyD', { ctrlKey: true }))).toBeNull()
  })
})
