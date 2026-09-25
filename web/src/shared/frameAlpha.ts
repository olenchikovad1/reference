// Попала ли точка в изделие: по прозрачности кадра (US-0492).
//
// Кадр приходит с прозрачным фоном (решение 0001), поэтому «щёлкнули по
// изделию» и «щёлкнули мимо» различает альфа кадра в этой точке, а не
// полигон: обводить силуэт руками незачем, он уже есть в самом файле.

import { useEffect, useRef } from 'react'

/** Альфа ниже порога — фон: полупрозрачную кромку по краю силуэта изделием
 *  не считаем, щелчок в пиксель от края — это щелчок мимо. */
const SOLID = 32

export function useFrameAlpha(src: string | null): (x: number, y: number) => boolean {
  const alpha = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null)
  useEffect(() => {
    alpha.current = null
    if (!src) return
    let alive = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (!alive) return
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      alpha.current = { data: ctx.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height }
    }
    img.src = src
    return () => {
      alive = false
    }
  }, [src])
  /** Точка в пикселях кадра. Кадр ещё не загрузился — «мимо»: панель изделия
   *  откроется со второго щелчка, а не на пустом месте. */
  return (x, y) => {
    const a = alpha.current
    if (!a) return false
    const px = Math.round(x)
    const py = Math.round(y)
    if (px < 0 || py < 0 || px >= a.width || py >= a.height) return false
    return a.data[(py * a.width + px) * 4 + 3] >= SOLID
  }
}
