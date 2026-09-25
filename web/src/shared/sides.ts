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
  // Номера чинятся здесь же, при чтении: сохранённое раньше могло получить
  // повтор, и оставлять его значит править два элемента вместо одного.
  const seen = new Set<string>()
  return {
    ...c,
    elements: c.elements.map((el) => {
      let sided = el.placement.side
        ? el
        : { ...el, placement: { ...el.placement, side: DEFAULT_SIDE } }
      // Исключения размеров раньше хранились сантиметрами; теперь —
      // коэффициентом к базе. Переводим при чтении: иначе исключение, сделанное
      // до этой правки, молча пропало бы.
      const cm = sided.placement.widthBySize
      if (cm && sided.placement.widthCm > 0) {
        const scale: Record<string, number> = { ...(sided.placement.scaleBySize ?? {}) }
        for (const [size, w] of Object.entries(cm)) scale[size] ??= w / sided.placement.widthCm
        const { widthBySize: _gone, ...rest } = sided.placement
        void _gone
        sided = { ...sided, placement: { ...rest, scaleBySize: scale } }
      }
      if (!seen.has(sided.id)) {
        seen.add(sided.id)
        return sided
      }
      const id = newElementId()
      seen.add(id)
      return { ...sided, id }
    }),
  }
}

/** Номер нового элемента. Случайный, а не по счётчику: счётчик после
 *  перезагрузки начинается заново и выдаёт номера уже восстановленных. */
export function newElementId(): string {
  return `el-${crypto.randomUUID().slice(0, 8)}`
}

/** Куда переносится принт: перед ↔ спина. Бок иллюстративный, туда не
 *  переносят — размер по нему не считается. */
export function otherSide(side: string): string | null {
  if (side === 'front') return 'back'
  if (side === 'back') return 'front'
  return null
}

/**
 * «Перенести на спину» («на перед»): принт уезжает на другую сторону с тем же
 * размером, высотой от ориентира и поворотом (US-0492).
 *
 * Сантиметры не пересчитываются: они и так на ткани (И-1), а «12 см ниже
 * горловины» на спине значит то же, что на переде. Ориентир сохраняется, если
 * он есть у новой стороны, иначе принт встаёт от горловины — она есть всегда.
 * Выделение остаётся на перенесённом, чтобы вид можно было сразу переключить
 * вслед за ним.
 */
export function moveToSide(c: Composition, id: string, side: string, anchors: readonly string[]): Composition {
  return {
    ...c,
    elements: c.elements.map((el) =>
      el.id !== id
        ? el
        : {
            ...el,
            placement: {
              ...el.placement,
              side,
              anchor: anchors.includes(el.placement.anchor) ? el.placement.anchor : 'neck',
            },
          },
    ),
  }
}
