// Дропы и их ассортимент (US-0489): слева список, справа матрица «модели ×
// цвета» — таблица из набора платформы. Пустая ячейка — «ещё не нарисовано»,
// из неё начинается референс на этой цветомодели. Модель без кадров видна, но
// работу на ней не начать — и причина названа, а не спрятана.

import { DataTable, type DataColumn } from '@platform/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { fetchDrops, fetchMatrix, type Drop, type Matrix } from '../shared/api/drops'

const dateRu = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

type Row = Matrix['rows'][number]

export function Drops() {
  const drops = useQuery({ queryKey: ['drops'], queryFn: fetchDrops })
  const [picked, setPicked] = useState<number | null>(null)
  const current = picked ?? drops.data?.find((d) => !d.retired)?.id ?? null

  if (drops.isPending) return <main style={S.page}>Загружаю дропы…</main>
  if (drops.isError)
    return <main style={S.page}>Справочник дропов не ответил — обновите страницу; если повторится, стенд сервиса не поднят.</main>

  return (
    <main style={{ ...S.page, display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 24 }}>
      <nav aria-label="дропы">
        <h1 style={S.h1}>Дропы</h1>
        {drops.data.map((d) => (
          <button key={d.id} onClick={() => setPicked(d.id)} style={{ ...S.drop, ...(d.id === current ? S.dropOn : {}) }}>
            <b>{d.name}</b>
            <span style={S.dim}>
              {d.season} · {dateRu(d.release_from)}–{dateRu(d.release_to)} · {d.audience}
              {d.retired ? ' · погашен' : ''}
            </span>
          </button>
        ))}
      </nav>
      {current !== null ? <DropMatrix dropId={current} drop={drops.data.find((d) => d.id === current)!} /> : null}
    </main>
  )
}

function DropMatrix({ dropId, drop }: { dropId: number; drop: Drop }) {
  const m = useQuery({ queryKey: ['drops', dropId, 'matrix'], queryFn: () => fetchMatrix(dropId) })
  const navigate = useNavigate()
  const [refusal, setRefusal] = useState<string | null>(null)

  if (m.isError) return <section>Ассортимент не пришёл — обновите страницу.</section>

  const columns: DataColumn<Row>[] = [
    {
      id: 'model',
      header: 'модель',
      // Имя модели длиннее цвета: на общей доле оно ломается в три строки.
      width: 'w-56',
      cell: (r) => (
        <span>
          <b>{r.model.name}</b>
          <span style={S.dim}>
            {r.model.code} · {r.model.category}
            {!r.model.can_work && ' · без кадров'}
          </span>
        </span>
      ),
    },
    ...(m.data?.colours ?? []).map<DataColumn<Row>>((c) => ({
      id: c.code,
      header: (
        <span>
          <span style={{ ...S.swatch, background: c.rgb ? `rgb(${c.rgb.join(',')})` : '#ccc' }} /> {c.name}
        </span>
      ),
      cell: (r) => {
        const cell = r.cells[c.code]
        if (!cell) return null
        return (
          <button
            style={S.cell}
            onClick={() => {
              if (!r.model.can_work) {
                setRefusal(`${r.model.name}: ${r.model.reason ?? 'работать не на чем'}`)
                return
              }
              setRefusal(null)
              // Референс начинается на этой цветомодели: примерка открывается в
              // её цвете и запомнит цветомодель при сохранении.
              navigate(`/references/new?colour_model=${cell.colour_model_id}&colour=${encodeURIComponent(c.code)}`)
            }}
          >
            {cell.references === 0 ? 'ещё не нарисовано' : `референсов: ${cell.references}`}
          </button>
        )
      },
    })),
  ]

  return (
    <section>
      <h2 style={S.h1}>{drop.name}</h2>
      <p style={S.dim}>{drop.theme || 'тема не записана'}</p>
      <DataTable
        rows={m.data?.rows ?? []}
        columns={columns}
        rowKey={(r) => String(r.model.id)}
        isLoading={m.isPending}
        pagination="off"
        empty="В дропе пока нет ни одной цветомодели — добавьте модели в его ассортимент."
      />
      {refusal && (
        <p role="status" style={{ marginTop: 12, color: '#b45309' }}>
          {refusal}
        </p>
      )}
    </section>
  )
}

const S = {
  page: { padding: 24 },
  h1: { fontSize: 20, margin: '0 0 8px' },
  dim: { color: '#666', fontSize: 12, display: 'block' },
  drop: { display: 'block', width: '100%', textAlign: 'left' as const, padding: '8px 10px', marginBottom: 6, border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', cursor: 'pointer' },
  dropOn: { borderColor: '#2563eb', background: '#eff6ff' },
  cell: { padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 },
  swatch: { display: 'inline-block', width: 10, height: 10, borderRadius: 2, border: '1px solid #ccc', marginRight: 4 },
}
