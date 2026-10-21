import { describe, expect, it } from 'vitest'

import type { Base, Collection, Label, Variant } from './api/collections'
import { authorsOf, headline, imageFiles, labelCounts, matches, newCount, placeInto, shifted } from './collections'

const variant = (id: number, author: string | null, label: number | null, isNew = false): Variant => ({
  id,
  name: `вариант ${id}`,
  number: 1,
  image: 'x',
  author_id: author,
  author: author === 'anna' ? 'Анна' : author === 'kristina' ? 'Кристина' : null,
  created_at: '',
  saved_at: '',
  label_id: label,
  label_by: null,
  label_at: null,
  shelved_at: null,
  is_new: isNew,
})

const base = (variants: Variant[][]): Base => ({
  style_id: 's',
  code: '1895',
  name: null,
  category: null,
  gender: null,
  size_range: null,
  views: { front: null, back: null },
  ideas: [],
  shelf: [],
  colours: variants.map((v, i) => ({
    colorway_id: `c${i}`,
    article: '',
    color: null,
    color_code: null,
    base_color: null,
    rgb: null,
    image: null,
    variants: v,
  })),
})

const label = (id: number, name: string, active = true, position = id): Label => ({
  id,
  name,
  tone: 'amber',
  position,
  active,
})

describe('доска коллекции', () => {
  const bases = [base([[variant(1, 'anna', 1, true), variant(2, 'kristina', null)], [variant(3, 'anna', 2, true)]])]

  it('считает варианты по меткам и без метки', () => {
    const counts = labelCounts(bases, [label(2, 'Правки'), label(1, 'Смотреть')])
    expect(counts.map((c) => [c.label?.name ?? null, c.count])).toEqual([
      ['Смотреть', 1],
      ['Правки', 1],
      [null, 1],
    ])
  })

  it('счётчики меток — в пределах «мои» и «новое»', () => {
    const counts = labelCounts(bases, [label(1, 'Смотреть'), label(2, 'Правки')], { author: 'kristina', label: 1 })
    expect(counts.map((c) => [c.label?.name ?? null, c.count])).toEqual([
      ['Смотреть', 0],
      ['Правки', 0],
      [null, 1],
    ])
  })

  it('погашенную метку показывает, только пока она где-то стоит', () => {
    const counts = labelCounts(bases, [label(1, 'Смотреть', false), label(9, 'Старое', false)])
    expect(counts.map((c) => c.label?.name ?? null)).toEqual(['Смотреть', null])
  })

  it('люди — по числу вариантов', () => {
    expect(authorsOf(bases)).toEqual([
      { id: 'anna', name: 'Анна', count: 2 },
      { id: 'kristina', name: 'Кристина', count: 1 },
    ])
  })

  it('отбор по метке, «без метки» и по человеку', () => {
    expect(matches(variant(1, 'anna', 1), { label: 1 })).toBe(true)
    expect(matches(variant(1, 'anna', 1), { label: 'none' })).toBe(false)
    expect(matches(variant(2, 'anna', null), { label: 'none' })).toBe(true)
    expect(matches(variant(2, 'anna', null), { author: 'kristina' })).toBe(false)
    expect(matches(variant(2, 'anna', null), {})).toBe(true)
  })

  it('отбор «только новое»', () => {
    expect(matches(variant(1, 'anna', 1, true), { fresh: true })).toBe(true)
    expect(matches(variant(2, 'anna', 1, false), { fresh: true })).toBe(false)
  })

  it('перенос встаёт перед карточкой, в конец или остаётся на месте', () => {
    expect(placeInto([1, 2, 3], 3, 1)).toEqual([3, 1, 2])
    expect(placeInto([1, 2, 3], 1, null)).toEqual([2, 3, 1])
    expect(placeInto([1, 2], 9, 2)).toEqual([1, 9, 2])
    expect(placeInto([1, 2, 3], 2, 2)).toEqual([1, 2, 3])
  })

  it('сдвиг на одно место и упор в край', () => {
    expect(shifted([1, 2, 3], 2, -1)).toEqual([2, 1, 3])
    expect(shifted([1, 2, 3], 3, 1)).toEqual([1, 2, 3])
  })

  it('считает новое', () => {
    expect(newCount(bases)).toBe(2)
  })

  it('пустое из PLM в шапке называется словами', () => {
    const c: Collection = {
      id: 'r',
      code: 'R',
      name_ru: null,
      drop_code: 'AW-AUT-APP-08',
      brand: null,
      gender: null,
      supplier: 'Arnasoy',
      product: null,
      team: [],
      plm_path: '/releases/r',
    }
    expect(headline(c)).toBe('дроп AW-AUT-APP-08 · фабрика Arnasoy · продакт не назначен')
  })

  it('из вставки берутся только картинки', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' })
    const text = new File(['x'], 'a.txt', { type: 'text/plain' })
    expect(imageFiles([png, text])).toEqual([png])
  })
})
