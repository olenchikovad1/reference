// Примерка принта на изделиях дропа без сохранения (US-0892): сетка
// «модель × цвет», принт по умолчанию (от горловины 12 см, 18 см шириной).
// «Сделать референс» заводит семейство и открывает окно.

import { Select, buttonClass } from '@platform/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { assetUrl } from '../shared/api/assets'
import { fetchPalette, toCss, toUnit } from '../shared/api/colours'
import { fetchDrops, fetchMatrix, type Matrix } from '../shared/api/drops'
import { frameUrl, productQuery } from '../shared/api/products'
import { saveReference } from '../shared/api/references'
import { EMPTY, type Composition } from '../shared/composition'
import { calibrationFor } from '../shared/fields'
import { GarmentCanvas } from './GarmentCanvas'
import { warmGarments } from './GarmentCanvas'
import { DEFAULT_PARAMS } from './renderer'

type Row = Matrix['rows'][number]

function defaultComposition(src: string, name: string): Composition {
  return {
    ...EMPTY,
    elements: [
      {
        id: 'try-on',
        kind: 'image',
        name,
        src,
        aspect: 1,
        hasAlpha: true,
        placement: { side: 'front', anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 18, rotation: 0 },
      },
    ],
  }
}

export function TryOn({ digest, name, onClose }: { digest: string; name: string; onClose: () => void }) {
  const navigate = useNavigate()
  const drops = useQuery({ queryKey: ['drops'], queryFn: fetchDrops })
  const palette = useQuery({ queryKey: ['palette'], queryFn: fetchPalette })
  const active = (drops.data ?? []).filter((d) => !d.retired)
  const [dropId, setDropId] = useState<number | null>(null)
  useEffect(() => {
    if (dropId === null && active[0]) setDropId(active[0].id)
  }, [active, dropId])
  const matrix = useQuery({
    queryKey: ['drops', dropId, 'matrix'],
    queryFn: () => fetchMatrix(dropId!),
    enabled: dropId != null,
  })
  const rows = useMemo(() => (matrix.data?.rows ?? []).filter((r) => r.model.can_work), [matrix.data])
  const [picked, setPicked] = useState<{ row: Row; colour: string; colourModelId: number } | null>(null)
  const product = useQuery({
    ...productQuery(picked?.row.model.code ?? 'B-HDY-14'),
    enabled: Boolean(picked?.row.model.code),
  })
  const [saving, setSaving] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const src = assetUrl(digest, 'preview')
  const composition = useMemo(() => defaultComposition(src, name), [src, name])
  const [images, setImages] = useState<ReadonlyMap<string, HTMLImageElement>>(() => new Map())
  const [imagesVersion, setImagesVersion] = useState(0)
  const byCode = new Map((palette.data?.colors ?? []).map((c) => [c.code, c]))
  const colour = picked ? byCode.get(picked.colour) : undefined
  const front = product.data?.states.find((s) => s.code === 'front') ?? product.data?.states[0]

  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      setImages(new Map([[src, img]]))
      setImagesVersion((n) => n + 1)
    }
    img.src = src
  }, [src])

  useEffect(() => {
    if (!product.data) return
    void warmGarments(product.data.states.map((s) => frameUrl(product.data!.code, s.code)))
  }, [product.data])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function makeReference() {
    if (!picked || !dropId || saving) return
    setSaving(true)
    setHint(null)
    try {
      const work = {
        version: 2,
        stateCode: 'front',
        colourCode: picked.colour,
        size: null,
        composition,
      }
      const saved = await saveReference({
        name,
        sheet_digest: digest,
        image_digests: [digest],
        texts: [],
        work,
        colour_model_id: picked.colourModelId,
        drop_id: dropId,
      })
      onClose()
      navigate(`/references/${saved.id}?colour=${encodeURIComponent(picked.colour)}`, {
        state: { inApp: true, fromFamily: saved.id },
      })
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-label="Примерить принт"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="pf-card flex max-h-[92vh] w-full max-w-4xl flex-col gap-3 overflow-hidden border border-line p-4">
        <div className="flex flex-wrap items-center gap-2">
          <strong>Примерить · {name}</strong>
          <div className="w-56">
            <Select
              aria-label="дроп примерки"
              options={active.map((d) => ({ value: String(d.id), label: d.name }))}
              value={dropId != null ? String(dropId) : ''}
              onChange={(e) => {
                setDropId(Number(e.target.value))
                setPicked(null)
              }}
            />
          </div>
          <span className="flex-1" />
          <button
            className={buttonClass({ tone: 'accent', variant: 'solid', small: true })}
            disabled={!picked || saving}
            onClick={() => void makeReference()}
          >
            {saving ? 'создаю…' : 'сделать референс'}
          </button>
          <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={onClose} aria-label="закрыть">
            ×
          </button>
        </div>
        {hint && <p className="text-sm text-destructive">{hint}</p>}
        <p className="text-xs text-muted-foreground">Ничего не сохраняется, пока не нажмёте «сделать референс».</p>
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto md:grid-cols-2">
          <div className="flex flex-col gap-2">
            {matrix.isPending && <p className="text-sm text-muted-foreground">Загружаю ассортимент…</p>}
            {rows.map((row) => (
              <div key={row.model.id} className="rounded border border-line p-2">
                <div className="mb-1 text-sm font-medium">{row.model.name}</div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(row.cells).map(([code, cell]) => {
                    const sw = byCode.get(code)
                    const on = picked?.colourModelId === cell.colour_model_id
                    return (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={on}
                        className={`h-8 w-8 rounded border ${on ? 'border-accent ring-2 ring-accent' : 'border-line'}`}
                        style={{ background: sw ? toCss(sw) : '#ccc' }}
                        title={code}
                        onClick={() => setPicked({ row, colour: code, colourModelId: cell.colour_model_id })}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
            {matrix.isSuccess && rows.length === 0 && (
              <p className="text-sm text-muted-foreground">В дропе нет изделий с кадрами для работы.</p>
            )}
          </div>
          <div className="flex min-h-[280px] items-center justify-center rounded border border-line bg-muted p-2">
            {picked && product.data && front && colour ? (
              <GarmentCanvas
                preview
                state={front}
                frameSrc={frameUrl(product.data.code, front.code)}
                calibration={calibrationFor(
                  { pxPerCm: product.data.calibration.px_per_cm, provisional: true },
                  1,
                )}
                composition={composition}
                side={front.code}
                torso={null}
                anchorsBySide={{ [front.code]: front.anchors }}
                params={{ ...DEFAULT_PARAMS, base: toUnit(colour) }}
                renderScale={0.5}
                showZones={false}
                showAnchors={false}
                onSelect={() => undefined}
                onMove={() => undefined}
                onResize={() => undefined}
                onRotate={() => undefined}
                images={images}
                key={`${picked.colourModelId}-${imagesVersion}`}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Выберите цвет модели слева</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
