// Композиция: что лежит на изделии и где.
//
// Положение и размер хранятся В САНТИМЕТРАХ от именованного ориентира, а не в
// пикселях кадра. Пиксели — свойство конкретного кадра: сменится разрешение,
// сменится ракурс, появится другой источник изображений — и всё размещение
// придётся пересчитывать. Сантиметры переживают всё это, потому что они
// принадлежат лекалу, а не картинке.

export type ElementKind = 'image' | 'text'

export interface Placement {
  /** Имя ориентира, от которого считается смещение: neck, hem, centre. */
  readonly anchor: string
  /** Смещение центра элемента от ориентира, сантиметры. Вниз — плюс. */
  readonly dxCm: number
  readonly dyCm: number
  /** Ширина элемента на изделии, сантиметры. Высота следует за пропорцией. */
  readonly widthCm: number
  /** Поворот по часовой, градусы. */
  readonly rotation: number
}

export interface ImageElement {
  readonly id: string
  readonly kind: 'image'
  readonly name: string
  /** Ссылка на изображение в браузере. На сервер оно уйдёт в US-0426. */
  readonly src: string
  /** Пропорция исходника: нужна, чтобы из ширины в см получить высоту. */
  readonly aspect: number
  /** Есть ли у картинки прозрачность. Нет — значит ляжет прямоугольником. */
  readonly hasAlpha: boolean
  readonly placement: Placement
}

export type PrintElement = ImageElement

export interface Composition {
  readonly elements: readonly PrintElement[]
  readonly selectedId: string | null
}

export const EMPTY: Composition = { elements: [], selectedId: null }

/** Высота элемента в сантиметрах — из ширины и пропорции исходника. */
export function heightCm(el: PrintElement): number {
  return el.placement.widthCm / el.aspect
}

export function add(c: Composition, el: PrintElement): Composition {
  return { elements: [...c.elements, el], selectedId: el.id }
}

export function remove(c: Composition, id: string): Composition {
  const elements = c.elements.filter((e) => e.id !== id)
  return { elements, selectedId: c.selectedId === id ? null : c.selectedId }
}

export function select(c: Composition, id: string | null): Composition {
  return { ...c, selectedId: id }
}

/**
 * Меняет размещение элемента.
 *
 * Возвращает новую композицию, а не правит существующую: на неизменяемости
 * держится отмена из US-0428, и вводить её потом поверх правки на месте
 * означало бы переписать всё, что успеет на эту правку опереться.
 */
export function place(c: Composition, id: string, patch: Partial<Placement>): Composition {
  return {
    ...c,
    elements: c.elements.map((e) =>
      e.id === id ? { ...e, placement: { ...e.placement, ...patch } } : e,
    ),
  }
}

export function find(c: Composition, id: string | null): PrintElement | null {
  return c.elements.find((e) => e.id === id) ?? null
}

/** Сдвиг на заданное число сантиметров — то, что делают стрелки на клавиатуре. */
export function nudge(c: Composition, id: string, dxCm: number, dyCm: number): Composition {
  const el = find(c, id)
  if (!el) return c
  return place(c, id, {
    dxCm: el.placement.dxCm + dxCm,
    dyCm: el.placement.dyCm + dyCm,
  })
}
