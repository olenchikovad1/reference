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
import { anchorOnSurface, seamArc, toSurface, type Panel, type Torso } from './torso'

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

/**
 * Всё, что нужно, чтобы считать по ткани, а не по кадру.
 *
 * По кадру принт у края торса больше, чем по ткани: ткань там уходит от
 * камеры. Зона нарисована на кадре, поэтому её вершины переводятся на ткань;
 * поле размера приходит от технолога в сантиметрах ткани и строится сразу там.
 */
export interface SurfaceContext {
  readonly torso: Torso
  /** Ориентиры стороны на её собственном кадре. */
  readonly anchors: Readonly<Record<string, [number, number]>>
  /** Поле размера [ширина, высота], см ткани. Есть — заменяет зону печати. */
  readonly fieldCm?: readonly number[] | null
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

/** Габарит элемента на ТКАНИ: по горизонтали длина дуги, по вертикали высота
 *  вниз от верха. Ось вниз — как у кадра, чтобы прямоугольник был тем же. */
function rectOnSurface(el: PrintElement, panel: Panel, ctx: SurfaceContext): Rect {
  const a = anchorOnSurface(ctx.torso, panel, ctx.anchors[el.placement.anchor] ?? [0, 0])
  const cx = a.u + el.placement.dxCm
  const cy = -(a.h - el.placement.dyCm)
  const w = el.placement.widthCm
  const h = heightCm(el)
  const r = (el.placement.rotation * Math.PI) / 180
  const width = w * Math.abs(Math.cos(r)) + h * Math.abs(Math.sin(r))
  const height = w * Math.abs(Math.sin(r)) + h * Math.abs(Math.cos(r))
  return { x: cx - width / 2, y: cy - height / 2, width, height }
}

/** Точка кадра → точка ткани в той же системе, что rectOnSurface.
 *  Вершина за габаритом торса прижимается к его краю: зону, нарисованную
 *  чуть шире торса, это не ломает. */
function frameToSurface(ctx: SurfaceContext, panel: Panel, [x, y]: Point): Point {
  const s =
    toSurface(ctx.torso, panel, x, y) ??
    toSurface(ctx.torso, panel, nearEdge(ctx.torso, panel, x, y), y)
  if (!s) return [0, 0]
  return [panel === 'front' ? s.uFront : s.uBack, -s.h]
}

function nearEdge(torso: Torso, panel: Panel, x: number, y: number): number {
  const g = torso.views[panel]
  const { centre, half } = g.at(y)
  return centre + Math.sign(x - centre) * half * 0.999
}

/** Ломаная кадра → ткань. Отрезки дробятся: прямая на кадре у края торса —
 *  дуга на ткани, и по двум концам её не восстановить. */
function polyToSurface(ctx: SurfaceContext, panel: Panel, poly: readonly Point[], closed: boolean): Point[] {
  const out: Point[] = []
  const n = closed ? poly.length : poly.length - 1
  for (let i = 0; i < n; i += 1) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    // Три отрезка на сторону, а не больше: изгиб в пределах стороны зоны мал,
    // а каждая лишняя вершина множит стоимость подсчёта покрытия — он идёт
    // сотнями проб на элемент при каждом движении.
    for (let k = 0; k < 3; k += 1) {
      const f = k / 3
      out.push(frameToSurface(ctx, panel, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]))
    }
  }
  if (!closed && poly.length > 0) out.push(frameToSurface(ctx, panel, poly[poly.length - 1]))
  return out
}

/** Зоны, переведённые на ткань, — раз на модель торса, кадр и поле размера.
 *  От движения принта они не зависят, а перевод сотни точек на каждое
 *  движение мышью и был самой дорогой частью проверок. */
interface FabricZones {
  bounds: Polygon | undefined
  lines: [string, Point[]][]
  hood: Polygon | undefined
  hoodDown: Polygon | undefined
}
const fabricZones = new WeakMap<Torso, WeakMap<object, Map<string, FabricZones>>>()

function fieldKey(s: SurfaceContext): string {
  return s.fieldCm ? s.fieldCm.join('x') : '-'
}

function remember(s: SurfaceContext, state: object, z: FabricZones, hoodDownScale: number) {
  let byState = fabricZones.get(s.torso)
  if (!byState) fabricZones.set(s.torso, (byState = new WeakMap()))
  let byField = byState.get(state)
  if (!byField) byState.set(state, (byField = new Map()))
  // Размер меняет и поле, и зону опущенного капюшона — ключ из обоих.
  byField.set(`${fieldKey(s)}|${hoodDownScale}`, z)
}

