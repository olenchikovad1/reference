// Стороны изделия: отбор, учёт и подъём старого состояния.
//
// Отбор — это ВЗГЛЯД на композицию, а не правка. Если бы переключение стороны
// меняло композицию, оно стирало бы работу на других сторонах, и узнавали бы
// об этом, только вернувшись обратно.

import type { Composition } from './composition'

/** Сторона по умолчанию. Ею же считается сторона у элементов, сохранённых до
 *  того, как стороны появились. */
export const DEFAULT_SIDE = 'front'

/** Композиция глазами одной стороны. Исходная не меняется. */
export function onSide(c: Composition, side: string): Composition {
  const elements = c.elements.filter((el) => (el.placement.side ?? DEFAULT_SIDE) === side)
  // Выделение тоже принадлежит стороне: выделенный на спине элемент, пока
  // смотрят на перед, дал бы панель свойств от невидимого элемента.
  const selectedId = elements.some((el) => el.id === c.selectedId) ? c.selectedId : null
  return { elements, selectedId }
}

/** Сколько элементов на каждой стороне. Пустые стороны не называются.
 *
 * Нужно, чтобы видеть про спину, не переключаясь на неё: иначе половина работы
 * забывается и сдаётся недоделанной. */
export function sidesUsed(c: Composition): Record<string, number> {
  const out: Record<string, number> = {}
  for (const el of c.elements) {
    const side = el.placement.side ?? DEFAULT_SIDE
    out[side] = (out[side] ?? 0) + 1
  }
  return out
}

/** Подъём состояния, сохранённого до появления сторон.
 *
 * Без него страница, открытая после обновления, показывает пустое изделие, и
 * человек считает, что работа пропала. */
export function upgrade(c: Composition): Composition {
  return {
    ...c,
    elements: c.elements.map((el) =>
      el.placement.side
        ? el
        : { ...el, placement: { ...el.placement, side: DEFAULT_SIDE } },
    ),
  }
}
