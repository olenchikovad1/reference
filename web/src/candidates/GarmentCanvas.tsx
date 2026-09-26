import { useEffect, useMemo, useRef } from 'react'

import type { State } from '../shared/api/products'
import type { Composition, PrintElement } from '../shared/composition'
import type { Polygon } from '../shared/mask'
import { heightCm } from '../shared/composition'
import type { Calibration } from '../shared/geometry'
import { cmToPx } from '../shared/geometry'
import { buildLuminance } from '../shared/luminance'
import { drawLooked } from '../shared/look'
import type { Clips } from '../shared/sheet'

/** Кадр изделия и его карта рельефа — по адресу кадра, один раз на вкладку.
 *  Изделие на всех карточках одно и то же (худи — везде худи): грузить и
 *  разбирать его заново при каждом открытии окна и для каждой миниатюры
 *  незачем — меняются только цвет и принт (правка владельца 25.09). */
const garments = new Map<string, Promise<{ img: HTMLImageElement; map: ReturnType<typeof buildLuminance> } | null>>()

function garmentOf(src: string) {
  let got = garments.get(src)
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
      // Не загрузился — забываем, чтобы следующее открытие попробовало снова.
      img.onerror = () => {
        garments.delete(src)
        resolve(null)
      }
      img.src = src
    })
    garments.set(src, got)
  }
  return got
}

/** Прогреть кадры заранее — витрина зовёт это, пока человек выбирает карточку. */
export function warmGarments(srcs: string[]): void {
  for (const s of srcs) void garmentOf(s)
}
import { drawText } from '../shared/text'
import {
  anchorOnSurface,
  buildLookup,
  halfGirth,
  projectLocal,
  projectRect,
  seamArc,
  toSurface,
  type Panel,
  type Torso,
} from '../shared/torso'
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
  /** ВСЯ композиция, всех сторон: на боку видны и перед, и спина. Рамки
   *  рисуются только у элементов текущей стороны — см. side. */
  readonly composition: Composition
  /** Сторона, чьи элементы можно двигать на этом кадре. */
  readonly side: string
  /** Объём торса. Нет — принт лежит плоско, как раньше. */
  readonly torso?: Torso | null
  /** Ориентиры каждой стороны на её собственном кадре: элемент со спины
   *  привязан к ориентиру спины, даже когда его показывают на боку. */
  readonly anchorsBySide?: Readonly<Record<string, Record<string, [number, number]>>>
  readonly params: RenderParams
  /** Во сколько раз композиция рисуется крупнее кадра. */
  readonly renderScale: number
  readonly showZones: boolean
  /** Печатное поле выбранного размера. Есть — рисуется ВМЕСТО зоны печати:
   *  зона нарисована для отрисованного изделия, а печатают на выбранном. */
  readonly field?: Polygon | null
  readonly fieldLabel?: string | null
  /** Масштаб зоны опущенного капюшона на выбранном размере — от горловины. */
  readonly hoodDownScale?: number
  readonly showAnchors: boolean
  readonly onSelect: (id: string | null) => void
  readonly onMove: (id: string, dxCm: number, dyCm: number) => void
  readonly onResize: (id: string, widthCm: number) => void
  readonly onRotate: (id: string, degrees: number) => void
  /** Действие руками закончилось: тянуть перестали. Отсюда берётся шаг
   *  истории — одно движение мышкой отменяется одним нажатием. */
  /** Загруженные картинки элементов. Кэш общий со страницей: лист печати
   *  собирается там, и вторая копия того же кэша не нужна. */
  readonly images: ReadonlyMap<string, HTMLImageElement>
  /** Обрезка по разметке изделия (US-0505): контуры в см от ориентира
   *  элемента. Нет контура — элемент целиком. */
  readonly clips?: Clips
  /** Полотно отдаётся наружу, чтобы с него можно было снять картинку.
   *  Снимок — то же, что видит человек, а не пересборка похожего. */
  readonly onCanvas?: (canvas: HTMLCanvasElement | null) => void
  readonly onCommit?: () => void
  /** Сколько кадров в секунду выходит при перетаскивании. */
  readonly onFps?: (fps: number) => void
  /** Только показ: ни рамок, ни ручек, ни зон — миниатюра стороны. Нажатие
   *  проходит насквозь, к тому, в чём миниатюра лежит. */
  readonly preview?: boolean
}

