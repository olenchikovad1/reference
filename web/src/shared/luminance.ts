// Карта яркости изделия: она же карта освещения, она же источник рельефа.
//
// Кадр обесцвечен (насыщенность ровно 0), поэтому яркость — это уже свет, тень
// и складки. Отдельной карты глубины нет и не будет (решение 0004), а складка и
// есть то, что создаёт перепад яркости, — поэтому смещение выводится из неё же.
//
// Считается ОДИН РАЗ на кадр: изделие не меняется, пока двигают принт. Всё, что
// пересчитывается при перетаскивании, — это сам принт, и в этом вся скорость.

export interface LuminanceMap {
  readonly width: number
  readonly height: number
  /** Яркость как есть: свет, тень, AO. Ею затеняется принт. */
  readonly raw: Uint8ClampedArray
  /** Размытая яркость. Её градиент двигает принт по складкам. */
  readonly blurred: Uint8ClampedArray
  /** Опорный белый: самая светлая точка изделия. */
  readonly white: number
}

/** Яркость из RGBA. Кадр ахроматичен, поэтому достаточно красного канала. */
export function luminanceOf(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length / 4)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 1) out[j] = rgba[i]
  return out
}

/**
 * Опорный белый — не 255, а самая светлая точка изделия.
 *
 * Делить на 255 нельзя: у этого кадра белое равно 245, и принт получился бы
 * систематически темнее изделия, на котором лежит.
 */
export function whitePoint(lum: Uint8ClampedArray, alpha: Uint8ClampedArray): number {
  let max = 1
  for (let i = 0; i < lum.length; i += 1) {
    if (alpha[i] > 200 && lum[i] > max) max = lum[i]
  }
  return max
}

/**
 * Размытие прямоугольным ядром, два прохода.
 *
 * Прямоугольное, а не гауссово: карта и так низкочастотная (округление до
 * половины разрешения теряет 2%), а два прохода коробкой стоят линейного
 * времени вместо квадратичного. Разницы на складках не видно.
 */
export function boxBlur(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius < 1) return src.slice()
  const tmp = new Uint8ClampedArray(src.length)
  const out = new Uint8ClampedArray(src.length)
  const span = radius * 2 + 1

  for (let y = 0; y < height; y += 1) {
    let sum = 0
    const row = y * width
    for (let x = -radius; x <= radius; x += 1) sum += src[row + clamp(x, width)]
    for (let x = 0; x < width; x += 1) {
      tmp[row + x] = sum / span
      sum -= src[row + clamp(x - radius, width)]
      sum += src[row + clamp(x + radius + 1, width)]
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let y = -radius; y <= radius; y += 1) sum += tmp[clamp(y, height) * width + x]
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / span
      sum -= tmp[clamp(y - radius, height) * width + x]
      sum += tmp[clamp(y + radius + 1, height) * width + x]
    }
  }
  return out
}

function clamp(v: number, limit: number): number {
  return v < 0 ? 0 : v >= limit ? limit - 1 : v
}

/** Альфа-канал отдельно: по нему принт отсекается по силуэту изделия. */
export function alphaOf(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length / 4)
  for (let i = 3, j = 0; i < rgba.length; i += 4, j += 1) out[j] = rgba[i]
  return out
}

export function buildLuminance(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  blurRadius: number,
): LuminanceMap {
  const raw = luminanceOf(rgba)
  const alpha = alphaOf(rgba)
  return {
    width,
    height,
    raw,
    blurred: boxBlur(raw, width, height, blurRadius),
    white: whitePoint(raw, alpha),
  }
}
