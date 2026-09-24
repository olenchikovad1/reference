// Проверки по зонам кадра: печатное поле, линии, перекрытие.
//
// Стоят отдельно от checks.ts не по размеру, а по природе: те считаются из
// самого принта и верны на любом изделии, эти — из КАДРА, и без состояния их
// посчитать нечем. Смешав их, получаем проверку, которая на одном изделии
// работает, а на другом молча ничего не находит.

import type { Composition, PrintElement } from './composition'
import { heightCm } from './composition'
import type { Finding } from './checks'
import { type Calibration, cmToPx } from './geometry'
import { coverage, type Point, type Polygon } from './mask'

export interface FrameState {
  readonly code: string
  readonly kind: 'precise' | 'illustrative'
  readonly anchors: Record<string, [number, number]>
  readonly zones: Record<string, [number, number][]>
  readonly lines: Record<string, [number, number][]>
}

/** Имена линий по-русски: код уходит в описание изделия, имя — человеку. */
const LINE_NAMES: Record<string, string> = {
  zipper: 'молнию',
  seam: 'шов',
  shoulder_seam: 'плечевой шов',
  side_seam: 'боковой шов',
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Габарит элемента на кадре, пиксели.
 *
 * Повёрнутый элемент меряется по описанному прямоугольнику, а не по
 * действительному контуру: проверка тогда срабатывает чуть раньше, чем надо.
 * Ошибаться в эту сторону можно — лишнее предупреждение человек снимет сам, а
 * пропущенный выход за поле он увидит на фабрике.
 */
function rectOf(el: PrintElement, state: FrameState, cal: Calibration): Rect {
  const anchor = state.anchors[el.placement.anchor] ?? [0, 0]
  const cx = anchor[0] + cmToPx(el.placement.dxCm, cal)
  const cy = anchor[1] + cmToPx(el.placement.dyCm, cal)
  const w = cmToPx(el.placement.widthCm, cal)
  const h = cmToPx(heightCm(el), cal)
  const a = (el.placement.rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(a))
  const sin = Math.abs(Math.sin(a))
  const width = w * cos + h * sin
  const height = w * sin + h * cos
  return { x: cx - width / 2, y: cy - height / 2, width, height }
}

/** Пересекает ли ломаная прямоугольник. */
function crosses(line: readonly Point[], r: Rect): boolean {
  for (let i = 1; i < line.length; i += 1) {
    if (segmentHitsRect(line[i - 1], line[i], r)) return true
  }
  return false
}

function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const inside = (p: Point) =>
    p[0] >= r.x && p[0] <= r.x + r.width && p[1] >= r.y && p[1] <= r.y + r.height
  if (inside(a) || inside(b)) return true
  const corners: Point[] = [
    [r.x, r.y],
    [r.x + r.width, r.y],
    [r.x + r.width, r.y + r.height],
    [r.x, r.y + r.height],
  ]
  for (let i = 0; i < 4; i += 1) {
    if (segmentsCross(a, b, corners[i], corners[(i + 1) % 4])) return true
  }
  return false
}

function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = d(p3, p4, p1)
  const d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3)
  const d4 = d(p1, p2, p4)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
}

/**
 * Находки, считаемые из кадра.
 *
 * По иллюстративному ракурсу не считаются вовсе: силуэт на нём сокращён, и
 * находка по нему сообщала бы о проблеме, которой нет.
 */
export function checkZones(
  c: Composition,
  state: FrameState,
  cal: Calibration,
): Finding[] {
  if (state.kind === 'illustrative') return []
  const found: Finding[] = []
  const field = state.zones.print as Polygon | undefined

  for (const el of c.elements) {
    const rect = rectOf(el, state, cal)

    if (field && field.length >= 3) {
      const inside = coverage(field, rect)
      if (inside < 0.999) {
        const outside = Math.max(1, Math.round((1 - inside) * 100))
        found.push({
          rule: 'out-of-print-field',
          // Блокирующая, а не предупреждение: за полем печатать физически
          // нечем, и решать тут нечего.
          weight: 'blocking',
          elementId: el.id,
          message:
            `«${el.name}» вышел за печатное поле на ${outside}% площади. ` +
            'За полем печати нет — уменьшите или подвиньте.',
        })
      }
    }

    for (const [name, line] of Object.entries(state.lines ?? {})) {
      if (line.length >= 2 && crosses(line as Point[], rect)) {
        found.push({
          rule: 'crosses-line',
          weight: 'blocking',
          elementId: el.id,
          message:
            `«${el.name}» пересекает ${LINE_NAMES[name] ?? name}. ` +
            'Там принт разрезается, а не обрезается — половинки не сойдутся.',
        })
      }
    }

    const hood = state.zones.hood as Polygon | undefined
    if (hood && hood.length >= 3 && coverage(hood, rect) > 0.01) {
      found.push({
        rule: 'under-hood',
        // Предупреждение: печатается нормально, просто не видно. Решает
        // человек — бывает, что так и задумано.
        weight: 'warning',
        elementId: el.id,
        message: `«${el.name}» попадает под капюшон: напечатается, но видно не будет.`,
      })
    }
  }
  return found
}
