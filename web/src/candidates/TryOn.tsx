// Примерка принта на изделиях дропа без сохранения (US-0892): сетка
// «модель × цвет», принт по умолчанию (от горловины 12 см, 18 см шириной).
// «Сделать референс» заводит семейство и открывает окно.

import { Select, Spinner, buttonClass } from '@platform/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { assetUrl } from '../shared/api/assets'
import { fetchPalette, toCss, toUnit } from '../shared/api/colours'
import { fetchDrops, fetchMatrix } from '../shared/api/drops'
import { frameUrl, productQuery } from '../shared/api/products'
import { saveReference } from '../shared/api/references'
import { colorwayColourCode, fetchPlmStatus, fetchPlmDrops, fetchPlmColorways, type PlmColorway, type PlmSelection } from '../shared/api/plm'
import { inspectRasterImage } from '../shared/dropped'
import { tryOnComposition } from '../shared/tryOn'
import { calibrationFor } from '../shared/fields'
import { GarmentCanvas } from './GarmentCanvas'
import { DEFAULT_PARAMS } from './renderer'

type Picked = { productCode: string; colour: string; rgb: [number, number, number] | null; colourModelId: number | null; plm: PlmSelection | null }

export function TryOn({ digest, name, onClose }: { digest: string; name: string; onClose: () => void }) {
  const navigate = useNavigate()
  const status = useQuery({ queryKey: ['plm-status'], queryFn: fetchPlmStatus, retry: 1 })
  const isPlm = Boolean(status.data?.configured)
  const drops = useQuery({ queryKey: ['drops'], queryFn: fetchDrops, enabled: status.data?.configured === false })
  const plmDrops = useQuery({ queryKey: ['plm-drops'], queryFn: () => fetchPlmDrops(), enabled: isPlm, retry: 1 })
  const [plmDrop, setPlmDrop] = useState('')
  const colorways = useQuery({ queryKey: ['plm-colorways', plmDrop], queryFn: () => fetchPlmColorways(plmDrop), enabled: isPlm && Boolean(plmDrop), retry: 1 })
  const palette = useQuery({ queryKey: ['palette'], queryFn: fetchPalette })
  const active = (drops.data ?? []).filter((d) => !d.retired)
  const [dropId, setDropId] = useState<number | null>(null)
  useEffect(() => {
    if (!isPlm && dropId === null && active[0]) setDropId(active[0].id)
  }, [active, dropId, isPlm])
  const matrix = useQuery({
    queryKey: ['drops', dropId, 'matrix'],
    queryFn: () => fetchMatrix(dropId!),
    enabled: !isPlm && dropId != null,
  })
  const rows = useMemo(() => (matrix.data?.rows ?? []).filter((r) => r.model.can_work), [matrix.data])
  const plmRows = useMemo(() => {
    const groups = new Map<string, PlmColorway[]>()
    for (const c of colorways.data ?? []) {
      if (!c.can_work || !c.product_code) continue
      const key = c.style_id || c.style_code
      groups.set(key, [...(groups.get(key) ?? []), c])
    }
    return [...groups.values()]
  }, [colorways.data])
  const [picked, setPicked] = useState<Picked | null>(null)
  const product = useQuery({
    ...productQuery(picked?.productCode ?? 'B-HDY-14'),
    enabled: Boolean(picked?.productCode),
  })
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const [hint, setHint] = useState<string | null>(null)
  const src = assetUrl(digest, 'preview')
  const [raster, setRaster] = useState<{ aspect: number; hasAlpha: boolean } | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [imageAttempt, setImageAttempt] = useState(0)
  const [frameState, setFrameState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [frameAttempt, setFrameAttempt] = useState(0)
  const composition = useMemo(() => tryOnComposition(src, name, raster?.aspect ?? 1, raster?.hasAlpha ?? false), [src, name, raster])
  const [images, setImages] = useState<ReadonlyMap<string, HTMLImageElement>>(() => new Map())
  const [imagesVersion, setImagesVersion] = useState(0)
  const byCode = new Map((palette.data?.colors ?? []).map((c) => [c.code, c]))
  const colour = picked?.rgb ?? (picked ? byCode.get(picked.colour)?.rgb : null)
  const front = product.data?.states.find((s) => s.code === 'front' && s.kind === 'precise')
  const baseSize = product.data?.size_grid?.base ?? product.data?.rendered_size ?? product.data?.rendered_size_assumed ?? null

  useEffect(() => {
    const img = new Image()
    let cancelled = false
    setImageError(null); setRaster(null); setImages(new Map())
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      try { setRaster(inspectRasterImage(img)) }
      catch { setImageError('Не удалось прочитать превью принта'); return }
      setImages(new Map([[src, img]]))
      setImagesVersion((n) => n + 1)
    }
    img.onerror = () => { if (!cancelled) setImageError('Превью принта не загрузилось. Повторите чтение.') }
    img.src = src
    return () => { cancelled = true; img.onload = null; img.onerror = null }
  }, [src, imageAttempt])

  useEffect(() => {
    setFrameState('loading')
    if (!product.data || !front) return
    const img = new Image()
    img.onload = () => setFrameState('ready')
    img.onerror = () => setFrameState('error')
    img.src = frameUrl(product.data.code, front.code)
    return () => { img.onload = null; img.onerror = null }
  }, [product.data?.code, front?.code, frameAttempt])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      // Закрываем только верхнюю примерку, а не лежащий под ней просмотр принта.
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  async function makeReference() {
    if (!picked || saving || inFlight.current || !raster || !product.data || !front || frameState !== 'ready' || (isPlm ? !plmDrop : !dropId)) return
    inFlight.current = true
    setSaving(true)
    setHint(null)
    try {
      const work = {
        version: 2,
        stateCode: front.code,
        colourCode: picked.colour,
        size: baseSize,
        composition: { ...composition, elements: composition.elements.map(el => ({ ...el, placement: { ...el.placement, side: front.code } })) },
        plm: picked.plm,
      }
      const saved = await saveReference({
        name,
        sheet_digest: digest,
        image_digests: [digest],
        texts: [],
        work,
        ...(picked.plm ? {} : { colour_model_id: picked.colourModelId, drop_id: dropId }),
      })
      onClose()
      navigate(`/references/${saved.id}?colour=${encodeURIComponent(picked.colour)}`, {
        state: { inApp: true, fromFamily: saved.id },
      })
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      inFlight.current = false
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
              options={isPlm ? [{ value: '', label: 'выберите дроп PLM' }, ...(plmDrops.data ?? []).map(d => ({ value: d.code, label: d.description ? `${d.code} · ${d.description}` : d.code }))] : active.map((d) => ({ value: String(d.id), label: d.name }))}
              value={isPlm ? plmDrop : dropId != null ? String(dropId) : ''}
              onChange={(e) => {
                if (isPlm) setPlmDrop(e.target.value)
                else setDropId(Number(e.target.value))
                setPicked(null)
              }}
            />
          </div>
          <span className="flex-1" />
          <button
            className={buttonClass({ tone: 'accent', variant: 'solid', small: true })}
            disabled={!picked || saving || !raster || !product.data || !front || !colour || frameState !== 'ready'}
            onClick={() => void makeReference()}
          >
            {saving ? 'создаю…' : 'сделать референс'}
          </button>
          <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={onClose} aria-label="закрыть">
            ×
          </button>
        </div>
        {hint && <p className="text-sm text-destructive">{hint}</p>}
        {imageError && <p role="alert" className="text-sm text-destructive">{imageError}{' '}<button onClick={() => setImageAttempt(n => n + 1)} className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}>повторить изображение</button></p>}
        {!raster && !imageError && <div role="status" className="flex items-center gap-2 text-sm"><Spinner />Получаем превью принта</div>}
        {palette.isError && <p role="alert" className="text-sm text-destructive">Палитра не пришла. <button onClick={() => void palette.refetch()}>повторить палитру</button></p>}
        {product.isError && picked && <p role="alert" className="text-sm text-destructive">{product.error.message} <button onClick={() => void product.refetch()}>повторить изделие</button></p>}
        {picked && product.isSuccess && !front && <p role="alert" className="text-sm text-destructive">У изделия нет точного ракурса спереди. Выберите другую модель.</p>}
        {picked && front && frameState === 'error' && <p role="alert" className="text-sm text-destructive">Кадр изделия не загрузился. <button onClick={() => setFrameAttempt(n => n + 1)}>повторить кадр</button></p>}
        {baseSize && <p className="text-xs text-muted-foreground">Базовый размер {baseSize}; от горловины 12 см, ширина принта 18 см.{product.data?.calibration.provisional ? ' Калибровка предварительная.' : ''}</p>}
        {picked?.plm && !byCode.has(picked.colour) && <p className="text-xs text-muted-foreground">PLM не передал код пантона этого цвета. Оттенок показан по цветомодели.</p>}
        <p className="text-xs text-muted-foreground">Ничего не сохраняется, пока не нажмёте «сделать референс».</p>
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto md:grid-cols-2">
          <div className="flex flex-col gap-2">
            {(status.isPending || (isPlm && plmDrop && colorways.isPending) || (!isPlm && dropId && matrix.isPending)) && <div role="status" className="flex items-center gap-2 text-sm"><Spinner />Получаем ассортимент дропа</div>}
            {(status.isError || plmDrops.isError || (isPlm ? colorways.isError : matrix.isError)) && <div role="alert" className="text-sm text-destructive">Ассортимент не пришёл. <button onClick={() => { void status.refetch(); if (isPlm) { void plmDrops.refetch(); if (plmDrop) void colorways.refetch() } else if (dropId) void matrix.refetch() }}>повторить ассортимент</button></div>}
            {isPlm && !plmDrop && <p className="text-sm text-muted-foreground">Выберите дроп PLM для примерки.</p>}
            {isPlm && plmDrops.isSuccess && !plmDrops.data.length && <p className="text-sm text-muted-foreground">В PLM пока нет доступных дропов.</p>}
            {isPlm && plmRows.map(group => <div key={group[0].style_id} className="rounded border border-line p-2">
              <div className="mb-1 text-sm font-medium">{group[0].style_code}</div>
              <div className="flex flex-wrap gap-1">{group.map(c => {
                const code = colorwayColourCode(c, palette.data?.colors ?? [])
                const sourceRgb = c.rgb ?? byCode.get(code)?.rgb
                const rgb: [number, number, number] | null = sourceRgb?.length === 3 ? [sourceRgb[0], sourceRgb[1], sourceRgb[2]] : null
                return <button key={c.id} type="button" aria-label={`примерить ${c.article} · ${c.color ?? code}`} aria-pressed={picked?.plm?.colorwayId === c.id}
                  disabled={!rgb || !palette.data} className={`h-8 w-8 rounded border ${picked?.plm?.colorwayId === c.id ? 'border-accent ring-2 ring-accent' : 'border-line'}`}
                  style={{ background: rgb ? toCss({ rgb }) : undefined }} title={rgb ? `${c.article} · ${c.color ?? code}` : 'PLM не передал оттенок для примерки'}
                  onClick={() => setPicked({ productCode: c.product_code!, colour: code, rgb, colourModelId: null, plm: { colorwayId: c.id, productCode: c.product_code!, dropCode: plmDrop } })} />
              })}</div>
            </div>)}
            {!isPlm && rows.map((row) => (
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
                        onClick={() => setPicked({ productCode: row.model.code, colour: code, rgb: sw?.rgb ?? null, colourModelId: cell.colour_model_id, plm: null })}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
            {((isPlm && plmDrop && colorways.isSuccess && plmRows.length === 0) || (!isPlm && matrix.isSuccess && rows.length === 0)) && (
              <p className="text-sm text-muted-foreground">В дропе нет изделий с кадрами для работы.</p>
            )}
          </div>
          <div className="flex min-h-[280px] items-center justify-center rounded border border-line bg-muted p-2">
            {picked && product.data && front && colour && frameState === 'ready' ? (
              <GarmentCanvas
                preview
                state={front}
                frameSrc={frameUrl(product.data.code, front.code)}
                calibration={calibrationFor(
                  { pxPerCm: product.data.calibration.px_per_cm, provisional: product.data.calibration.provisional },
                  1,
                )}
                composition={composition}
                side={front.code}
                torso={null}
                anchorsBySide={{ [front.code]: front.anchors }}
                params={{ ...DEFAULT_PARAMS, base: toUnit({ rgb: [...colour] }) }}
                renderScale={0.5}
                showZones={false}
                showAnchors={false}
                showPrintField={product.data.checks?.print_field !== false}
                showHood={product.data.checks?.hood !== false}
                onSelect={() => undefined}
                onMove={() => undefined}
                onResize={() => undefined}
                onRotate={() => undefined}
                images={images}
                key={`${picked.plm?.colorwayId ?? picked.colourModelId}-${imagesVersion}`}
              />
            ) : (
              picked && (product.isPending || (front && frameState === 'loading')) ? <div role="status" className="flex items-center gap-2 text-sm"><Spinner />Готовим изделие к примерке</div> : <p className="text-sm text-muted-foreground">Выберите доступный цвет модели слева</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
