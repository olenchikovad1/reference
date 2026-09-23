import { useEffect, useMemo, useRef } from 'react'

import type { State } from '../shared/api/products'
import type { Composition, PrintElement } from '../shared/composition'
import { heightCm } from '../shared/composition'
import type { Calibration } from '../shared/geometry'
import { cmToPx } from '../shared/geometry'
import { buildLuminance } from '../shared/luminance'
import { rasterise } from '../shared/mask'
import { drawText } from '../shared/text'
import { createRenderer, type RenderParams, type Renderer } from './renderer'

// Холст изделия. В @platform/ui такого нет и не будет — это прикладное знание,
// а платформа его не содержит. Написан так, чтобы его можно было забрать: про
// наши домены не знает, получает кадр, калибровку и композицию.
//
// Разделение труда внутри: пиксели рисует WebGL, взаимодействие живёт на SVG
// поверх. Тянуть за угол в шейдере нечем, а рисовать складки в SVG — тем более.

export interface CanvasProps {
  readonly state: State
  readonly frameSrc: string
  readonly calibration: Calibration
  readonly composition: Composition
  readonly params: RenderParams
  /** Во сколько раз композиция рисуется крупнее кадра. */
  readonly renderScale: number
  readonly showZones: boolean
  readonly showAnchors: boolean
  readonly onSelect: (id: string | null) => void
  readonly onMove: (id: string, dxCm: number, dyCm: number) => void
  readonly onResize: (id: string, widthCm: number) => void
  readonly onRotate: (id: string, degrees: number) => void
  /** Сколько кадров в секунду выходит при перетаскивании. */
  readonly onFps?: (fps: number) => void
}

type Drag =
  | { kind: 'move'; id: string; startCm: [number, number]; from: [number, number] }
  | { kind: 'resize'; id: string; centre: [number, number] }
  | { kind: 'rotate'; id: string; centre: [number, number] }

