import { useRef } from 'react'

import type { Calibration } from '../shared/geometry'
import { cmToPx } from '../shared/geometry'
import type { Composition, PrintElement } from '../shared/composition'
import { heightCm } from '../shared/composition'
import type { State } from '../shared/api/products'

// Холст изделия. В @platform/ui такого нет и не будет — это прикладное знание,
// а платформа его не содержит. Значит место ему здесь, среди кандидатов, и
// написан он так, чтобы его можно было забрать: про наши домены не знает,
// получает кадр, калибровку и композицию, отдаёт наружу события.

export interface CanvasProps {
  readonly state: State
  readonly frameSrc: string
  readonly calibration: Calibration
  readonly composition: Composition
  readonly showZones: boolean
  readonly showAnchors: boolean
  readonly onSelect: (id: string | null) => void
  /** Смещение в сантиметрах — холст не знает, что с ним сделают. */
  readonly onMove: (id: string, dxCm: number, dyCm: number) => void
  readonly onResize: (id: string, widthCm: number) => void
  readonly onRotate: (id: string, degrees: number) => void
}

type Drag =
  | { kind: 'move'; id: string; startCm: [number, number]; from: [number, number] }
  | { kind: 'resize'; id: string; startWidthCm: number; centre: [number, number] }
  | { kind: 'rotate'; id: string; centre: [number, number] }

export function GarmentCanvas(props: CanvasProps) {
  const { state, frameSrc, calibration, composition, showZones, showAnchors } = props
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)

  /** Экранные координаты события в координаты кадра. */
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
      // Ширина — вдвое больше расстояния от центра до угла по горизонтали:
      // тянут за угол, а растёт вся ширина.
      const widthCm = Math.max(0.5, (Math.abs(x - d.centre[0]) * 2) / calibration.pxPerCm)
      props.onResize(d.id, widthCm)
    } else {
      const deg = (Math.atan2(y - d.centre[1], x - d.centre[0]) * 180) / Math.PI + 90
      props.onRotate(d.id, Math.round(deg))
    }
  }

  function stop() {
    // Захват указателя браузер снимает сам на pointerup — держать его руками
    // значит держать и ошибку, когда указатель ушёл мимо элемента.
    drag.current = null
  }

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${state.frame.width} ${state.frame.height}`}
      style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerDown={(e) => {
        if (e.target === svg.current) props.onSelect(null)
      }}
    >
      <image href={frameSrc} width={state.frame.width} height={state.frame.height} />

      {composition.elements.map((el) => {
        const [cx, cy] = centreOf(el)
        const w = cmToPx(el.placement.widthCm, calibration)
        const h = cmToPx(heightCm(el), calibration)
        const selected = el.id === composition.selectedId
        return (
          <g key={el.id} transform={`rotate(${el.placement.rotation} ${cx} ${cy})`}>
            <image
              href={el.src}
              x={cx - w / 2}
              y={cy - h / 2}
              width={w}
              height={h}
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
                    drag.current = {
                      kind: 'resize',
                      id: el.id,
                      startWidthCm: el.placement.widthCm,
                      centre: [cx, cy],
                    }
                  }}
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
                <line
                  x1={cx}
                  y1={cy - h / 2}
                  x2={cx}
                  y2={cy - h / 2 - 26}
                  stroke="#16a34a"
                  strokeWidth={2}
                  pointerEvents="none"
                />
              </>
            )}
          </g>
        )
      })}

      {showZones && <Zones state={state} />}
      {showAnchors && <Anchors state={state} />}
    </svg>
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
