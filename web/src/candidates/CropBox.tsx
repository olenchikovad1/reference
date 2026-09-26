// Рамка обрезки над исходником (US-0504): протянуть рамку — сдвинуть кусок,
// за угол — растянуть; стрелки двигают, Shift со стрелками тянет. Рамка — в
// долях исходника, результат сразу на изделии. Кандидат в набор платформы
// (решение 0005): рамки обрезки в @platform/ui нет.

import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

import { clampCrop, shapePoints, type Crop } from '../shared/look'

type Drag = { kind: 'move' | 'nw' | 'ne' | 'sw' | 'se'; from: Crop; px: number; py: number }

export function CropBox({
  src,
  sourceAspect,
  crop,
  onChange,
}: {
  src: string
  /** Пропорция исходника целиком: рамка меряется в его долях. */
  sourceAspect: number
  crop: Crop
  /** `done` — действие рукой закончилось: шаг истории, а не каждое движение. */
  onChange: (crop: Crop, done: boolean) => void
}) {
  const box = useRef<HTMLDivElement | null>(null)
  const drag = useRef<Drag | null>(null)
  // Последняя рамка — в ref: повтор клавиши быстрее отрисовки, и из свойства
  // каждое нажатие считалось бы от одной и той же рамки.
  const latest = useRef(crop)
  latest.current = crop

  function start(kind: Drag['kind'], e: PointerEvent) {
    e.stopPropagation()
    e.preventDefault()
    drag.current = { kind, from: crop, px: e.clientX, py: e.clientY }
    box.current?.setPointerCapture(e.pointerId)
  }

  function move(e: PointerEvent) {
    const d = drag.current
    const r = box.current?.getBoundingClientRect()
    if (!d || !r) return
    const dx = (e.clientX - d.px) / r.width
    const dy = (e.clientY - d.py) / r.height
    const f = d.from
    const next =
      d.kind === 'move'
        ? { ...f, x: f.x + dx, y: f.y + dy }
        : {
            ...f,
            x: d.kind === 'nw' || d.kind === 'sw' ? f.x + dx : f.x,
            y: d.kind === 'nw' || d.kind === 'ne' ? f.y + dy : f.y,
            w: d.kind === 'nw' || d.kind === 'sw' ? f.w - dx : f.w + dx,
            h: d.kind === 'nw' || d.kind === 'ne' ? f.h - dy : f.h + dy,
          }
    onChange(clampCrop(next), false)
  }

  function end() {
    if (drag.current) onChange(crop, true)
    drag.current = null
  }

  function onKey(e: KeyboardEvent) {
    const step = 0.01
    const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (!(e.key in by)) return
    e.preventDefault()
    const [dx, dy] = by[e.key]
    const c = latest.current
    const next = clampCrop(e.shiftKey ? { ...c, w: c.w + dx, h: c.h + dy } : { ...c, x: c.x + dx, y: c.y + dy })
    latest.current = next
    onChange(next, true)
  }

  const pts = shapePoints(crop.shape)
  const corner = 'absolute h-3 w-3 rounded-full border border-background bg-primary'
  return (
    <div
      data-own-keys
      ref={box}
      className="relative w-full select-none overflow-hidden rounded bg-muted"
      style={{ aspectRatio: String(sourceAspect), touchAction: 'none' }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <img src={src} alt="" className="absolute inset-0 h-full w-full object-fill opacity-50" draggable={false} />
      <div
        tabIndex={0}
        role="group"
        aria-label="рамка обрезки: стрелки — сдвиг, Shift со стрелками — размер"
        onKeyDown={onKey}
        onPointerDown={(e) => start('move', e)}
        className="absolute cursor-move outline-none ring-2 ring-primary focus-visible:ring-4"
        style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {crop.shape === 'ellipse' && <ellipse cx="50" cy="50" rx="50" ry="50" fill="none" stroke="currentColor" strokeDasharray="3 2" />}
          {pts && (
            <polygon points={pts.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')} fill="none" stroke="currentColor" strokeDasharray="3 2" />
          )}
        </svg>
        {(['nw', 'ne', 'sw', 'se'] as const).map((k) => (
          <span
            key={k}
            onPointerDown={(e) => start(k, e)}
            className={corner}
            style={{
              left: k.endsWith('w') ? -6 : undefined,
              right: k.endsWith('e') ? -6 : undefined,
              top: k.startsWith('n') ? -6 : undefined,
              bottom: k.startsWith('s') ? -6 : undefined,
              cursor: k === 'nw' || k === 'se' ? 'nwse-resize' : 'nesw-resize',
            }}
          />
        ))}
      </div>
    </div>
  )
}
