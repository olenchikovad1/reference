// Разбор брошенного файла.
//
// Нужен ровно для двух вещей: узнать пропорцию, чтобы из ширины в сантиметрах
// получить высоту, и узнать, есть ли прозрачность. Второе — не украшение:
// картинка без прозрачности ляжет на изделие прямоугольником, и человеку надо
// сказать об этом словами, иначе результат читается как поломка.

export interface DroppedImage {
  readonly name: string
  readonly src: string
  readonly width: number
  readonly height: number
  readonly aspect: number
  readonly hasAlpha: boolean
}

/** Есть ли в изображении хоть один непрозрачный не до конца пиксель. */
export function detectAlpha(pixels: Uint8ClampedArray): boolean {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) return true
  }
  return false
}

/**
 * Читает брошенный файл: пропорция и прозрачность.
 *
 * Прозрачность ищется по уменьшенной копии, а не по оригиналу: принт бывает в
 * несколько тысяч пикселей по стороне, и перебирать их целиком незачем — один
 * полупрозрачный пиксель переживёт уменьшение.
 */
export async function readDropped(file: File): Promise<DroppedImage> {
  const src = URL.createObjectURL(file)
  const img = await loadImage(src)
  const probe = 160
  const w = Math.max(1, Math.min(probe, img.naturalWidth))
  const h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  let hasAlpha = false
  if (ctx) {
    ctx.drawImage(img, 0, 0, w, h)
    hasAlpha = detectAlpha(ctx.getImageData(0, 0, w, h).data)
  }
  return {
    name: file.name,
    src,
    width: img.naturalWidth,
    height: img.naturalHeight,
    aspect: img.naturalWidth / img.naturalHeight,
    hasAlpha,
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('изображение не читается'))
    img.src = src
  })
}
