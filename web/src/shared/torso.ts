// Упрощённый объём торса: сантиметры по ткани ↔ пиксели кадра на любом ракурсе.
//
// Меша нет, поэтому торс — эллиптический цилиндр. Ширина `a` постоянна и
// взята с переда ниже рукавов; глубина `b(h)` меняется по высоте и взята с
// бокового кадра построчно. Сечение на высоте h — эллипс x = a·sin θ,
// z = b·cos θ, где θ = 0 — центр переда, θ = π/2 — левый бок носящего.
//
// Смещение принта в сантиметрах — это ДЛИНА ДУГИ по ткани, а не расстояние на
// фотографии. Сантиметры принадлежат лекалу (И-1), и у края торса плоский
// перевод расходится с тканью на треть.
//
// Это единственное место, где такой перевод происходит: шейдер получает
// готовую карту отсюда, а не считает ту же формулу второй раз на GLSL. Две
// реализации разошлись бы, и разошлись бы у края — там, где и смотрят.

export interface TorsoViewData {
  readonly facing_deg: number
  readonly hem_y: number
  readonly centre_x?: number | null
  readonly half_px?: number | null
  /** [y, левый край, правый край] — построчный габарит. */
  readonly rows?: readonly (readonly number[])[] | null
}

export interface TorsoData {
  readonly provisional: boolean
  readonly method: string
  readonly side_seam_deg: number
  readonly views: Readonly<Record<string, TorsoViewData>>
}

export type Panel = 'front' | 'back'

interface ViewGeom {
  readonly facing: number
  readonly hemY: number
  /** Центр и половина ширины торса на кадре в строке y. */
  at(y: number): { centre: number; half: number }
}

export interface Torso {
  readonly provisional: boolean
  /** Пикселей кадра на сантиметр — по вертикали для всех ракурсов. */
  readonly ppc: number
  /** Половина ширины торса, см. */
  readonly a: number
  /** Боковой шов, угол от центра переда. */
  readonly seam: number
  readonly views: Readonly<Record<string, ViewGeom>>
  /** Половина глубины торса на высоте h над низом, см. */
  depthAt(h: number): number
}

// ---------------------------------------------------------------- построение

function interpolateRows(rows: readonly (readonly number[])[], y: number) {
  const sorted = [...rows].sort((p, q) => p[0] - q[0])
  if (y <= sorted[0][0]) return sorted[0]
  if (y >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1]
  for (let i = 1; i < sorted.length; i += 1) {
    const [y1, l1, r1] = sorted[i]
    if (y <= y1) {
      const [y0, l0, r0] = sorted[i - 1]
      const k = (y - y0) / (y1 - y0)
      return [y, l0 + k * (l1 - l0), r0 + k * (r1 - r0)]
    }
  }
  return sorted[sorted.length - 1]
}

function geomOf(v: TorsoViewData): ViewGeom | null {
  const facing = (v.facing_deg * Math.PI) / 180
  if (v.rows && v.rows.length > 0) {
    const rows = v.rows
    return {
      facing,
      hemY: v.hem_y,
      at(y) {
        const [, l, r] = interpolateRows(rows, y)
        return { centre: (l + r) / 2, half: (r - l) / 2 }
      },
    }
  }
  if (v.centre_x == null || v.half_px == null) return null
  const centre = v.centre_x
  const half = v.half_px
  return { facing, hemY: v.hem_y, at: () => ({ centre, half }) }
}

/**
 * Модель торса при данной калибровке.
 *
 * Калибровка — это размер: на 98 тот же кадр означает изделие меньше, и
 * сантиметры ткани пересчитываются вместе с ней. Поэтому модель строится
 * заново при смене размера, а не хранится.
 */
