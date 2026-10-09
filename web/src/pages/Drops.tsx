// Дропы и их ассортимент (US-0489): слева список, справа матрица «модели ×
// цвета» — таблица из набора платформы. Пустая ячейка — «ещё не нарисовано»,
// из неё начинается референс на этой цветомодели. Модель без кадров видна, но
// работу на ней не начать — и причина названа, а не спрятана.

import { Checkbox, DataTable, Field, FormGrid, Modal, Select, TextInput, buttonClass, type DataColumn } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CODE } from '../app/shell'
import { meaningClass } from '../candidates/meaning'
import { useCan } from '../shared/api/platform'
import { fetchPalette } from '../shared/api/colours'
import {
  addToAssortment,
  createDrop,
  deleteDrop,
  fetchCatalogue,
  fetchDrops,
  fetchMatrix,
  removeFromAssortment,
  updateDrop,
  type Drop,
  type DropFields,
  type Matrix,
  type TreeNode,
} from '../shared/api/drops'
import { DropBoard } from './DropBoard'
import { fetchPlmColorways, fetchPlmDrops, fetchPlmStatus, plmImageUrl, rgbCss } from '../shared/api/plm'
import { PROFILE_LABEL, profileFromDates, profileFromWeeks, untilDateLabel, untilWeekLabel } from '../shared/season'

const dateRu = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

type Row = Matrix['rows'][number]

