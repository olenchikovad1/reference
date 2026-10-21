// Кадр изделия, окрашенный в цвет: белая база конструктора — в пантон
// цветомодели, без перегонки рендера в 3D-программе (просьба Алисы 21.10).
//
// Красит тот же отрисовщик, что и окно работы (renderer.ts): цвет ложится по
// яркости кадра, складки и блики остаются из самого кадра (решение 0004).
// Второй формулы окраски не заводится — расходились бы окно и доска.
//
// Отрисовщик один на страницу: контекстов WebGL у браузера около шестнадцати,
// а колонок цвета на доске бывает за двадцать. Кадры красятся по очереди на
// одном невидимом холсте, готовое кешируется картинкой по паре «кадр, цвет».
// Пока красится или WebGL нет — показывается сам кадр, честно неокрашенным.

import { useEffect, useState } from 'react'

import { buildLuminance, type LuminanceMap } from '../shared/luminance'
import { createRenderer, DEFAULT_PARAMS, type Renderer } from './renderer'

type Frame = { img: HTMLImageElement; map: LuminanceMap }

let painter: { canvas: HTMLCanvasElement; renderer: Renderer; empty: HTMLCanvasElement } | null | undefined
const frames = new Map<string, Promise<Frame | null>>()
const painted = new Map<string, Promise<string | null>>()
let queue: Promise<unknown> = Promise.resolve()

function painterOf() {
  if (painter === undefined) {
    const canvas = document.createElement('canvas')
    const renderer = createRenderer(canvas)
    // Пустой принт и пустое перекрытие: незаполненная текстура WebGL читается
    // как непрозрачный чёрный, и изделие легло бы под чёрный прямоугольник.
    const empty = document.createElement('canvas')
    empty.width = 1
    empty.height = 1
    painter = renderer ? { canvas, renderer, empty } : null
  }
  return painter
}

function frameOf(src: string): Promise<Frame | null> {
  let got = frames.get(src)
  if (!got) {
    got = new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const probe = document.createElement('canvas')
        probe.width = img.naturalWidth
        probe.height = img.naturalHeight
        const ctx = probe.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, probe.width, probe.height).data
        resolve({ img, map: buildLuminance(data, probe.width, probe.height, 6) })
      }
      img.onerror = () => {
        frames.delete(src)
        resolve(null)
      }
      img.src = src
    })
    frames.set(src, got)
  }
  return got
}

/** Адрес картинки кадра, окрашенного в `rgb` (0…255). null — красить нечем. */
export function paint(src: string, rgb: readonly number[]): Promise<string | null> {
  const key = `${src}|${rgb.join(',')}`
  let got = painted.get(key)
  if (!got) {
    got = (queue = queue.then(async () => {
      const frame = await frameOf(src)
      const p = painterOf()
      if (!frame || !p) return null
      p.canvas.width = frame.img.naturalWidth
      p.canvas.height = frame.img.naturalHeight
      const { map } = frame
      p.renderer.setGarment(frame.img, map.blurred, map.raw, map.width, map.height, map.white)
      p.renderer.setPrint(p.empty)
      p.renderer.setOccluder(p.empty)
      p.renderer.setLookup(null, 0, 0)
      p.renderer.setParams({ ...DEFAULT_PARAMS, base: [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255] })
      p.renderer.draw()
      const blob = await new Promise<Blob | null>((resolve) => p.canvas.toBlob(resolve, 'image/png'))
      return blob ? URL.createObjectURL(blob) : null
    })) as Promise<string | null>
    painted.set(key, got)
  }
  return got
}

export interface TintedFrameProps {
  /** Кадр — белая или однотонная база с прозрачным фоном. */
  src: string
  /** Цвет, 0…255 по каналу. Пусто — кадр как есть. */
  rgb: readonly number[] | null
  alt: string
  className?: string
}

export function TintedFrame({ src, rgb, alt, className }: TintedFrameProps) {
  const [url, setUrl] = useState<string | null>(null)
  const colour = rgb && rgb.length === 3 ? rgb.join(',') : null
  useEffect(() => {
    let alive = true
    setUrl(null)
    if (colour) {
      void paint(src, colour.split(',').map(Number)).then((got) => {
        if (alive) setUrl(got)
      })
    }
    return () => {
      alive = false
    }
  }, [src, colour])
  return <img src={url ?? src} alt={alt} className={className} draggable={false} />
}