export function buildTorso(data: TorsoData, ppc: number): Torso | null {
  const views: Record<string, ViewGeom> = {}
  for (const [code, v] of Object.entries(data.views)) {
    const g = geomOf(v)
    if (g) views[code] = g
  }
  const facingOf = (deg: number) =>
    Object.values(views).find((g) => Math.abs(g.facing - (deg * Math.PI) / 180) < 1e-6)
  const front = facingOf(0)
  if (!front) return null
  const a = front.at(front.hemY).half / ppc
  const side = facingOf(90)
  // Без бокового кадра глубину взять неоткуда, и сечение считается кругом.
  // Это грубее, но честнее, чем выдуманное соотношение сторон.
  const depthAt = side
    ? (h: number) => side.at(side.hemY - h * ppc).half / ppc
    : () => a
  return {
    provisional: data.provisional,
    ppc,
    a,
    seam: (data.side_seam_deg * Math.PI) / 180,
    views,
    depthAt,
  }
}

// ------------------------------------------------------------- длина по ткани

const STEPS = 512

/** Таблицы дуги по сечениям. Глубина меняется по высоте плавно, и сечения
 *  соседних строк совпадают до сотых сантиметра: без запоминания проверки и
 *  рамки строили одну и ту же таблицу сотни раз на каждое движение мышью. */
const tables = new Map<string, Float64Array>()

/** Накопленная длина дуги от центра переда, θ ∈ [0, π] — таблицей.
 *  Сечения округляются до 0.005 см: на длине дуги это меньше десятой доли
 *  миллиметра, а запомненных таблиц — тысячи, а не миллионы. */
function arcTable(a: number, b: number): Float64Array {
  const key = `${Math.round(a * 200)}:${Math.round(b * 200)}`
  const hit = tables.get(key)
  if (hit) return hit
  if (tables.size > 4000) tables.clear()
  const table = buildArcTable(Math.round(a * 200) / 200, Math.round(b * 200) / 200)
  tables.set(key, table)
  return table
}

function buildArcTable(a: number, b: number): Float64Array {
  const table = new Float64Array(STEPS + 1)
  const dt = Math.PI / STEPS
  const f = (t: number) => Math.sqrt(a * a * Math.cos(t) ** 2 + b * b * Math.sin(t) ** 2)
  let prev = f(0)
  for (let i = 1; i <= STEPS; i += 1) {
    const cur = f(i * dt)
    table[i] = table[i - 1] + ((prev + cur) / 2) * dt
    prev = cur
  }
  return table
}

function arcFromTable(table: Float64Array, theta: number): number {
  const s = Math.sign(theta)
  const k = (Math.min(Math.abs(theta), Math.PI) / Math.PI) * STEPS
  const i = Math.min(STEPS - 1, Math.floor(k))
  return s * (table[i] + (k - i) * (table[i + 1] - table[i]))
}

function angleFromTable(table: Float64Array, arc: number): number | null {
  const s = Math.sign(arc)
  const target = Math.abs(arc)
  if (target > table[STEPS]) return null
  let lo = 0
  let hi = STEPS
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (table[mid] < target) lo = mid
    else hi = mid
  }
  const span = table[hi] - table[lo] || 1
  return s * ((lo + (target - table[lo]) / span) * (Math.PI / STEPS))
}

/** Длина по ткани от центра переда до угла θ на высоте h, см. Со знаком. */
export function arcLength(t: Torso, h: number, theta: number): number {
  return arcFromTable(arcTable(t.a, t.depthAt(h)), theta)
}

// -------------------------------------------------------------------- ракурс

/** Угол в (−π, π]. */
function wrap(theta: number): number {
  let x = theta
  while (x <= -Math.PI) x += 2 * Math.PI
  while (x > Math.PI) x -= 2 * Math.PI
  return x
}

/** Смотрит ли точка сечения на камеру этого ракурса. */
function facesCamera(a: number, b: number, theta: number, facing: number): boolean {
  return b * Math.sin(theta) * Math.sin(facing) + a * Math.cos(theta) * Math.cos(facing) > 1e-9
}

/** Флаги детали, которой может принадлежать точка: 1 — перед, 2 — спинка.
 *
 * Координата переда разрывается на центре спины, спинки — на центре переда.
 * Там каждая деталь и не допускается: иначе на разрыве соседние пиксели
 * брали бы принт с противоположных концов детали, и посреди груди прошёл бы
 * шов, которого нет. Запас в 5° — от разрыва, не от шва. */