export function Drops() {
  const plm = useQuery({ queryKey: ['plm-status'], queryFn: fetchPlmStatus })
  const usePlm = Boolean(plm.data?.configured && plm.data.reachable)
  const drops = useQuery({ queryKey: ['drops'], queryFn: fetchDrops, enabled: !usePlm })
  const plmDrops = useQuery({ queryKey: ['plm-drops'], queryFn: () => fetchPlmDrops(), enabled: usePlm })
  const [picked, setPicked] = useState<number | null>(null)
  const [plmDrop, setPlmDrop] = useState<string | null>(null)
  // Выбранный мог исчезнуть — удалён, а список уже перечитан: тогда первый живой.
  const current = (picked !== null && drops.data?.some((d) => d.id === picked) ? picked : null) ?? drops.data?.find((d) => !d.retired)?.id ?? null
  const currentPlm = plmDrop ?? plmDrops.data?.[0]?.code ?? null
  const canWrite = useCan(CODE, 'drops', 'write')
  const canDelete = useCan(CODE, 'drops', 'delete')
  // Форма дропа: null — закрыта, 'new' — завести, дроп — поправить.
  const [editing, setEditing] = useState<Drop | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Drop | null>(null)

  if (plm.isPending || (!usePlm && drops.isPending)) return <main style={S.page}>Загружаю дропы…</main>
  if (!usePlm && drops.isError)
    return <main style={S.page}>Справочник дропов не ответил — обновите страницу; если повторится, стенд сервиса не поднят.</main>
  if (plm.data?.configured && !plm.data.reachable)
    return <main style={S.page}>plm недоступен: {plm.data.message}</main>

  if (usePlm) {
    return (
      <main style={{ ...S.page, display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 24 }}>
        <nav aria-label="дропы plm">
          <h1 style={S.h1}>Дропы</h1>
          <p style={{ ...S.dim, marginBottom: 12 }}>из plm · без копии в базе</p>
          {(plmDrops.data ?? []).map((d) => {
            const profile = profileFromWeeks(d.intake_week, d.exit_week)
            const window =
              d.intake_week != null && d.exit_week != null
                ? `нед. ${d.intake_week}–${d.exit_week}` +
                  (profile === 'sharp' ? ` · ${untilWeekLabel(d.exit_week)}` : '')
                : 'без окна продаж'
            return (
              <button key={d.code} onClick={() => setPlmDrop(d.code)} style={{ ...S.drop, ...(d.code === currentPlm ? S.dropOn : {}) }}>
                <b>{d.code}</b>
                <span style={S.dim}>
                  {[PROFILE_LABEL[profile], window, d.season, d.subseason, d.description].filter(Boolean).join(' · ')}
                </span>
              </button>
            )
          })}

        </nav>
        {currentPlm ? <PlmAssortment dropCode={currentPlm} /> : null}
      </main>
    )
  }

  return (
    <main style={{ ...S.page, display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 24 }}>
      <nav aria-label="дропы">
        <h1 style={S.h1}>Дропы</h1>
        {canWrite && (
          <button className={`${buttonClass({ tone: 'accent', variant: 'solid', small: true })} mb-2 w-full`} onClick={() => setEditing('new')}>
            + завести дроп
          </button>
        )}
        {(drops.data ?? []).map((d) => {
          const profile = profileFromDates(d.release_from, d.release_to)
          return (
            <button key={d.id} onClick={() => setPicked(d.id)} style={{ ...S.drop, ...(d.id === current ? S.dropOn : {}) }}>
              <b>{d.name}</b>
              <span style={S.dim}>
                {PROFILE_LABEL[profile]}
                {profile === 'sharp' ? ` · ${untilDateLabel(d.release_to)}` : ''} · {d.season} ·{' '}
                {dateRu(d.release_from)}–{dateRu(d.release_to)} · {d.audience}
                {d.retired ? ' · погашен' : ''}
              </span>
            </button>
          )
        })}

      </nav>
      {current !== null && drops.data ? (
        <DropMatrix
          dropId={current}
          drop={drops.data.find((d) => d.id === current)!}
          canWrite={canWrite}
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

/** Ассортимент дропа из plm: крупные плашки цвета ткани, без зеркала в Postgres. */
function PlmAssortment({ dropCode }: { dropCode: string }) {
  const navigate = useNavigate()
  const colorways = useQuery({
    queryKey: ['plm-colorways', dropCode],
    queryFn: () => fetchPlmColorways(dropCode),
  })
  if (colorways.isPending) return <section>Загружаю цветомодели plm…</section>
  if (colorways.isError) return <section>{(colorways.error as Error).message}</section>
  return (
    <section>
      <h2 style={S.h1}>{dropCode}</h2>
      <p style={{ ...S.dim, marginBottom: 16 }}>цветомодели plm · плашка — цвет ткани</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {(colorways.data ?? []).map((cw) => (
          <button
            key={cw.id}
            disabled={!cw.can_work}
            onClick={() => {
              if (!cw.can_work || !cw.product_code) return
              const colour = cw.color ?? cw.base_color ?? 'WHITE'
              navigate(
                `/references/new?product=${encodeURIComponent(cw.product_code)}&plm_colorway=${encodeURIComponent(cw.id)}&colour=${encodeURIComponent(colour)}&plm_drop=${encodeURIComponent(dropCode)}`,
              )
            }}
            style={{
              ...S.drop,
              width: 160,
              opacity: cw.can_work ? 1 : 0.55,
              cursor: cw.can_work ? 'pointer' : 'not-allowed',
            }}
            title={cw.can_work ? `работа: ${cw.article}` : (cw.reason ?? '')}
          >
            {plmImageUrl(cw.image) ? (
              <img
                src={plmImageUrl(cw.image)!}
                alt=""
                style={{ display: 'block', width: '100%', height: 96, objectFit: 'cover', borderRadius: 4, marginBottom: 8 }}
              />
            ) : (
              <span
                style={{
                  display: 'block',
                  height: 40,
                  borderRadius: 4,
                  border: '1px solid var(--line, #ccc)',
                  background: rgbCss(cw.rgb),
                  marginBottom: 8,
                }}
              />
            )}
            <b>{cw.color ?? cw.article}</b>
            <span style={S.dim}>
              {cw.style_code} · {cw.article}
              {!cw.can_work ? ` · ${cw.reason}` : ''}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function DropMatrix({
  dropId,
  drop,
  canWrite,
  onEdit,
  onDelete,
}: {
  dropId: number
  drop: Drop
  canWrite: boolean
  onEdit?: (d: Drop) => void
  onDelete?: (d: Drop) => void
}) {
  const m = useQuery({ queryKey: ['drops', dropId, 'matrix'], queryFn: () => fetchMatrix(dropId) })
  const navigate = useNavigate()
  const [refusal, setRefusal] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<{ id: number; what: string } | null>(null)

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
          <span className="inline-flex items-center gap-1">
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
          {canWrite && cell.references === 0 && (
            <button
              className="rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
              title="Убрать эту цветомодель из ассортимента дропа"
              aria-label={`убрать ${r.model.name} · ${c.name} из ассортимента`}
              onClick={() => setRemoving({ id: cell.colour_model_id, what: `${r.model.name} · ${c.name}` })}
            >
              ✕
            </button>
          )}
          </span>
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
      {canWrite && (
        <div className="mb-2">
          <button
            className={meaningClass('act', true)}
            onClick={() => setAdding(true)}
            title="В этом дропе будет ещё одна модель в цвете — появится клетка «ещё не нарисовано»"
          >
            + цветомодель
          </button>
        </div>
      )}
      {adding && <AddColourModel dropId={dropId} onClose={() => setAdding(false)} />}
      {removing && <RemoveColourModel dropId={dropId} item={removing} onClose={() => setRemoving(null)} />}
      <DataTable
        rows={m.data?.rows ?? []}
        columns={columns}
        rowKey={(r) => String(r.model.id)}
        isLoading={m.isPending}
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

function modelsOf(nodes: TreeNode[]): TreeNode['models'] {
  return nodes.flatMap((n) => [...n.models, ...modelsOf(n.children)])
}

/** «+ цветомодель» (US-0720): модель и цвет палитры — клетка в матрице. */
function AddColourModel({ dropId, onClose }: { dropId: number; onClose: () => void }) {
  const queries = useQueryClient()
  const tree = useQuery({ queryKey: ['catalogue'], queryFn: fetchCatalogue })
  const palette = useQuery({ queryKey: ['palette'], queryFn: fetchPalette, staleTime: Infinity })
  const [model, setModel] = useState('')
  const [colour, setColour] = useState('')
  const [error, setError] = useState<string | null>(null)
  const models = modelsOf(tree.data ?? [])
  const picked = models.find((m) => String(m.id) === model)
  const had = new Set(picked?.colour_models.filter((cm) => cm.drop_ids.includes(dropId)).map((cm) => cm.colour_code) ?? [])
  return (
    <Modal
      open
      onClose={onClose}
      title="Цветомодель в ассортимент"
      actions={
        <>
          <button className={meaningClass('quiet')} onClick={onClose}>
            не надо
          </button>
          <button
            className={meaningClass('agree')}
            disabled={!model || !colour}
            onClick={() =>
              void addToAssortment(dropId, Number(model), colour)
                .then(async () => {
                  await queries.invalidateQueries({ queryKey: ['drops', dropId, 'matrix'] })
                  await queries.invalidateQueries({ queryKey: ['catalogue'] })
                  onClose()
                })
                .catch((e: Error) => setError(e.message))
            }
          >
            добавить
          </button>
        </>
      }
    >
      <FormGrid columns={1}>
        <Field label="Модель" hint={picked && !picked.can_work ? `${picked.reason}: в ассортимент встанет, рисовать на ней пока нельзя` : undefined}>
          <Select
            aria-label="модель"
            placeholder="модель…"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            options={models.map((m) => ({ value: String(m.id), label: `${m.name} · ${m.code}` }))}
          />
        </Field>
        <Field label="Цвет" hint="из палитры справочника; уже стоящие в дропе у этой модели не предлагаются">
          <Select
            aria-label="цвет"
            placeholder="цвет…"
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            options={(palette.data?.colors ?? []).filter((c) => !had.has(c.code)).map((c) => ({ value: c.code, label: c.name === c.code ? `${c.group} · ${c.code}` : `${c.group} · ${c.name}` }))}
          />
        </Field>
      </FormGrid>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Modal>
  )
}

/** Убрать из ассортимента — только пустую клетку; сервис это же проверит. */
function RemoveColourModel({ dropId, item, onClose }: { dropId: number; item: { id: number; what: string }; onClose: () => void }) {
  const queries = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal
      open
      onClose={onClose}
      title={`Убрать «${item.what}» из ассортимента?`}
      actions={
        <>
          <button className={meaningClass('quiet')} onClick={onClose}>
            оставить
          </button>
          <button
            className={meaningClass('withdraw')}
            onClick={() =>
              void removeFromAssortment(dropId, item.id)
                .then(async () => {
                  await queries.invalidateQueries({ queryKey: ['drops', dropId, 'matrix'] })
                  await queries.invalidateQueries({ queryKey: ['catalogue'] })
                  onClose()
                })
                .catch((e: Error) => setError(e.message))
            }
          >
            убрать
          </button>
        </>
      }
    >
      <p className="text-sm">Референсов на ней нет, так что ничего не пропадёт; вернуть можно тем же «+ цветомодель».</p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Modal>
  )
}
