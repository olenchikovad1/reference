import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { GarmentCanvas } from '../candidates/GarmentCanvas'
import { fetchProduct, frameUrl, type Product } from '../shared/api/products'
import {
  EMPTY,
  add,
  find,
  heightCm,
  nudge,
  place,
  remove,
  select,
  type Composition,
  type ImageElement,
} from '../shared/composition'
import { formatCm } from '../shared/geometry'
import { readDropped } from '../shared/dropped'

// Стенд нанесения. Кадр изделия, на него бросают картинки, их двигают и мерят
// в сантиметрах. Складки и тень приедут следующей историей — здесь проверяется,
// что сантиметры стыкуются с кадром и что этим можно пользоваться руками.

const PRODUCT = 'B-HDY-14'
type Overlay = 'none' | 'anchors' | 'zones' | 'all'

export function Bench() {
  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stateCode, setStateCode] = useState('front')
  const [overlay, setOverlay] = useState<Overlay>('zones')
  const [composition, setComposition] = useState<Composition>(EMPTY)
  const [dropHint, setDropHint] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    fetchProduct(PRODUCT).then(setProduct).catch((e: Error) => setError(e.message))
  }, [])

  const state = product?.states.find((s) => s.code === stateCode) ?? product?.states[0] ?? null
  const calibration = useMemo(
    () => ({ pxPerCm: product?.calibration.px_per_cm ?? 1, provisional: true }),
    [product],
  )
  const selected = find(composition, composition.selectedId)

  // Клавиши: мышкой удобно искать, но попасть в «12 см ниже горловины» ею
  // нельзя, а это основной способ работы.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!composition.selectedId) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const step = e.shiftKey ? 1 : 0.1
      const by: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      if (e.key in by) {
        e.preventDefault()
        const [dx, dy] = by[e.key]
        setComposition((c) => nudge(c, c.selectedId as string, dx, dy))
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        setComposition((c) => remove(c, c.selectedId as string))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [composition.selectedId])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
      if (files.length === 0) return
      const read = await Promise.all(files.map(readDropped))
      const opaque = read.filter((d) => !d.hasAlpha)
      setDropHint(
        opaque.length === 0
          ? null
          : `Фон не вырезан: ${opaque.map((d) => d.name).join(', ')}. ` +
              'Такая картинка ляжет на изделие прямоугольником — это не поломка, ' +
              'а то, как выглядит непрозрачный файл.',
      )
      setComposition((c) =>
        read.reduce((acc, d, i) => {
          seq.current += 1
          const el: ImageElement = {
            id: `el-${seq.current}`,
            kind: 'image',
            name: d.name,
            src: d.src,
            aspect: d.aspect,
            hasAlpha: d.hasAlpha,
            placement: {
              anchor: 'neck',
              dxCm: 0,
              // Бросили несколько — раскладываем лесенкой, иначе они лягут
              // друг на друга и выбрать нижний будет нечем.
              dyCm: 12 + i * 2,
              widthCm: 18,
              rotation: 0,
            },
          }
          return add(acc, el)
        }, c),
      )
    },
    [],
  )

  if (error) return <main style={S.page}>Изделие не загрузилось: {error}</main>
  if (!product || !state) return <main style={S.page}>Загружаю изделие…</main>

  const cal = product.calibration

  return (
    <main style={S.page}>
      <header style={S.head}>
        <h1 style={S.h1}>{product.display_name}</h1>
        <span style={S.code}>{product.code}</span>
        <span style={S.dim}>
          {cal.px_per_cm} px/см{cal.provisional && ' · предварительно'}
        </span>
      </header>

      <div style={S.body}>
        <div>
          <div
            style={S.canvasBox}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => void onDrop(e)}
          >
            <GarmentCanvas
              state={state}
              frameSrc={frameUrl(product.code, state.code)}
              calibration={calibration}
              composition={composition}
              showZones={overlay === 'zones' || overlay === 'all'}
              showAnchors={overlay === 'anchors' || overlay === 'all'}
              onSelect={(id) => setComposition((c) => select(c, id))}
              onMove={(id, dxCm, dyCm) => setComposition((c) => place(c, id, { dxCm, dyCm }))}
              onResize={(id, widthCm) => setComposition((c) => place(c, id, { widthCm }))}
              onRotate={(id, rotation) => setComposition((c) => place(c, id, { rotation }))}
            />
          </div>
          {composition.elements.length === 0 && (
            <p style={S.dim}>Перетащите сюда картинки — можно несколько разом.</p>
          )}
          {dropHint && <p style={S.warn}>{dropHint}</p>}
        </div>

        <aside style={S.panel}>
          <Group title="Состояние">
            {product.states.map((s) => (
              <button
                key={s.code}
                onClick={() => setStateCode(s.code)}
                style={s.code === state.code ? S.btnOn : S.btn}
              >
                {s.display_name}
                {s.kind === 'illustrative' && <em style={S.tag}> только показ</em>}
              </button>
            ))}
          </Group>

          <Group title="Что видно">
            {(['all', 'anchors', 'zones', 'none'] as Overlay[]).map((o) => (
              <button key={o} onClick={() => setOverlay(o)} style={o === overlay ? S.btnOn : S.btn}>
                {{ all: 'всё', anchors: 'ориентиры', zones: 'зоны', none: 'ничего' }[o]}
              </button>
            ))}
          </Group>

          <Group title={`Элементы (${composition.elements.length})`}>
            {composition.elements.length === 0 && <p style={S.dim}>пусто</p>}
            <div style={S.list}>
              {composition.elements.map((el) => (
                <div
                  key={el.id}
                  onClick={() => setComposition((c) => select(c, el.id))}
                  style={el.id === composition.selectedId ? S.itemOn : S.item}
                >
                  <span style={S.itemName}>{el.name}</span>
                  {!el.hasAlpha && <span style={S.badge}>фон не вырезан</span>}
                  <button
                    style={S.x}
                    onClick={(e) => {
                      e.stopPropagation()
                      setComposition((c) => remove(c, el.id))
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Group>

          {selected && (
            <Group title="Размещение">
              <Num
                label="от горловины вниз"
                value={selected.placement.dyCm}
                onChange={(v) => setComposition((c) => place(c, selected.id, { dyCm: v }))}
              />
              <Num
                label="от центра вбок"
                value={selected.placement.dxCm}
                onChange={(v) => setComposition((c) => place(c, selected.id, { dxCm: v }))}
              />
              <Num
                label="ширина"
                value={selected.placement.widthCm}
                onChange={(v) => setComposition((c) => place(c, selected.id, { widthCm: Math.max(0.5, v) }))}
              />
              <Num
                label="поворот, °"
                value={selected.placement.rotation}
                unit=""
                onChange={(v) => setComposition((c) => place(c, selected.id, { rotation: v }))}
              />
              <p style={S.dim}>высота {formatCm(heightCm(selected))} — следует за пропорцией</p>
              <p style={S.dim}>стрелки двигают на 1 мм, с Shift — на 1 см</p>
            </Group>
          )}
        </aside>
      </div>
    </main>
  )
}

function Num({
  label,
  value,
  unit = ' см',
  onChange,
}: {
  label: string
  value: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <label style={S.num}>
      <span style={S.numLabel}>{label}</span>
      <input
        type="number"
        step={0.1}
        value={Number(value.toFixed(1))}
        onChange={(e) => onChange(Number(e.target.value))}
        style={S.input}
      />
      <span style={S.numUnit}>{unit}</span>
    </label>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={S.group}>
      <h2 style={S.h2}>{title}</h2>
      <div style={S.row}>{children}</div>
    </section>
  )
}

// Стили временные и нарочно скупые: визуальный язык приедет из @platform/tokens,
// и заводить здесь свой набор цветов нельзя — он потом не выполется.
const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: 'system-ui, sans-serif', padding: 16, color: '#111' },
  head: { display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 },
  h1: { fontSize: 18, margin: 0 },
  code: { color: '#666', fontSize: 13 },
  body: { display: 'flex', gap: 18, alignItems: 'flex-start' },
  canvasBox: { width: 620, height: 620, background: '#f3f4f6', borderRadius: 8, padding: 6 },
  panel: { minWidth: 280, maxWidth: 330 },
  group: { marginBottom: 14 },
  h2: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#666', margin: '0 0 6px' },
  row: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  list: { display: 'flex', flexDirection: 'column', gap: 4, width: '100%' },
  item: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, border: '1px solid #e5e7eb', cursor: 'pointer' },
  itemOn: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, border: '1px solid #2563eb', background: '#eff6ff', cursor: 'pointer' },
  itemName: { flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  badge: { fontSize: 10, color: '#b45309', background: '#fef3c7', padding: '1px 5px', borderRadius: 4 },
  x: { border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: '#9ca3af' },
  btn: { padding: '5px 10px', border: '1px solid #d1d5db', background: '#fff', borderRadius: 6, cursor: 'pointer' },
  btnOn: { padding: '5px 10px', border: '1px solid #111', background: '#111', color: '#fff', borderRadius: 6, cursor: 'pointer' },
  tag: { color: '#9ca3af', fontStyle: 'normal', fontSize: 11 },
  num: { display: 'flex', alignItems: 'center', gap: 6, width: '100%', marginBottom: 4 },
  numLabel: { flex: 1, fontSize: 12, color: '#374151' },
  numUnit: { fontSize: 12, color: '#9ca3af', width: 26 },
  input: { width: 74, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 5 },
  warn: { color: '#b45309', fontSize: 13, lineHeight: 1.4, maxWidth: 620 },
  dim: { color: '#666', fontSize: 12, margin: '4px 0 0', lineHeight: 1.4 },
}