const MARGIN = (5 * Math.PI) / 180
function flagsOf(theta: number): number {
  const phi = wrap(theta - Math.PI)
  return (Math.abs(theta) < Math.PI - MARGIN ? 1 : 0) | (Math.abs(phi) < Math.PI - MARGIN ? 2 : 0)
}

export interface SurfacePoint {
  /** Высота над низом торса, см. */
  readonly h: number
  readonly theta: number
  /** Длина по ткани от центра переда: плюс — к левому боку носящего. */
  readonly uFront: number
  /** Длина по ткани от центра спины: плюс — к правому боку носящего, то есть
   *  вправо на кадре спины — туда же, куда смещение на спине. */
  readonly uBack: number
  readonly flags: number
}

/** Точка кадра → точка на ткани. null — не торс. */
export function toSurface(t: Torso, view: string, x: number, y: number): SurfacePoint | null {
  const g = t.views[view]
  if (!g) return null
  const h = (g.hemY - y) / t.ppc
  const b = t.depthAt(h)
  const { centre, half } = g.at(y)
  const theta = solveTheta(t.a, b, g.facing, (x - centre) / half)
  if (theta === null) return null
  const table = arcTable(t.a, b)
  return pointAt(table, h, theta)
}

function solveTheta(a: number, b: number, facing: number, t: number): number | null {
  if (Math.abs(t) > 1) return null
  const delta = Math.atan2(b * Math.sin(facing), a * Math.cos(facing))
  const s = Math.asin(t)
  // Проекция a·sinθ·cosα − b·cosθ·sinα = E·sin(θ − δ) имеет два решения —
  // спереди и сзади сечения. Видно только то, что смотрит на камеру.
  for (const theta of [delta + s, delta + Math.PI - s]) {
    if (facesCamera(a, b, theta, facing)) return wrap(theta)
  }
  return wrap(delta + s)
}

function pointAt(table: Float64Array, h: number, theta: number): SurfacePoint {
  const phi = wrap(theta - Math.PI)
  return {
    h,
    theta,
    uFront: arcFromTable(table, theta),
    uBack: arcFromTable(table, phi),
    flags: flagsOf(theta),
  }
}

/** Точка на ткани детали → кадр. null — дальше половины обхвата. */
export function toFrame(
  t: Torso,
  view: string,
  panel: Panel,
  u: number,
  h: number,
): { x: number; y: number; visible: boolean } | null {
  const g = t.views[view]
  if (!g) return null
  const b = t.depthAt(h)
  const table = arcTable(t.a, b)
  const along = angleFromTable(table, u)
  if (along === null) return null
  const theta = wrap(panel === 'front' ? along : Math.PI + along)
  const y = g.hemY - h * t.ppc
  const { centre, half } = g.at(y)
  const E = Math.hypot(t.a * Math.cos(g.facing), b * Math.sin(g.facing))
  const p = t.a * Math.sin(theta) * Math.cos(g.facing) - b * Math.cos(theta) * Math.sin(g.facing)
  return { x: centre + (p / E) * half, y, visible: facesCamera(t.a, b, theta, g.facing) }
}

/** Где на ткани детали лежит ориентир её собственного кадра. */
export function anchorOnSurface(
  t: Torso,
  panel: Panel,
  point: readonly [number, number],
): { u: number; h: number } {
  const g = t.views[panel]
  if (!g) return { u: 0, h: 0 }
  const { centre, half } = g.at(point[1])
  // Ориентир у самого края (плечо) может лечь за габарит торса на кадре —
  // тогда он прижимается к краю, а не теряется.
  const clamped = centre + Math.max(-0.999, Math.min(0.999, (point[0] - centre) / half)) * half
  const s = toSurface(t, panel, clamped, point[1])
  if (!s) return { u: 0, h: (g.hemY - point[1]) / t.ppc }
  return { u: panel === 'front' ? s.uFront : s.uBack, h: s.h }
}

// --------------------------------------------------------------- карта шейдеру