export function GarmentCanvas(props: CanvasProps) {
  const { state, frameSrc, calibration, composition, renderScale } = props
  const glCanvas = useRef<HTMLCanvasElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const printCanvas = useRef<HTMLCanvasElement | null>(null)
  const occluderCanvas = useRef<HTMLCanvasElement | null>(null)
  const images = useRef(new Map<string, HTMLImageElement>())
  const drag = useRef<Drag | null>(null)
  // Скользящее окно последних отрисовок. Счёт за фиксированный промежуток врёт:
  // при редких перерисовках он делит одну отрисовку на секунды простоя и
  // показывает ноль, хотя рисуется мгновенно. А проверяется этим числом
  // критерий плавности перетаскивания, и врать ему нельзя.
  const frames = useRef<number[]>([])

  const W = Math.round(state.frame.width * renderScale)
  const H = Math.round(state.frame.height * renderScale)

  if (!printCanvas.current) printCanvas.current = document.createElement('canvas')
  if (!occluderCanvas.current) occluderCanvas.current = document.createElement('canvas')

  // Изделие: грузится и разбирается ОДИН раз на кадр. Оно не меняется, пока
  // двигают принт, и в этом вся скорость — при перетаскивании пересчитывается
  // только текстура принта.
  useEffect(() => {
    let alive = true
    const canvas = glCanvas.current
    if (!canvas) return
    if (!renderer.current) renderer.current = createRenderer(canvas)
    const r = renderer.current
    if (!r) return

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (!alive) return
      const probe = document.createElement('canvas')
      probe.width = img.naturalWidth
      probe.height = img.naturalHeight
      const ctx = probe.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, probe.width, probe.height).data
      const map = buildLuminance(data, probe.width, probe.height, 6)
      r.setGarment(img, map.blurred, map.raw, map.width, map.height, map.white)
      // Маска перекрытия считается один раз на состояние: зона не меняется,
      // пока не сменили кадр.
      const hood = state.zones.hood ?? []
      r.setOccluder(rasterise(hood, probe.width, probe.height, occluderCanvas.current ?? undefined))
      drawAll()
    }
    img.src = frameSrc
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameSrc, state.zones])

  /** Композиция принта в отдельный холст, потом текстурой в шейдер. */
  function drawPrint() {
    const c = printCanvas.current
    if (!c) return
    // Размер меняется только когда он ДЕЙСТВИТЕЛЬНО изменился: присваивание
    // width сбрасывает буфер холста целиком, и на 2160 пикселях это стоило
    // трети кадров — 24 в секунду вместо семидесяти. Проверено замером.
    if (c.width !== W || c.height !== H) {
      c.width = W
      c.height = H
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    for (const el of composition.elements) {
      const [cx, cy] = centreOf(el)
      const w = cmToPx(el.placement.widthCm, calibration) * renderScale
      const h = cmToPx(heightCm(el), calibration) * renderScale
      ctx.save()
      ctx.translate(cx * renderScale, cy * renderScale)
      ctx.rotate((el.placement.rotation * Math.PI) / 180)
      if (el.kind === 'text') {
        // Текст рисуется заново каждый раз, а не берётся картинкой из кэша:
        // в этом вся история — правка буквы не идёт через дизайнера.
        drawText(ctx, el, w)
      } else {
        const img = images.current.get(el.src)
        if (img?.complete) ctx.drawImage(img, -w / 2, -h / 2, w, h)
      }
      ctx.restore()
    }
  }

  function drawAll() {
    const r = renderer.current
    const canvas = glCanvas.current
    if (!r || !canvas || !printCanvas.current) return
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W
      canvas.height = H
    }
    drawPrint()
    r.setPrint(printCanvas.current)
    r.setParams(props.params)
    r.draw()

    const now = performance.now()
    // Горячая замена модулей сохраняет useRef между версиями кода. Если форма
    // хранимого изменилась, старое значение доживает до нового кода и роняет
    // его — а падение здесь обрывает отрисовку целиком, и выглядит это как
    // ошибка логики где-то совсем в другом месте. Издержка разработки, не
    // дефект, но ловить её каждый раз дороже, чем одна строка.
    if (!Array.isArray(frames.current)) frames.current = []
    const f = frames.current
    f.push(now)
    if (f.length > 24) f.shift()
    // Показываем только когда отрисовок было подряд несколько и последние из
    // них свежие: иначе это не «кадров в секунду», а «сколько прошло с прошлого
    // раза», и к плавности отношения не имеет.
    if (f.length >= 6 && now - f[0] < 2000) {
      props.onFps?.(Math.round(((f.length - 1) * 1000) / (now - f[0])))
    }
  }

  // Картинки элементов подгружаются один раз и живут в кэше: без него каждый
  // кадр перетаскивания заново декодировал бы принт.
  useEffect(() => {
    let pending = 0
    for (const el of composition.elements) {
      if (el.kind !== 'image') continue
      if (images.current.has(el.src)) continue
      const img = new Image()
      pending += 1
      img.onload = () => {
        pending -= 1
        if (pending === 0) drawAll()
      }
      img.src = el.src
      images.current.set(el.src, img)
    }
    drawAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition, props.params, renderScale, calibration])

  function toFrame(e: { clientX: number; clientY: number }): [number, number] {
    const el = svg.current
    if (!el) return [0, 0]
    const ctm = el.getScreenCTM()
    if (!ctm) return [0, 0]
    const p = el.createSVGPoint()
    p.x = e.clientX
    p.y = e.clientY
    const q = p.matrixTransform(ctm.inverse())
    return [q.x, q.y]
  }

  function centreOf(el: PrintElement): [number, number] {
    const a = state.anchors[el.placement.anchor] ?? [0, 0]
    return [
      a[0] + cmToPx(el.placement.dxCm, calibration),
      a[1] + cmToPx(el.placement.dyCm, calibration),
    ]
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const [x, y] = toFrame(e)
    if (d.kind === 'move') {
      props.onMove(
        d.id,
        d.startCm[0] + (x - d.from[0]) / calibration.pxPerCm,
        d.startCm[1] + (y - d.from[1]) / calibration.pxPerCm,
      )
    } else if (d.kind === 'resize') {
      props.onResize(d.id, Math.max(0.5, (Math.abs(x - d.centre[0]) * 2) / calibration.pxPerCm))
    } else {
      const deg = (Math.atan2(y - d.centre[1], x - d.centre[0]) * 180) / Math.PI + 90
      props.onRotate(d.id, Math.round(deg))
    }
  }

  const box = useMemo(
    () => ({ position: 'relative' as const, width: '100%', aspectRatio: '1 / 1' }),
    [],
  )

  return (
    <div style={box}>
      <canvas ref={glCanvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <svg
        ref={svg}
        viewBox={`0 0 ${state.frame.width} ${state.frame.height}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
        onPointerDown={(e) => {
          if (e.target === svg.current) props.onSelect(null)
        }}
      >
        {composition.elements.map((el) => {
          const [cx, cy] = centreOf(el)
          const w = cmToPx(el.placement.widthCm, calibration)
          const h = cmToPx(heightCm(el), calibration)
          const selected = el.id === composition.selectedId
          return (
            <g key={el.id} transform={`rotate(${el.placement.rotation} ${cx} ${cy})`}>
              {/* Прозрачная накладка: рисует шейдер, ловит события она. */}
              <rect
                x={cx - w / 2}
                y={cy - h / 2}
                width={w}
                height={h}
                fill="transparent"
                style={{ cursor: 'move' }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  props.onSelect(el.id)
                  drag.current = {
                    kind: 'move',
                    id: el.id,
                    startCm: [el.placement.dxCm, el.placement.dyCm],
                    from: toFrame(e),
                  }
                }}
              />
              {selected && (
                <>
                  <rect
                    x={cx - w / 2}
                    y={cy - h / 2}
                    width={w}
                    height={h}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={2}
                    pointerEvents="none"
                  />
                  <circle
                    cx={cx + w / 2}
                    cy={cy + h / 2}
                    r={9}
                    fill="#2563eb"
                    style={{ cursor: 'nwse-resize' }}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.currentTarget.setPointerCapture(e.pointerId)
                      drag.current = { kind: 'resize', id: el.id, centre: [cx, cy] }
                    }}
                  />
                  <line
                    x1={cx}
                    y1={cy - h / 2}
                    x2={cx}
                    y2={cy - h / 2 - 26}
                    stroke="#16a34a"
                    strokeWidth={2}
                    pointerEvents="none"
                  />
                  <circle
                    cx={cx}
                    cy={cy - h / 2 - 26}
                    r={9}
                    fill="#16a34a"
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.currentTarget.setPointerCapture(e.pointerId)
                      drag.current = { kind: 'rotate', id: el.id, centre: [cx, cy] }
                    }}
                  />
                </>
              )}
            </g>
          )
        })}

        {props.showZones && <Zones state={state} />}
        {props.showAnchors && <Anchors state={state} />}
      </svg>
    </div>
  )
}

function Zones({ state }: { state: State }) {
  const paint: Record<string, string> = { print: '#3b82f6', hood: '#f97316', pocket: '#a855f7' }
  return (
    <g pointerEvents="none">
      {Object.entries(state.zones).map(([name, points]) => (
        <polygon
          key={name}
          points={points.map(([x, y]) => `${x},${y}`).join(' ')}
          fill="none"
          stroke={paint[name] ?? '#94a3b8'}
          strokeWidth={2}
          strokeDasharray={name === 'print' ? undefined : '6 4'}
        />
      ))}
      {Object.entries(state.lines).map(([name, pts]) =>
        pts.length >= 2 ? (
          <line
            key={name}
            x1={pts[0][0]}
            y1={pts[0][1]}
            x2={pts[1][0]}
            y2={pts[1][1]}
            stroke="#ef4444"
            strokeWidth={3}
          />
        ) : null,
      )}
    </g>
  )
}

function Anchors({ state }: { state: State }) {
  return (
    <g pointerEvents="none">
      {Object.entries(state.anchors).map(([name, [x, y]]) => (
        <g key={name}>
          <circle cx={x} cy={y} r={7} fill="#111" fillOpacity={0.7} />
          <circle cx={x} cy={y} r={3} fill="#fff" />
          <text x={x + 12} y={y + 5} fontSize={15} fill="#111">
            {name}
          </text>
        </g>
      ))}
    </g>
  )
}