/** Центр многоугольника по габариту. */
function centreOfPoly(poly: readonly Point[]): Point {
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
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
  /** Поле выбранного размера. Есть — считаем по нему: зона нарисована для
   *  отрендеренного изделия, а печатают на выбранном размере. Нет — по зоне,
   *  и человеку сказано, что размер без поля. */
  field?: Polygon | null,
  /** Есть — считаем по ткани. Нет — по кадру, как у изделия без объёма. */
  surface?: SurfaceContext | null,
  /** Во сколько раз зона опущенного капюшона на этом размере больше, чем на
   *  кадре (нарисована для отрендеренного). Капюшон растёт медленнее груди, и
   *  на кадре, который показывает любой размер, его доля меняется (US-0519). */
  hoodDownScale = 1,
): Finding[] {
  if (state.kind === 'illustrative') return []
  const found: Finding[] = []
  const panel = state.code === 'front' || state.code === 'back' ? (state.code as Panel) : null
  const onFabric = !!surface && !!panel && !!surface.torso.views[state.code]

  let bounds: Polygon | undefined
  let lines: [string, Point[]][]
  let hood: Polygon | undefined
  let hoodDown: Polygon | undefined
  // Зона опущенного капюшона — от горловины: растёт вниз и в стороны от неё.
  const neck = state.anchors.neck
  const hdFrame = state.zones.hood_down as Polygon | undefined
  const hdScaled =
    hdFrame && hdFrame.length >= 3 && neck
      ? hdFrame.map(([x, y]) => [neck[0] + (x - neck[0]) * hoodDownScale, neck[1] + (y - neck[1]) * hoodDownScale] as Point)
      : hdFrame
  const cached =
    onFabric && surface
      ? fabricZones.get(surface.torso)?.get(state)?.get(`${fieldKey(surface)}|${hoodDownScale}`)
      : undefined
  if (cached) {
    ;({ bounds, lines, hood, hoodDown } = cached)
  } else if (onFabric && surface && panel) {
    const zone = state.zones.print as Polygon | undefined
    if (surface.fieldCm && zone && zone.length >= 3) {
      // Поле размера строится сразу на ткани: таблица технолога — это
      // сантиметры ткани, а не пиксели фотографии.
      const [cu, cv] = frameToSurface(surface, panel, centreOfPoly(zone))
      const [w, h] = surface.fieldCm
      bounds = [
        [cu - w / 2, cv - h / 2],
        [cu + w / 2, cv - h / 2],
        [cu + w / 2, cv + h / 2],
        [cu - w / 2, cv + h / 2],
      ]
    } else if (zone && zone.length >= 3) {
      bounds = polyToSurface(surface, panel, zone, true)
    }
    lines = Object.entries(state.lines ?? {}).map(([name, line]) => [
      name,
      polyToSurface(surface, panel, line as Point[], false),
    ])
    const hz = state.zones.hood as Polygon | undefined
    hood = hz && hz.length >= 3 ? polyToSurface(surface, panel, hz, true) : undefined
    hoodDown = hdScaled && hdScaled.length >= 3 ? polyToSurface(surface, panel, hdScaled, true) : undefined
    remember(surface, state, { bounds, lines, hood, hoodDown }, hoodDownScale)
  } else {
    bounds = field ?? (state.zones.print as Polygon | undefined)
    lines = Object.entries(state.lines ?? {}).map(([name, line]) => [name, line as Point[]])
    hood = state.zones.hood as Polygon | undefined
    hoodDown = hdScaled
  }

  for (const el of c.elements) {
    const rect = onFabric && surface && panel ? rectOnSurface(el, panel, surface) : rectOf(el, state, cal)

    if (bounds && bounds.length >= 3) {
      const inside = coverage(bounds, rect)
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

    for (const [name, line] of lines) {
      if (line.length >= 2 && crosses(line, rect)) {
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

    if (onFabric && surface && panel) {
      // Шов меряется по самому узкому месту элемента по высоте: глубина торса
      // меняется, и у груди до шва ближе, чем у низа. Верх, низ и середина —
      // достаточно, изгиб по высоте плавный.
      const top = -rect.y
      const bottom = -(rect.y + rect.height)
      const limit = Math.min(
        seamArc(surface.torso, panel, top),
        seamArc(surface.torso, panel, bottom),
        seamArc(surface.torso, panel, (top + bottom) / 2),
      )
      const over = Math.max(rect.x + rect.width - limit, -limit - rect.x)
      if (over > 0.05) {
        found.push({
          rule: 'crosses-side-seam',
          // Блокирующая: за швом другая деталь, и напечатать там этим
          // прогоном нечем. На экране принт огибает бок — это и обманывает.
          weight: 'blocking',
          elementId: el.id,
          message:
            `«${el.name}» заходит за боковой шов на ${over.toFixed(1).replace('.', ',')} см. ` +
            'За швом другая деталь — эта часть не напечатается.',
        })
      }
    }

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

    const underLowered = hoodDown && hoodDown.length >= 3 ? coverage(hoodDown, rect) : 0
    if (underLowered > 0.01) {
      found.push({
        rule: 'under-lowered-hood',
        // Предупреждение: при надетом капюшоне принт виден, решает человек.
        weight: 'warning',
        elementId: el.id,
        message:
          `«${el.name}» при опущенном капюшоне закроется на ${Math.round(underLowered * 100)}%. ` +
          'Граница расчётная: длина капюшона по табелям Cosmic, опущенный комкается на лопатках.',
      })
    }
  }
  return found
}
