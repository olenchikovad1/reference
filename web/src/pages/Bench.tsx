import { useEffect, useState } from 'react'

import { fetchProduct, frameUrl, type Product, type State } from '../shared/api/products'

// Стенд нанесения. Пока — кадр, переключение состояний и то, что о них известно
// из данных: ориентиры, печатное поле, капюшон. Принт приезжает следующей
// историей; здесь проверяется, что сантиметры вообще стыкуются с кадром.

const PRODUCT = 'B-HDY-14'

type Overlay = 'none' | 'anchors' | 'zones' | 'all'

export function Bench() {
  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stateCode, setStateCode] = useState('front')
  const [overlay, setOverlay] = useState<Overlay>('all')

  useEffect(() => {
    fetchProduct(PRODUCT).then(setProduct).catch((e: Error) => setError(e.message))
  }, [])

  if (error) return <Message>Изделие не загрузилось: {error}</Message>
  if (!product) return <Message>Загружаю изделие…</Message>

  const state = product.states.find((s) => s.code === stateCode) ?? product.states[0]
  const cal = product.calibration
  const showAnchors = overlay === 'anchors' || overlay === 'all'
  const showZones = overlay === 'zones' || overlay === 'all'

  return (
    <main style={S.page}>
      <header style={S.head}>
        <h1 style={S.h1}>{product.display_name}</h1>
        <span style={S.code}>{product.code}</span>
      </header>

      <div style={S.body}>
        <figure style={S.canvasBox}>
          <svg viewBox={`0 0 ${state.frame.width} ${state.frame.height}`} style={S.canvas}>
            <image href={frameUrl(product.code, state.code)} width={state.frame.width} height={state.frame.height} />
            {showZones && <Zones state={state} />}
            {showAnchors && <Anchors state={state} />}
          </svg>
        </figure>

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

          <Group title="Калибровка">
            <p style={S.num}>{cal.px_per_cm} px/см</p>
            {cal.provisional && (
              <p style={S.warn}>
                Предварительная. {cal.derived_from}.
                {cal.range_if_size_unknown &&
                  ` Если размер другой — от ${cal.range_if_size_unknown[0]} до ${cal.range_if_size_unknown[1]}.`}
              </p>
            )}
            <p style={S.dim}>Проекция: {cal.projection}</p>
          </Group>

          <Group title="Размер">
            <p style={S.dim}>
              {product.rendered_size === null
                ? `Какой отрендерен — неизвестно, допущение ${product.rendered_size_assumed}`
                : product.rendered_size}
            </p>
            <p style={S.dim}>Ряд: {product.size_set.name}</p>
          </Group>

          {state.defects.length > 0 && (
            <Group title="Дефекты кадра">
              {state.defects.map((d) => (
                <p key={d} style={S.warn}>
                  {d === 'clipped_top' ? 'Верх срезан границей кадра' : d}
                </p>
              ))}
            </Group>
          )}

          {product.states_absent.length > 0 && (
            <Group title="Состояний нет">
              <p style={S.dim}>{product.states_absent.join(', ')}</p>
            </Group>
          )}
        </aside>
      </div>
    </main>
  )
}

function Zones({ state }: { state: State }) {
  const paint: Record<string, string> = {
    print: '#3b82f6',
    hood: '#f97316',
    pocket: '#a855f7',
  }
  return (
    <g>
      {Object.entries(state.zones).map(([name, points]) => (
        <polygon
          key={name}
          points={points.map(([x, y]) => `${x},${y}`).join(' ')}
          fill={paint[name] ?? '#94a3b8'}
          fillOpacity={0.14}
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
    <g>
      {Object.entries(state.anchors).map(([name, [x, y]]) => (
        <g key={name}>
          <circle cx={x} cy={y} r={7} fill="#111" fillOpacity={0.75} />
          <circle cx={x} cy={y} r={3} fill="#fff" />
          <text x={x + 12} y={y + 5} fontSize={16} fill="#111">
            {name}
          </text>
        </g>
      ))}
    </g>
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

function Message({ children }: { children: React.ReactNode }) {
  return <main style={S.page}>{children}</main>
}

// Стили временные и нарочно скупые: визуальный язык приедет из @platform/tokens,
// и собственный набор цветов здесь заводить нельзя — он потом не выполется.
const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: 'system-ui, sans-serif', padding: 20, color: '#111' },
  head: { display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 },
  h1: { fontSize: 20, margin: 0 },
  code: { color: '#666', fontSize: 13 },
  body: { display: 'flex', gap: 20, alignItems: 'flex-start' },
  canvasBox: { margin: 0, background: '#f3f4f6', borderRadius: 8, padding: 8 },
  canvas: { width: 640, height: 640, display: 'block' },
  panel: { minWidth: 260, maxWidth: 320 },
  group: { marginBottom: 16 },
  h2: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: '#666', margin: '0 0 6px' },
  row: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  btn: { padding: '5px 10px', border: '1px solid #d1d5db', background: '#fff', borderRadius: 6, cursor: 'pointer' },
  btnOn: { padding: '5px 10px', border: '1px solid #111', background: '#111', color: '#fff', borderRadius: 6, cursor: 'pointer' },
  tag: { color: '#9ca3af', fontStyle: 'normal', fontSize: 11 },
  num: { fontSize: 22, margin: '0 0 4px' },
  warn: { color: '#b45309', fontSize: 13, margin: '0 0 4px', lineHeight: 1.4 },
  dim: { color: '#666', fontSize: 13, margin: 0, lineHeight: 1.4 },
}
