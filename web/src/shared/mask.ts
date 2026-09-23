// Маски зон изделия: капюшон, печатное поле, карман.
//
// Зона описана полигоном в координатах кадра (решение 0004: маски из UV нет и
// не будет, полигоны обводятся вручную и лежат данными рядом с изделием).
// Отсюда две задачи: понять, попала ли точка в зону, и превратить полигон в
// растровую маску для шейдера.

export type Point = readonly [number, number]
export type Polygon = readonly Point[]

/**
 * Лежит ли точка внутри полигона.
 *
 * Луч вправо и счёт пересечений: нечётное — внутри. Работает на невыпуклых
 * полигонах, а капюшон именно такой.
 */
export function contains(poly: Polygon, [x, y]: Point): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    const crosses = yi > y !== yj > y
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Габарит полигона: нужен, чтобы быстро отсечь заведомо чужие точки. */
export function bounds(poly: Polygon): { x0: number; y0: number; x1: number; y1: number } {
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/**
 * Какая доля прямоугольника накрыта полигоном.
 *
 * Считается по сетке проб, а не точно: точная площадь пересечения здесь не
 * нужна, а нужен ответ «сколько примерно скрыто» для сообщения человеку.
 * Шаг сетки задан числом проб по стороне и назван в сигнатуре, чтобы точность
 * была видимой, а не спрятанной в константе.
 */
export function coverage(
  poly: Polygon,
  rect: { x: number; y: number; width: number; height: number },
  probes = 24,
): number {
  let hit = 0
  for (let i = 0; i < probes; i += 1) {
    for (let j = 0; j < probes; j += 1) {
      const px = rect.x + ((i + 0.5) / probes) * rect.width
      const py = rect.y + ((j + 0.5) / probes) * rect.height
      if (contains(poly, [px, py])) hit += 1
    }
  }
  return hit / (probes * probes)
}

/** Растровая маска зоны для шейдера: белое внутри полигона, чёрное снаружи. */
export function rasterise(
  poly: Polygon,
  width: number,
  height: number,
  canvas?: HTMLCanvasElement,
): HTMLCanvasElement {
  const c = canvas ?? document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')
  if (!ctx) return c
  ctx.clearRect(0, 0, width, height)
  if (poly.length < 3) return c
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.moveTo(poly[0][0], poly[0][1])
  for (const [x, y] of poly.slice(1)) ctx.lineTo(x, y)
  ctx.closePath()
  ctx.fill()
  return c
}
