// Композиция: что лежит на изделии и где.
//
// Положение и размер хранятся В САНТИМЕТРАХ от именованного ориентира, а не в
// пикселях кадра. Пиксели — свойство конкретного кадра: сменится разрешение,
// сменится ракурс, появится другой источник изображений — и всё размещение
// придётся пересчитывать. Сантиметры переживают всё это, потому что они
// принадлежат лекалу, а не картинке.

import type { Look } from './look'
export type ElementKind = 'image' | 'text'

export interface Placement {
  /** Сторона изделия, на которой лежит элемент: front, back.
   *
   * Свойство ЭЛЕМЕНТА, а не режима просмотра. Режим просмотра показал бы один
   * и тот же принт на всех кадрах сразу — то есть изделие, которого не бывает,
   * и заметила бы это фабрика, а не мы.
   *
   * Стоит рядом с якорем не случайно: якорь называет ориентир на конкретном
   * кадре, и без стороны он не определён. */
  readonly side: string
  /** Имя ориентира, от которого считается смещение: neck, hem, centre. */
  readonly anchor: string
  /** Смещение центра элемента от ориентира, сантиметры. Вниз — плюс. */
  readonly dxCm: number
  readonly dyCm: number
  /** Ширина элемента на изделии, сантиметры. Высота следует за пропорцией. */
  readonly widthCm: number
  /** Поворот по часовой, градусы. */
  readonly rotation: number
  /** Коэффициент принта, вписанный руками на размере, — исключение из сетки.
   *
   * Хранится КОЭФФИЦИЕНТОМ к базе, а не сантиметрами: дизайнер думает «на 98 —
   * ×0.9 вместо ×0.731 по сетке», и при правке базы должно остаться ×0.9. Нет
   * записи — коэффициент по сетке. */
  readonly scaleBySize?: Readonly<Record<string, number>>
  /** Прежняя форма исключения — сантиметрами. Только читается и при чтении
   *  переводится в коэффициент (см. upgrade); не пишется. */
  readonly widthBySize?: Readonly<Record<string, number>>
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
  /** Краска и прозрачность без новой картинки (US-0502): исходник тот же,
   *  хранятся параметры. Нет — картинка как есть. */
  readonly look?: Look
}

export interface TextElement {
  readonly id: string
  readonly kind: 'text'
  readonly name: string
  /** Текст остаётся ТЕКСТОМ. В кривые он переводится только на экспорте —
   *  иначе правка одной буквы снова стоит круга через дизайнера, а замечание
   *  «поправь только надпись» опять означает пересмотр всей работы. */
  readonly text: string
  readonly fontFamily: string
  readonly weight: number
  /** Цвет надписи кодом справочника, как и цвет изделия. */
  readonly colourCode: string
  readonly rgb: readonly [number, number, number]
  /** Пропорция отрисованной надписи: ширина к высоте. Меряется по
   *  отрисованному — вычислить её из текста нельзя. */
  readonly textAspect: number
  readonly placement: Placement
}

export type PrintElement = ImageElement | TextElement

export interface Composition {
  readonly elements: readonly PrintElement[]
  readonly selectedId: string | null
}

export const EMPTY: Composition = { elements: [], selectedId: null }

/** Поменять вид картинки — краску и прозрачность; `null` в краске — вернуть
 *  исходный цвет. Исходник не трогается. */
export function relook(c: Composition, id: string, patch: Partial<Look>): Composition {
  return {
    ...c,
    elements: c.elements.map((el) => (el.id === id && el.kind === 'image' ? { ...el, look: { ...el.look, ...patch } } : el)),
  }
}

/**
 * Высота элемента в сантиметрах.
 *
 * У картинки — из ширины и пропорции исходника. У надписи пропорция зависит от
 * самого текста и начертания, поэтому её меряют по отрисованному, а не
 * вычисляют: `textAspect` кладёт туда тот, кто рисовал.
 */
export function heightCm(el: PrintElement): number {
  const aspect = el.kind === 'image' ? el.aspect : el.textAspect
  return el.placement.widthCm / Math.max(aspect, 0.01)
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
/** Правка текста: меняется текст, всё остальное остаётся на месте. */
export function retype(c: Composition, id: string, text: string): Composition {
  return {
    ...c,
    elements: c.elements.map((e) => (e.id === id && e.kind === 'text' ? { ...e, text } : e)),
  }
}

/** Смена начертания, веса или цвета надписи. */
export function restyle(
  c: Composition,
  id: string,
  patch: Partial<Pick<TextElement, 'fontFamily' | 'weight' | 'colourCode' | 'rgb' | 'textAspect'>>,
): Composition {
  return {
    ...c,
    elements: c.elements.map((e) => (e.id === id && e.kind === 'text' ? { ...e, ...patch } : e)),
  }
}

export function nudge(c: Composition, id: string, dxCm: number, dyCm: number): Composition {
  const el = find(c, id)
  if (!el) return c
  return place(c, id, {
    dxCm: el.placement.dxCm + dxCm,
    dyCm: el.placement.dyCm + dyCm,
  })
}