type Drag =
  | { kind: 'move'; id: string; startCm: [number, number]; from: [number, number] }
  | { kind: 'resize'; id: string; centre: [number, number] }
  | { kind: 'rotate'; id: string; centre: [number, number] }
  // По ткани: точка, за которую взялись, в сантиметрах ткани. Сдвиг считается
  // там же — иначе у края торса принт ехал бы быстрее руки.
  | { kind: 'move-fabric'; id: string; startCm: [number, number]; from: { u: number; h: number } }
  | { kind: 'resize-fabric'; id: string; centre: { u: number; h: number }; rotation: number }
  | { kind: 'rotate-fabric'; id: string; centre: { u: number; h: number } }

export function GarmentCanvas(props: CanvasProps) {
  const { state, frameSrc, calibration, composition, renderScale } = props
  const glCanvas = useRef<HTMLCanvasElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const printCanvas = useRef<HTMLCanvasElement | null>(null)
  const occluderCanvas = useRef<HTMLCanvasElement | null>(null)
  const panels = useRef<Record<Panel, HTMLCanvasElement> | null>(null)
  const lookupBuffer = useRef<Float32Array | undefined>(undefined)
  // Что сейчас лежит в каждой развёртке. Совпало — развёртка не
  // перерисовывается и не грузится: при перетаскивании меняется одна деталь,
  // а две по полтора миллиона пикселей на кадр роняли плавность втрое.
  const panelDrawn = useRef<Record<Panel, string>>({ front: '', back: '' })
  const drag = useRef<Drag | null>(null)
  // Скользящее окно последних отрисовок. Счёт за фиксированный промежуток врёт:
  // при редких перерисовках он делит одну отрисовку на секунды простоя и
  // показывает ноль, хотя рисуется мгновенно. А проверяется этим числом
  // критерий плавности перетаскивания, и врать ему нельзя.
  const frames = useRef<number[]>([])

  // Своя сторона: её элементы можно трогать на этом кадре. Остальные
  // только видны — через объём.
  const own = useMemo(
    () => ({
      ...composition,
      elements: composition.elements.filter((el) => (el.placement.side ?? 'front') === props.side),
    }),
    [composition, props.side],
  )

  const W = Math.round(state.frame.width * renderScale)
  const H = Math.round(state.frame.height * renderScale)

  if (!printCanvas.current) printCanvas.current = document.createElement('canvas')
  if (!occluderCanvas.current) occluderCanvas.current = document.createElement('canvas')
  if (!panels.current) {
    panels.current = { front: document.createElement('canvas'), back: document.createElement('canvas') }
  }
  const torso = props.torso ?? null
  // Объём есть не у каждого ракурса: у изделия без модели торса или у
  // кадра, которого модель не знает, показ остаётся плоским.
  const wrapped = !!torso && !!torso.views[state.code]

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

    void garmentOf(frameSrc).then((g) => {
      if (!alive || !g) return
      const { img, map } = g
      const probe = { width: img.naturalWidth, height: img.naturalHeight }
      r.setGarment(img, map.blurred, map.raw, map.width, map.height, map.white)
      // Маска перекрытия считается один раз на состояние: зона не меняется,
      // пока не сменили кадр.
      // Всё, что лежит ПОВЕРХ торса: капюшон на спине, рукав на боку. Рукав
      // висит перед торсом и закрывает его почти во всю глубину, и без него
      // принт со спины рисовался бы там, где его на изделии не видно.
      const covers = OCCLUDERS.map((name) => state.zones[name]).filter((z): z is [number, number][] => !!z)
      r.setOccluder(rasteriseAll(covers, probe.width, probe.height, occluderCanvas.current ?? undefined))
      drawAll()
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameSrc, state.zones])

  /** Размер развёрток: половина обхвата по ткани и высота кадра над низом. */
  const surface = useMemo(() => {
    if (!torso) return null
    let halfU = 0
    for (let h = 0; h <= 70; h += 5) halfU = Math.max(halfU, halfGirth(torso, h))
    const heightCm =
      Math.max(...Object.values(torso.views).map((v) => v.hemY)) / torso.ppc
    return { halfU: Math.ceil(halfU), heightCm: Math.ceil(heightCm) }
  }, [torso])

  /** Принт на ткани: по развёртке на деталь, в сантиметрах по ткани.
   *
   * Смещение элемента — длина по ткани от ориентира его стороны, поэтому
   * рисуется он здесь без всякой перспективы, как на лекале. Изгиб даёт
   * карта, а не рисование: иначе каждый ракурс гнул бы принт по-своему. */
  function drawPanels(r: Renderer) {
    const pc = panels.current
    if (!pc || !torso || !surface) return
    const k = torso.ppc * renderScale
    const w = Math.round(surface.halfU * 2 * k)
    const h = Math.round(surface.heightCm * k)
    r.setSurface(surface.halfU, surface.heightCm)
    for (const panel of ['front', 'back'] as const) {
      const mine = composition.elements.filter((el) => (el.placement.side ?? 'front') === panel)
      const loaded = mine.map((el) => (el.kind === 'image' ? props.images.get(el.src)?.complete : true))
      const cuts = mine.map((el) => props.clips?.get(el.id) ?? null)
      const sig = JSON.stringify([w, h, surface, mine, loaded, props.anchorsBySide?.[panel], cuts])
      if (panelDrawn.current[panel] === sig) continue
      panelDrawn.current[panel] = sig
      const c = pc[panel]
      if (c.width !== w || c.height !== h) {
        c.width = w
        c.height = h
      }
      const ctx = c.getContext('2d')
      if (!ctx) continue
      ctx.clearRect(0, 0, w, h)
      const anchors = props.anchorsBySide?.[panel] ?? {}
      // За боковым швом детали нет — и рисовать там нечего. Показ, огибающий
      // бок дальше шва, обещал бы то, чего не напечатают. Граница не прямая:
      // глубина торса меняется, и до шва на уровне груди ближе, чем у низа.
      ctx.save()
      ctx.beginPath()
      for (let hh = 0; hh <= surface.heightCm; hh += 2) {
        ctx.lineTo((surface.halfU + seamArc(torso, panel, hh)) * k, (surface.heightCm - hh) * k)
      }
      for (let hh = surface.heightCm; hh >= 0; hh -= 2) {
        ctx.lineTo((surface.halfU - seamArc(torso, panel, hh)) * k, (surface.heightCm - hh) * k)
      }
      ctx.closePath()
      ctx.clip()
      for (const el of composition.elements) {
        if ((el.placement.side ?? 'front') !== panel) continue
        const a = anchorOnSurface(torso, panel, anchors[el.placement.anchor] ?? [0, 0])
        const u = a.u + el.placement.dxCm
        const hh = a.h - el.placement.dyCm
        const ew = el.placement.widthCm * k
        const eh = heightCm(el) * k
        ctx.save()
        const cut = props.clips?.get(el.id)
        if (cut && cut.length >= 3) {
          // Контур от ориентира, а не от элемента: граница стоит на изделии.
          ctx.beginPath()
          cut.forEach(([cx, cy], i) => {
            const x = (a.u + cx + surface.halfU) * k
            const y = (surface.heightCm - (a.h - cy)) * k
            if (i) ctx.lineTo(x, y)
            else ctx.moveTo(x, y)
          })
          ctx.closePath()
          ctx.clip()
        }
        ctx.translate((u + surface.halfU) * k, (surface.heightCm - hh) * k)
        ctx.rotate((el.placement.rotation * Math.PI) / 180)
        if (el.kind === 'text') drawText(ctx, el, ew)
        else {
          const img = props.images.get(el.src)
          if (img?.complete) drawLooked(ctx, img, el.look, -ew / 2, -eh / 2, ew, eh)
        }
        ctx.restore()
      }
      ctx.restore()
      r.setPanel(panel, c)
    }
  }

  // Карта «пиксель → ткань» — раз на ракурс, размер и приближение, а не на
  // каждое движение: при перетаскивании меняется принт, а не изделие.
  useEffect(() => {
    const r = renderer.current
    if (!r) return
    if (!wrapped || !torso) {
      r.setLookup(null, 0, 0)
      return
    }
    lookupBuffer.current = buildLookup(torso, state.code, W, H, renderScale, lookupBuffer.current)
    r.setLookup(lookupBuffer.current, W, H)
    drawAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [torso, state.code, W, H, renderScale, wrapped])

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
    for (const el of own.elements) {
      const [cx, cy] = centreOf(el)
      const w = cmToPx(el.placement.widthCm, calibration) * renderScale
      const h = cmToPx(heightCm(el), calibration) * renderScale
      ctx.save()
      const cut = props.clips?.get(el.id)
      if (cut && cut.length >= 3) {
        // Ориентир на кадре — центр элемента минус его смещение.
        const ax = cx - cmToPx(el.placement.dxCm, calibration)
        const ay = cy - cmToPx(el.placement.dyCm, calibration)
        ctx.beginPath()
        cut.forEach(([px, py], i) => {
          const x = (ax + cmToPx(px, calibration)) * renderScale
          const y = (ay + cmToPx(py, calibration)) * renderScale
          if (i) ctx.lineTo(x, y)
          else ctx.moveTo(x, y)
        })
        ctx.closePath()
        ctx.clip()
      }
      ctx.translate(cx * renderScale, cy * renderScale)
      ctx.rotate((el.placement.rotation * Math.PI) / 180)
      if (el.kind === 'text') {
        // Текст рисуется заново каждый раз, а не берётся картинкой из кэша:
        // в этом вся история — правка буквы не идёт через дизайнера.
        drawText(ctx, el, w)
      } else {
        const img = props.images.get(el.src)
        if (img?.complete) drawLooked(ctx, img, el.look, -w / 2, -h / 2, w, h)
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
    if (wrapped && surface && panels.current) {
      drawPanels(r)
    } else {
      drawPrint()
      r.setPrint(printCanvas.current)
    }
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

  useEffect(() => {
    drawAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition, props.params, renderScale, calibration, props.images, surface, props.clips])

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

  /** Своя сторона кадра — деталь, если на ней есть объём. */
  const panel: Panel | null =
    wrapped && (props.side === 'front' || props.side === 'back') ? props.side : null

  function fabricCentre(el: PrintElement): { u: number; h: number } | null {
    if (!torso || !panel) return null
    const a = anchorOnSurface(torso, panel, props.anchorsBySide?.[panel]?.[el.placement.anchor] ?? [0, 0])
    return { u: a.u + el.placement.dxCm, h: a.h - el.placement.dyCm }
  }

  function fabricAt(x: number, y: number): { u: number; h: number } | null {
    if (!torso || !panel) return null
    const s = toSurface(torso, state.code, x, y)
    if (!s) return null
    return { u: panel === 'front' ? s.uFront : s.uBack, h: s.h }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const [x, y] = toFrame(e)
    if (d.kind === 'move-fabric' || d.kind === 'resize-fabric' || d.kind === 'rotate-fabric') {
      // Указатель ушёл с торса — последнее положение остаётся. Прыжок принта
      // вслед за рукой по фону хуже, чем пауза.
      const f = fabricAt(x, y)
      if (!f) return
      if (d.kind === 'move-fabric') {
        props.onMove(d.id, d.startCm[0] + (f.u - d.from.u), d.startCm[1] - (f.h - d.from.h))
      } else if (d.kind === 'resize-fabric') {
        const r = (d.rotation * Math.PI) / 180
        const du = f.u - d.centre.u
        const dv = d.centre.h - f.h
        const lx = du * Math.cos(r) + dv * Math.sin(r)
        props.onResize(d.id, Math.max(0.5, Math.abs(lx) * 2))
      } else {
        const deg = (Math.atan2(d.centre.h - f.h, f.u - d.centre.u) * 180) / Math.PI + 90
        props.onRotate(d.id, Math.round(deg))
      }
      return
    }
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

  /** Рамка элемента по ткани: контур и ручки проходят через ту же модель,
   *  что и принт, и совпадают с ним у края, а не только в середине. */
  function fabricHandles(el: PrintElement, fc: { u: number; h: number }, t: Torso, pn: Panel) {
    const w = el.placement.widthCm
    const h = heightCm(el)
    const rot = el.placement.rotation
    const outline = projectRect(t, state.code, pn, fc, w, h, rot)
    if (outline.length < 3) return null
    const points = outline.map(([x, y]) => `${x},${y}`).join(' ')
    const selected = el.id === composition.selectedId
    const corner = projectLocal(t, state.code, pn, fc, w / 2, h / 2, rot)
    const top = projectLocal(t, state.code, pn, fc, 0, -h / 2, rot)
    return (
      <g key={el.id}>
        <polygon
          points={points}
          fill="transparent"
          style={{ cursor: 'move' }}
          onPointerDown={(e) => {
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            props.onSelect(el.id)
            const [x, y] = toFrame(e)
            const from = fabricAt(x, y) ?? fc
            drag.current = {
              kind: 'move-fabric',
              id: el.id,
              startCm: [el.placement.dxCm, el.placement.dyCm],
              from,
            }
          }}
        />
        {selected && (
          <>
            <polygon points={points} fill="none" stroke="#2563eb" strokeWidth={2} pointerEvents="none" />
            {corner?.visible && (
              <circle
                cx={corner.x}
                cy={corner.y}
                r={9}
                fill="#2563eb"
                style={{ cursor: 'nwse-resize' }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  drag.current = { kind: 'resize-fabric', id: el.id, centre: fc, rotation: rot }
                }}
              />
            )}
            {top?.visible && (
              <>
                <line x1={top.x} y1={top.y} x2={top.x} y2={top.y - 26} stroke="#16a34a" strokeWidth={2} pointerEvents="none" />
                <circle
                  cx={top.x}
                  cy={top.y - 26}
                  r={8}
                  fill="#16a34a"
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    e.currentTarget.setPointerCapture(e.pointerId)
                    drag.current = { kind: 'rotate-fabric', id: el.id, centre: fc }
                  }}
                />
              </>
            )}
          </>
        )}
      </g>
    )
  }

  const box = useMemo(
    () => ({ position: 'relative' as const, width: '100%', aspectRatio: '1 / 1' }),
    [],
  )

  return (
    <div style={box}>
      <canvas
        ref={(el) => {
          glCanvas.current = el
          props.onCanvas?.(el)
        }}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {!props.preview && (
      <svg
        ref={svg}
        viewBox={`0 0 ${state.frame.width} ${state.frame.height}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          if (drag.current) props.onCommit?.()
          drag.current = null
        }}
        onPointerLeave={() => {
          if (drag.current) props.onCommit?.()
          drag.current = null
        }}
        onPointerDown={(e) => {
          if (e.target === svg.current) props.onSelect(null)
        }}
      >
        {own.elements.map((el) => {
          const fc = fabricCentre(el)
          if (fc && torso && panel) return fabricHandles(el, fc, torso, panel)
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

        {props.showZones && (
          <Zones state={state} field={props.field ?? null} fieldLabel={props.fieldLabel ?? null} hoodDownScale={props.hoodDownScale ?? 1} />
        )}
        {props.showAnchors && <Anchors state={state} />}
      </svg>
      )}
    </div>
  )
}

function Zones({
  state,
  field,
  fieldLabel,
  hoodDownScale,
}: {
  state: State
  field: Polygon | null
  fieldLabel: string | null
  hoodDownScale: number
}) {
  // Опущенный капюшон — отдельным цветом от надетого: это два разных положения,
  // и путать их нельзя (US-0519).
  const paint: Record<string, string> = { print: '#3b82f6', hood: '#f97316', pocket: '#a855f7', hood_down: '#dc2626' }
  // Два контура печати сразу — зона кадра и поле размера — читаются как
  // два разных правила. Правило одно: при выбранном размере это поле.
  const neck = state.anchors.neck
  const zones = Object.entries(state.zones)
    .filter(([name]) => !(field && name === 'print'))
    // Зона опущенного капюшона — на выбранном размере, как и в проверке.
    .map(([name, points]) =>
      name === 'hood_down' && neck
        ? ([name, points.map(([x, y]) => [neck[0] + (x - neck[0]) * hoodDownScale, neck[1] + (y - neck[1]) * hoodDownScale])] as const)
        : ([name, points] as const),
    )
  return (
    <g pointerEvents="none">
      {field && (
        <g>
          <polygon
            points={field.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke="#2563eb"
            strokeWidth={2}
            strokeDasharray="8 5"
          />
          {fieldLabel && (
            <text x={field[0][0] + 4} y={field[0][1] - 6} fontSize={14} fill="#2563eb">
              {fieldLabel}
            </text>
          )}
        </g>
      )}
      {zones.map(([name, points]) => (
        <g key={name}>
          <polygon
            points={points.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke={paint[name] ?? '#94a3b8'}
            strokeWidth={2}
            strokeDasharray={name === 'print' ? undefined : name === 'hood_down' ? '2 4' : '6 4'}
          />
          {name === 'hood_down' && (
            // Подпись у нижнего края: граница расчётная, и это должно быть видно.
            <text
              x={Math.min(...points.map((q) => q[0]))}
              y={Math.max(...points.map((q) => q[1])) + 14}
              fontSize={12}
              fill={paint.hood_down}
            >
              опущенный капюшон · расчётно
            </text>
          )}
        </g>
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

/** Что лежит поверх торса и закрывает принт. */
const OCCLUDERS = ['hood', 'sleeve']

function rasteriseAll(
  polys: readonly (readonly [number, number])[][],
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
  ctx.fillStyle = '#fff'
  for (const poly of polys) {
    if (poly.length < 3) continue
    ctx.beginPath()
    ctx.moveTo(poly[0][0], poly[0][1])
    for (const [x, y] of poly.slice(1)) ctx.lineTo(x, y)
    ctx.closePath()
    ctx.fill()
  }
  return c
}
