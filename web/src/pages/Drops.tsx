// Дропы и их ассортимент (US-0489): слева список, справа матрица «модели ×
// цвета» — таблица из набора платформы. Пустая ячейка — «ещё не нарисовано»,
// из неё начинается референс на этой цветомодели. Модель без кадров видна, но
// работу на ней не начать — и причина названа, а не спрятана.

import { Checkbox, DataTable, Field, FormGrid, Modal, TextInput, buttonClass, type DataColumn } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CODE } from '../app/shell'
import { meaningClass } from '../candidates/meaning'
import { useCan } from '../shared/api/platform'
import { createDrop, deleteDrop, fetchDrops, fetchMatrix, updateDrop, type Drop, type DropFields, type Matrix } from '../shared/api/drops'
import { DropBoard } from './DropBoard'

const dateRu = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

type Row = Matrix['rows'][number]

export function Drops() {
  const drops = useQuery({ queryKey: ['drops'], queryFn: fetchDrops })
  const [picked, setPicked] = useState<number | null>(null)
  // Выбранный мог исчезнуть — удалён, а список уже перечитан: тогда первый живой.
  const current = (picked !== null && drops.data?.some((d) => d.id === picked) ? picked : null) ?? drops.data?.find((d) => !d.retired)?.id ?? null
  const canWrite = useCan(CODE, 'drops', 'write')
  const canDelete = useCan(CODE, 'drops', 'delete')
  // Форма дропа: null — закрыта, 'new' — завести, дроп — поправить.
  const [editing, setEditing] = useState<Drop | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Drop | null>(null)

  if (drops.isPending) return <main style={S.page}>Загружаю дропы…</main>
  if (drops.isError)
    return <main style={S.page}>Справочник дропов не ответил — обновите страницу; если повторится, стенд сервиса не поднят.</main>

  return (
    <main style={{ ...S.page, display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 24 }}>
      <nav aria-label="дропы">
        <h1 style={S.h1}>Дропы</h1>
        {canWrite && (
          <button className={`${buttonClass({ tone: 'accent', variant: 'solid', small: true })} mb-2 w-full`} onClick={() => setEditing('new')}>
            + завести дроп
          </button>
        )}
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
      {current !== null ? (
        <DropMatrix
          dropId={current}
          drop={drops.data.find((d) => d.id === current)!}
          onEdit={canWrite ? (d) => setEditing(d) : undefined}
          onDelete={canDelete ? (d) => setDeleting(d) : undefined}
        />
      ) : null}
      {editing && (
        <DropForm
          drop={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(d) => {
            setEditing(null)
            setPicked(d.id)
          }}
        />
      )}
      {deleting && (
        <DeleteDrop
          drop={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null)
            setPicked(null)
          }}
        />
      )}
    </main>
  )
}

function DropMatrix({
  dropId,
  drop,
  onEdit,
  onDelete,
}: {
  dropId: number
  drop: Drop
  onEdit?: (d: Drop) => void
  onDelete?: (d: Drop) => void
}) {
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
      <div className="flex flex-wrap items-center gap-2">
        <h2 style={{ ...S.h1, margin: 0 }}>{drop.name}</h2>
        {drop.retired && <span className="rounded bg-muted px-1.5 text-xs">погашен</span>}
        {onEdit && (
          <button className={meaningClass('act', true)} onClick={() => onEdit(drop)} title="Название, сезон, даты, адресат, тема; погасить">
            поправить
          </button>
        )}
        {onDelete && (
          <button className={meaningClass('destroy', true)} onClick={() => onDelete(drop)} title="Только пустой дроп — заведённый по ошибке">
            удалить…
          </button>
        )}
      </div>
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
      <DropBoard dropId={dropId} />
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

const EMPTY: DropFields = { name: '', season: '', release_from: '', release_to: '', audience: '', theme: '', retired: false }

/** Завести или поправить дроп (US-0719). Не сохранилось — введённое остаётся. */
function DropForm({ drop, onClose, onSaved }: { drop: Drop | null; onClose: () => void; onSaved: (d: Drop) => void }) {
  const queries = useQueryClient()
  const [f, setF] = useState<DropFields>(drop ? { ...drop } : EMPTY)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof DropFields) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const ready = f.name.trim() && f.season.trim() && f.audience.trim() && f.release_from && f.release_to
  function save() {
    ;(drop ? updateDrop(drop.id, f) : createDrop(f))
      .then(async (d) => {
        await queries.invalidateQueries({ queryKey: ['drops'] })
        await queries.invalidateQueries({ queryKey: ['catalogue'] })
        onSaved(d)
      })
      .catch((e: Error) => setError(e.message))
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={drop ? `Поправить «${drop.name}»` : 'Завести дроп'}
      actions={
        <>
          <button className={meaningClass('quiet')} onClick={onClose}>
            не надо
          </button>
          <button className={meaningClass('agree')} disabled={!ready} onClick={save}>
            {drop ? 'сохранить' : 'завести'}
          </button>
        </>
      }
    >
      <FormGrid>
        <Field label="Название" wide>
          <TextInput value={f.name} onChange={set('name')} placeholder="Весна 2027" autoFocus />
        </Field>
        <Field label="Сезон" hint="как в Cosmic: AW26, SS27">
          <TextInput value={f.season} onChange={set('season')} placeholder="SS27" />
        </Field>
        <Field label="Адресат" hint="для кого выпуск">
          <TextInput value={f.audience} onChange={set('audience')} placeholder="дети 98–164" />
        </Field>
        <Field label="Выход с">
          <TextInput type="date" value={f.release_from} onChange={set('release_from')} />
        </Field>
        <Field label="по">
          <TextInput type="date" value={f.release_to} onChange={set('release_to')} />
        </Field>
        <Field label="Тема" wide>
          <TextInput value={f.theme} onChange={set('theme')} placeholder="о чём выпуск" />
        </Field>
      </FormGrid>
      {drop && (
        <div className="mt-3">
          <Checkbox
            label="погашен — для нового референса не предлагается, но виден там, где стоит"
            checked={f.retired}
            onChange={(on) => setF((x) => ({ ...x, retired: on }))}
          />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Modal>
  )
}

/** Удалить дроп, заведённый по ошибке: сервис стирает только пустой, а про
 *  непустой говорит, что в нём, — тогда его гасят. */
function DeleteDrop({ drop, onClose, onDeleted }: { drop: Drop; onClose: () => void; onDeleted: () => void }) {
  const queries = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal
      open
      onClose={onClose}
      title={`Удалить дроп «${drop.name}»?`}
      actions={
        <>
          <button className={meaningClass('quiet')} onClick={onClose}>
            оставить
          </button>
          <button
            className={meaningClass('destroy')}
            onClick={() =>
              void deleteDrop(drop.id)
                .then(() => queries.invalidateQueries({ queryKey: ['drops'] }))
                .then(onDeleted)
                .catch((e: Error) => setError(e.message))
            }
          >
            удалить насовсем
          </button>
        </>
      }
    >
      <p className="text-sm">
        Удаляется только пустой дроп — без цветомоделей в ассортименте и без предложенных принтов и надписей. Вернуть его нельзя,
        завести заново — можно.
      </p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Modal>
  )
}