/**
 * Карта «пиксель отрисовки → точка на ткани» для шейдера.
 *
 * На пиксель четыре числа: длина по ткани переда, длина по ткани спинки,
 * высота, флаги деталей. Разрешение — как у отрисовки, а не у кадра: шейдер
 * берёт ближайший пиксель карты, и при приближении карта в разрешении кадра
 * рисовала бы принт квадратами.
 */
export function buildLookup(
  t: Torso,
  view: string,
  width: number,
  height: number,
  scale: number,
  out?: Float32Array,
): Float32Array {
  const map = out && out.length === width * height * 4 ? out : new Float32Array(width * height * 4)
  map.fill(0)
  const g = t.views[view]
  if (!g) return map
  for (let j = 0; j < height; j += 1) {
    const y = (j + 0.5) / scale
    const h = (g.hemY - y) / t.ppc
    if (h < 0) continue
    // Всё, что зависит только от строки, считается раз на строку: в строке
    // тысячи пикселей, и таблица дуги на каждый — это секунды вместо долей.
    const b = t.depthAt(h)
    const table = arcTable(t.a, b)
    const { centre, half } = g.at(y)
    const delta = Math.atan2(b * Math.sin(g.facing), t.a * Math.cos(g.facing))
    for (let i = 0; i < width; i += 1) {
      const q = ((i + 0.5) / scale - centre) / half
      if (q <= -1 || q >= 1) continue
      const s = Math.asin(q)
      let theta = delta + s
      if (!facesCamera(t.a, b, theta, g.facing)) theta = delta + Math.PI - s
      theta = wrap(theta)
      const o = (j * width + i) * 4
      map[o] = arcFromTable(table, theta)
      map[o + 1] = arcFromTable(table, wrap(theta - Math.PI))
      map[o + 2] = h
      map[o + 3] = flagsOf(theta)
    }
  }
  return map
}

/** Половина обхвата на высоте h — дальше этого ткань детали не уходит. */
export function halfGirth(t: Torso, h: number): number {
  return arcFromTable(arcTable(t.a, t.depthAt(h)), Math.PI)
}

/** Точка элемента в его собственных координатах (от центра, вниз — плюс,
 *  до поворота) → кадр. */
export function projectLocal(
  t: Torso,
  view: string,
  panel: Panel,
  centre: { u: number; h: number },
  lx: number,
  ly: number,
  rotationDeg: number,
): { x: number; y: number; visible: boolean } | null {
  const r = (rotationDeg * Math.PI) / 180
  const du = lx * Math.cos(r) - ly * Math.sin(r)
  const dv = lx * Math.sin(r) + ly * Math.cos(r)
  return toFrame(t, view, panel, centre.u + du, centre.h - dv)
}

/**
 * Контур прямоугольника ткани на кадре: стороны дробятся, и каждая точка
 * проходит через модель. Прямая на ткани у края торса — дуга на кадре, и по
 * четырём углам её не нарисовать. Невидимые точки — за краем, где ткань
 * ушла от камеры, — в контур не входят.
 */
export function projectRect(
  t: Torso,
  view: string,
  panel: Panel,
  centre: { u: number; h: number },
  w: number,
  h: number,
  rotationDeg: number,
  steps = 8,
): [number, number][] {
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ]
  const out: [number, number][] = []
  for (let i = 0; i < 4; i += 1) {
    const [x0, y0] = corners[i]
    const [x1, y1] = corners[(i + 1) % 4]
    for (let k = 0; k < steps; k += 1) {
      const f = k / steps
      const p = projectLocal(t, view, panel, centre, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, rotationDeg)
      if (p?.visible) out.push([p.x, p.y])
    }
  }
  return out
}

/**
 * Длина по ткани от центра детали до бокового шва на высоте h, см.
 *
 * Дальше шва деталь кончается: у переда шов на угле `seam` от его центра, у
 * спинки — на π − seam от своего. Глубина торса меняется по высоте, поэтому
 * и до шва по ткани на уровне груди ближе, чем у низа.
 */
export function seamArc(t: Torso, panel: Panel, h: number): number {
  const table = arcTable(t.a, t.depthAt(h))
  return arcFromTable(table, panel === 'front' ? t.seam : Math.PI - t.seam)
}
