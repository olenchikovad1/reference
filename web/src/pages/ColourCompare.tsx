// «Сравнить цвета» (US-0500): тот же принт на двух–четырёх цветомоделях
// рядом, спереди и сзади, — чтобы выбрать, на какой худи он смотрится, не
// держа прошлый вид в памяти. На каждом цвете — своя проверка: принт, который
// на белой читается, а на чёрной пропадает, отмечен. Выбранные сохраняются
// референсами — по одному на цветомодель, одной командой.

import { Checkbox, buttonClass } from '@platform/ui'
import { useMemo, useRef, useState } from 'react'

import { GarmentCanvas } from '../candidates/GarmentCanvas'
import type { RenderParams } from '../candidates/renderer'
import type { Product } from '../shared/api/products'
import { frameUrl } from '../shared/api/products'
import type { Composition } from '../shared/composition'
import { lowContrast, type Rgb } from '../shared/contrast'
import { onSide } from '../shared/sides'
import type { Torso } from '../shared/torso'

export interface ColourChoice {
  code: string
  /** Как назвать человеку: «ЧЕРНЫЙ». */
  name: string
  rgb: Rgb
  /** Цветомодель этого изделия в этом цвете; нет — цвета нет в ассортименте. */
  colourModelId: number | null
}

const noop = () => undefined
const MAX = 4

export function ColourCompare({
  product,
  composition,
  calibration,
  torso,
  anchorsBySide,
  params,
  images,
  imagesVersion,
  choices,
  fromDrop,
  saving,
  onSave,
  onClose,
}: {
  product: Product
  composition: Composition
  calibration: Parameters<typeof GarmentCanvas>[0]['calibration']
  torso: Torso | null
  anchorsBySide: Record<string, Record<string, [number, number]>>
  params: RenderParams
  images: Map<string, HTMLImageElement>
  imagesVersion: number
  choices: ColourChoice[]
  /** Цвета — из ассортимента этого дропа; пусто — вся палитра. */
  fromDrop: string | null
  saving: boolean
  onSave: (picked: ColourChoice[], canvases: Record<string, Record<string, HTMLCanvasElement | null>>) => void
  onClose: () => void
}) {
  const [shown, setShown] = useState<string[]>(() => choices.slice(0, 3).map((c) => c.code))
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const canvases = useRef<Record<string, Record<string, HTMLCanvasElement | null>>>({})
  const sides = product.states.filter((s) => s.kind !== 'illustrative')

  // Средний цвет каждой картинки по непрозрачным точкам — для проверки
  // контраста. Картинка ещё не загрузилась — не проверяется.
  const imageRgb = useMemo(() => {
    const out = new Map<string, Rgb>()
    for (const el of composition.elements) {
      if (el.kind !== 'image' || out.has(el.src)) continue
      const img = images.get(el.src)
      if (!img?.complete || !img.naturalWidth) continue
      const c = document.createElement('canvas')
      c.width = 32
      c.height = 32
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) continue
      ctx.drawImage(img, 0, 0, 32, 32)
      const d = ctx.getImageData(0, 0, 32, 32).data
      let r = 0
      let g = 0
      let b = 0
      let w = 0
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255
        r += d[i] * a
        g += d[i + 1] * a
        b += d[i + 2] * a
        w += a
      }
      if (w > 0) out.set(el.src, [r / w, g / w, b / w])
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition, imagesVersion])

  const toggleShown = (code: string) =>
    setShown((s) => (s.includes(code) ? s.filter((c) => c !== code) : s.length < MAX ? [...s, code] : s))
  const setPick = (code: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s)
      if (on) next.add(code)
      else next.delete(code)
      return next
    })

  return (
    <div className="absolute inset-0 z-20 flex flex-col gap-2 overflow-auto bg-background p-3" role="region" aria-label="сравнение цветов">
      <div className="flex flex-wrap items-center gap-2">
        <strong>Сравнить цвета</strong>
        <span className="text-xs text-muted-foreground">
          {fromDrop ? `цвета из ассортимента «${fromDrop}»` : 'у референса нет дропа — вся палитра'} · рядом до {MAX}
        </span>
        <span className="flex-1" />
        <button
          className={buttonClass({ tone: 'accent', variant: 'solid', small: true })}
          disabled={picked.size === 0 || saving}
          onClick={() => onSave(choices.filter((c) => picked.has(c.code)), canvases.current)}
          title="По референсу на каждый выбранный цвет — одной командой"
        >
          {saving ? 'сохраняю…' : `сохранить выбранные (${picked.size})`}
        </button>
        <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={onClose} aria-label="закрыть сравнение">
          ×
        </button>
      </div>
      <div className="flex flex-wrap gap-1" aria-label="какие цвета показать">
        {choices.map((c) => (
          <button
            key={c.code}
            aria-pressed={shown.includes(c.code)}
            onClick={() => toggleShown(c.code)}
            className={buttonClass({
              tone: shown.includes(c.code) ? 'accent' : 'neutral',
              variant: shown.includes(c.code) ? 'soft' : 'outline',
              small: true,
            })}
          >
            <span className="mr-1 inline-block h-3 w-3 rounded-sm border border-line align-middle" style={{ background: `rgb(${c.rgb.join(',')})` }} />
            {c.name}
          </button>
        ))}
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, shown.length)}, minmax(0, 1fr))` }}>
        {choices
          .filter((c) => shown.includes(c.code))
          .map((c) => {
            const findings = lowContrast(composition, c.rgb, c.name, imageRgb)
            return (
              <section key={c.code} className="pf-card flex flex-col gap-2 border border-line p-2">
                <Checkbox
                  label={c.colourModelId ? c.name : `${c.name} · нет в ассортименте`}
                  checked={picked.has(c.code)}
                  onChange={(on) => setPick(c.code, on)}
                />
                <div className="grid grid-cols-2 gap-1">
                  {sides.map((s) => (
                    <div key={s.code} className="text-center text-[11px] text-muted-foreground">
                      {s.display_name}
                      <GarmentCanvas
                        preview
                        state={s}
                        frameSrc={frameUrl(product.code, s.code)}
                        calibration={calibration}
                        composition={onSide(composition, s.code)}
                        side={s.code}
                        torso={torso}
                        anchorsBySide={anchorsBySide}
                        params={{ ...params, base: [c.rgb[0] / 255, c.rgb[1] / 255, c.rgb[2] / 255] }}
                        renderScale={0.5}
                        showZones={false}
                        showAnchors={false}
                        onSelect={noop}
                        onMove={noop}
                        onResize={noop}
                        onRotate={noop}
                        images={images}
                        onCanvas={(el) => ((canvases.current[c.code] ??= {})[s.code] = el)}
                        key={`${c.code}-${s.code}-${imagesVersion}`}
                      />
                    </div>
                  ))}
                </div>
                {findings.length === 0 ? (
                  <p className="text-xs text-muted-foreground">читается</p>
                ) : (
                  findings.map((f) => (
                    <p key={f.elementId} className="rounded border-l-4 border-warning bg-tone-amber-soft px-2 py-1 text-xs">
                      {f.message}
                    </p>
                  ))
                )}
              </section>
            )
          })}
      </div>
    </div>
  )
}
