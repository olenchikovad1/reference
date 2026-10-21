// Разработка коллекции (решение 0020) — вместо доски Холста: выбрал
// коллекцию (релиз PLM) → шапка → базы (модели) с передом и спиной → под
// базой «Идеи» и варианты по колонке на цвет, с автором, меткой и точкой
// «новое». Карточки двигают мышью, как на Холсте: выше, ниже, в другой цвет,
// в «Отложено» — карточка едет со всеми данными (Алиса 21.10).
//
// Ничего не удаляется: у варианта на доске нет удаления — есть полка
// «Отложено», у метки — только «погасить». Шапка колонки — база, окрашенная
// в пантон цветомодели тем же отрисовщиком, что окно работы: белую базу не
// перегоняют в каждый цвет 3D-программой.

import {
  Avatar,
  BackLink,
  Badge,
  DataTable,
  EmptyState,
  Modal,
  PageHeader,
  Select,
  Spinner,
  StatusDot,
  TONES,
  TextInput,
  buttonClass,
  type DataColumn,
} from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { FileCatcher } from '../candidates/FileCatcher'
import { TintedFrame } from '../candidates/TintedFrame'
import { meaningClass } from '../candidates/meaning'
import { assetUrl } from '../shared/api/assets'
import {
  addLabel,
  changeLabel,
  fetchBoard,
  fetchCollections,
  fetchLabels,
  markSeen,
  placeVariants,
  setVariantLabel,
  shelveVariant,
  uploadVariants,
  type Base,
  type CollectionRow,
  type Label,
  type Variant,
} from '../shared/api/collections'
import { fetchPlmStatus, plmImageUrl, plmOpenUrl, rgbCss } from '../shared/api/plm'
import {
  authorsOf,
  headline,
  imageFiles,
  labelCounts,
  matches,
  newCount,
  placeInto,
  shifted,
  type VariantFilter,
} from '../shared/collections'

export function Collections() {
  const { release } = useParams()
  return release ? <CollectionBoard releaseId={release} /> : <CollectionList />
}

// --- выбор коллекции -----------------------------------------------------------

function CollectionList() {
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const list = useQuery({ queryKey: ['collections', q], queryFn: () => fetchCollections(q.trim()) })
  const columns: DataColumn<CollectionRow>[] = [
    { id: 'code', header: 'коллекция', cell: (r) => <span className="truncate">{r.code}</span> },
    { id: 'drop_code', header: 'дроп', width: 'w-40', cell: (r) => r.drop_code ?? '—' },
    { id: 'supplier', header: 'фабрика', width: 'w-40', cell: (r) => r.supplier ?? '—' },
    { id: 'colorways', header: 'цветомоделей', width: 'w-32', cell: (r) => r.colorways },
    { id: 'variants', header: 'вариантов', width: 'w-28', cell: (r) => r.variants },
  ]
  return (
    <main className="p-4">
      <PageHeader
        title="Коллекции"
        icon="swatch-book"
        tone="teal"
        description="релизы PLM: откройте коллекцию — базы, варианты по цветам и метки"
      />
      <div className="mb-3 max-w-md">
        <TextInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Найти по названию: SHIBO, LPR 3, AW-AUT…"
          aria-label="Найти коллекцию по названию"
        />
      </div>
      {list.isError ? (
        <EmptyState
          icon="plug"
          title="PLM не ответил"
          description={`${(list.error as Error).message}. Коллекции читаются из PLM; повторите позже.`}
        />
      ) : (
        <DataTable
          rows={list.data ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          isLoading={list.isPending}
          onRowClick={(r) => navigate(`/collections/${encodeURIComponent(r.id)}`)}
          empty={q ? 'Под это название коллекций нет — сократите запрос.' : 'В PLM пока нет релизов.'}
        />
      )}
    </main>
  )
}

// --- доска ---------------------------------------------------------------------

/** Колонка доски: «Идеи» базы (цвета нет) или цвет; ids — сверху вниз. */
interface Lane {
  key: string
  styleId: string
  colorwayId: string | null
  title: string
  ids: number[]
}

/** Где открытый вариант стоит — для «выше», «ниже», «в колонку». */
interface Place {
  lane: Lane | null
  lanes: Lane[]
  shelved: boolean
}

const laneKey = (styleId: string, colorwayId: string | null) => `${styleId}:${colorwayId ?? 'ideas'}`

function lanesOf(base: Base): Lane[] {
  return [
    { key: laneKey(base.style_id, null), styleId: base.style_id, colorwayId: null, title: 'Идеи', ids: base.ideas.map((v) => v.id) },
    ...base.colours.map((c) => ({
      key: laneKey(base.style_id, c.colorway_id),
      styleId: base.style_id,
      colorwayId: c.colorway_id,
      title: c.color ?? c.article,
      ids: c.variants.map((v) => v.id),
    })),
  ]
}

function CollectionBoard({ releaseId }: { releaseId: string }) {
  const queries = useQueryClient()
  const board = useQuery({ queryKey: ['collection', releaseId], queryFn: () => fetchBoard(releaseId) })
  const labels = useQuery({ queryKey: ['collection-labels'], queryFn: fetchLabels })
  const plm = useQuery({ queryKey: ['plm', 'status'], queryFn: fetchPlmStatus })
  const [filter, setFilter] = useState<VariantFilter>({})
  const [armed, setArmed] = useState<Lane | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [opened, setOpened] = useState<{ variant: Variant; place: Place } | null>(null)
  const [editingLabels, setEditingLabels] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)

  const refresh = () => queries.invalidateQueries({ queryKey: ['collection', releaseId] })

  const send = async (lane: Lane, files: File[]) => {
    const pictures = imageFiles(files)
    if (pictures.length === 0) {
      setFailures((f) => ({ ...f, [lane.key]: 'Здесь нет картинок — вставьте или бросьте изображение.' }))
      return
    }
    setBusy(lane.key)
    setFailures((f) => ({ ...f, [lane.key]: '' }))
    try {
      await uploadVariants(releaseId, lane.styleId, lane.colorwayId, pictures)
      await refresh()
    } catch (e) {
      setFailures((f) => ({ ...f, [lane.key]: `${(e as Error).message} — повторите.` }))
    } finally {
      setBusy(null)
    }
  }

  const act = (run: () => Promise<unknown>) =>
    run()
      .then(() => {
        setMoveError(null)
        return refresh()
      })
      .catch((e: Error) => setMoveError(`${e.message} — повторите.`))

  /** Перенос: карточка встаёт перед `before` в колонке `lane` (null — вниз). */
  const move = (moved: number, lane: Lane, before: number | null) =>
    act(() => placeVariants(releaseId, lane.styleId, lane.colorwayId, placeInto(lane.ids, moved, before)))

  const shelve = (variantId: number, shelved: boolean) => act(() => shelveVariant(variantId, shelved))

  // Вставка Ctrl+V уходит во «взведённую» колонку, даже когда фокус ушёл с
  // неё: картинку из ChatGPT копируют в соседнем окне и возвращаются сюда.
  const armedRef = useRef(armed)
  armedRef.current = armed
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const lane = armedRef.current
      if (e.defaultPrevented || !lane) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      void send(lane, files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // Колонка читается из ссылки, а не из замыкания: пересоздавать слушатель
    // на каждое взведение незачем.
  }, [releaseId])

  const labelById = useMemo(() => new Map((labels.data ?? []).map((l) => [l.id, l])), [labels.data])

  if (board.isPending) return <Spinner label="Собираю коллекцию из PLM" className="m-8" />
  if (board.isError)
    return (
      <main className="p-4">
        <Back />
        <EmptyState
          icon="plug"
          title="Коллекция не открылась"
          description={`${(board.error as Error).message}. Шапка и базы читаются из PLM — повторите позже.`}
        />
      </main>
    )

  const { collection, bases, viewer } = board.data
  const counts = labelCounts(bases, labels.data ?? [], filter)
  const people = authorsOf(bases)
  const fresh = newCount(bases)
  const plmHref = plmOpenUrl(plm.data?.web_url, collection.plm_path)
  const filtered = filter.label !== undefined || filter.author !== undefined || filter.fresh
  const mineOn = viewer !== null && filter.author === viewer

  const open = (variant: Variant, place: Place) => {
    setOpened({ variant, place })
    if (variant.is_new) void markSeen(variant.id).then(refresh)
  }

  return (
    <main className="p-4">
      <PageHeader
        title={collection.code}
        icon="swatch-book"
        tone="teal"
        back={<Back />}
        description={headline(collection)}
        actions={
          <span className="flex gap-2">
            {plmHref && (
              <a className={meaningClass('quiet')} href={plmHref} target="_blank" rel="noreferrer">
                открыть в PLM
              </a>
            )}
            <button className={meaningClass('quiet')} onClick={() => setEditingLabels(true)}>
              метки
            </button>
          </span>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {collection.team.map((m) => (
          <span key={`${m.role}-${m.name}`} className="flex items-center gap-1" title={m.role}>
            <Avatar name={m.name} size="sm" />
            <span className="text-muted-foreground">{m.role.toLowerCase()}</span> {m.name}
          </span>
        ))}
        {people.map((p) => (
          <button
            key={p.id}
            className={`flex items-center gap-1 rounded px-1 ${filter.author === p.id ? 'bg-muted' : ''}`}
            onClick={() => setFilter((f) => ({ ...f, author: f.author === p.id ? undefined : p.id }))}
            title={filter.author === p.id ? 'Показать всех' : `Показать только варианты: ${p.name}`}
          >
            <Avatar name={p.name} size="sm" />
            {p.name} <span className="text-muted-foreground">{p.count}</span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {viewer && (
          <button
            className={`rounded px-1 ${mineOn ? 'bg-muted' : ''}`}
            onClick={() => setFilter((f) => ({ ...f, author: mineOn ? undefined : viewer }))}
            title={mineOn ? 'Показать всех' : 'Только мои варианты — и что с ними сделали'}
          >
            <Badge plain>мои</Badge>
          </button>
        )}
        <button
          className={`rounded px-1 ${filter.fresh ? 'bg-muted' : ''}`}
          onClick={() => setFilter((f) => ({ ...f, fresh: f.fresh ? undefined : true }))}
          title={filter.fresh ? 'Показать всё' : 'Только новое для меня: новые картинки и метки, пока меня не было'}
        >
          <span className="flex items-center gap-1">
            <StatusDot tone="rose" label="новое" /> новых {fresh}
          </span>
        </button>
        <span className="text-muted-foreground">·</span>
        {counts.map(({ label, count }) => {
          const key = label ? label.id : ('none' as const)
          const on = filter.label === key
          return (
            <button
              key={String(key)}
              className={`rounded px-1 ${on ? 'bg-muted' : ''}`}
              onClick={() => setFilter((f) => ({ ...f, label: on ? undefined : key }))}
              title={on ? 'Показать все метки' : `Показать только: ${label?.name ?? 'без метки'}`}
            >
              {label ? <Badge tone={label.tone}>{`${label.name} · ${count}`}</Badge> : <Badge plain>{`без метки · ${count}`}</Badge>}
            </button>
          )
        })}
        {filtered && (
          <button className={meaningClass('quiet', true)} onClick={() => setFilter({})}>
            показать всё
          </button>
        )}
      </div>
      {moveError && <p className="mb-2 text-sm text-destructive">{moveError}</p>}

      {bases.length === 0 ? (
        <EmptyState
          icon="shirt"
          title="В коллекции нет моделей"
          description="Базы — модели релиза. Добавьте цветомодели в релиз в PLM, и они появятся здесь."
        />
      ) : (
        bases.map((b) => (
          <BaseRow
            key={b.style_id}
            base={b}
            filter={filter}
            labelById={labelById}
            armed={armed?.key ?? null}
            busy={busy}
            failures={failures}
            dragging={dragging}
            onDragging={setDragging}
            onArm={setArmed}
            onFiles={(lane, files) => void send(lane, files)}
            onMove={(moved, lane, before) => void move(moved, lane, before)}
            onShelve={(id) => void shelve(id, true)}
            onOpen={open}
          />
        ))
      )}

      <VariantViewer
        opened={opened}
        labels={labels.data ?? []}
        onClose={() => setOpened(null)}
        onLabel={async (variant, labelId) => {
          await setVariantLabel(variant.id, labelId)
          setOpened((o) => (o ? { ...o, variant: { ...variant, label_id: labelId } } : o))
          await refresh()
        }}
        onPlace={async (_variant, lane, ids) => {
          await placeVariants(releaseId, lane.styleId, lane.colorwayId, ids)
          await refresh()
          setOpened(null)
        }}
        onShelve={async (variant, shelved) => {
          await shelveVariant(variant.id, shelved)
          await refresh()
          setOpened(null)
        }}
      />
      <LabelsEditor
        open={editingLabels}
        labels={labels.data ?? []}
        onClose={() => setEditingLabels(false)}
        onChanged={() => queries.invalidateQueries({ queryKey: ['collection-labels'] })}
      />
    </main>
  )
}

function Back() {
  return (
    <BackLink render={(content, className) => <Link to="/collections" className={className}>{content}</Link>}>
      Коллекции
    </BackLink>
  )
}

/** Какую карточку тащат — из события: id лежит в данных переноса. */
const DRAG_TYPE = 'application/x-reference-variant'

function draggedId(e: DragEvent): number | null {
  const raw = e.dataTransfer?.getData(DRAG_TYPE)
  return raw ? Number(raw) : null
}

/** Карточка, перед которой бросили: ближайшая под курсором. */
function beforeOf(e: DragEvent): number | null {
  const el = (e.target as HTMLElement | null)?.closest('[data-variant-id]') as HTMLElement | null
  return el ? Number(el.dataset.variantId) : null
}

interface BaseRowProps {
  base: Base
  filter: VariantFilter
  labelById: Map<number, Label>
  armed: string | null
  busy: string | null
  failures: Record<string, string>
  dragging: number | null
  onDragging: (id: number | null) => void
  onArm: (lane: Lane) => void
  onFiles: (lane: Lane, files: File[]) => void
  onMove: (moved: number, lane: Lane, before: number | null) => void
  onShelve: (id: number) => void
  onOpen: (v: Variant, place: Place) => void
}

function BaseRow(props: BaseRowProps) {
  const { base, filter, labelById, dragging, onDragging, onShelve, onOpen } = props
  const [shelfOpen, setShelfOpen] = useState(false)
  const [shelfOver, setShelfOver] = useState(false)
  const front = base.views.front
  const back = base.views.back
  // Красим только рендер стороны: фото цветомодели, перекрашенное в чужой
  // цвет, выдавало бы снимок за изделие, которого нет.
  const frontSrc = front?.exact ? plmImageUrl(front.key, 'preview') : null
  const baseArticle = front?.article ?? null
  const lanes = lanesOf(base)
  const [ideasLane, ...colourLanes] = lanes

  const card = (v: Variant, lane: Lane | null) => (
    <VariantCard
      key={v.id}
      variant={v}
      label={v.label_id ? labelById.get(v.label_id) ?? null : null}
      onOpen={() => onOpen(v, { lane, lanes, shelved: lane === null })}
      onDragStart={() => onDragging(v.id)}
      onDragEnd={() => onDragging(null)}
    />
  )

  return (
    <section className="pf-card mb-4 p-3" aria-label={`База ${base.code}`}>
      <h2 className="mb-2 text-sm font-semibold">
        База {base.code}
        <span className="font-normal text-muted-foreground">
          {[base.name, base.category, base.size_range].filter(Boolean).map((p) => ` · ${p}`)}
          {` · цветов ${base.colours.length}`}
        </span>
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        <div className="flex w-60 shrink-0 flex-col gap-2">
          <div className="grid grid-cols-2 gap-1">
            <Side title="перед" view={front?.key ?? null} note={front && !front.exact ? 'главная картинка, не рендер' : null} />
            <Side title="спина" view={back?.key ?? null} note={null} />
          </div>
          <p className="text-xs text-muted-foreground">
            {baseArticle ? `рендер ${baseArticle}` : 'в PLM нет рендера базы'}
          </p>
        </div>
        <LaneColumn
          {...props}
          lane={ideasLane}
          head={
            <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-sm bg-muted p-2 text-center text-xs text-muted-foreground">
              <span className="text-sm font-medium text-foreground">Идеи</span>
              без цвета: бросьте пачку, потом перетащите в колонку цвета
            </div>
          }
          caption={null}
          shown={base.ideas.filter((v) => matches(v, filter))}
          total={base.ideas.length}
          renderCard={(v) => card(v, ideasLane)}
        />
        {base.colours.map((c, i) => {
          const lane = colourLanes[i]
          const own = plmImageUrl(c.image, 'preview')
          const title = c.color ?? c.article
          const tinted = frontSrc && c.rgb && c.article !== baseArticle ? frontSrc : null
          return (
            <LaneColumn
              key={lane.key}
              {...props}
              lane={lane}
              head={
                tinted ? (
                  <TintedFrame src={tinted} rgb={c.rgb} alt={`База в цвете ${title}`} className="h-40 w-full rounded-sm bg-muted object-contain" />
                ) : own ? (
                  <img src={own} alt={title} className="h-40 w-full rounded-sm bg-muted object-contain" />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-sm bg-muted text-xs text-muted-foreground">
                    нет картинки и цвета в PLM
                  </div>
                )
              }
              caption={
                <div className="flex items-center gap-2 text-xs">
                  {/* Пантон приходит данными — единственный законный цвет строкой (как в окне работы). */}
                  <span className="h-4 w-4 shrink-0 rounded-sm border border-line" style={{ background: rgbCss(c.rgb) }} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium" title={title}>
                      {title}
                    </span>
                    <span className="block truncate text-muted-foreground" title={c.article}>
                      {c.article}
                      {tinted ? ' · окрашено' : ''}
                    </span>
                  </span>
                </div>
              }
              shown={c.variants.filter((v) => matches(v, filter))}
              total={c.variants.length}
              renderCard={(v) => card(v, lane)}
            />
          )
        })}
      </div>
      <div
        className={`mt-2 rounded border border-dashed p-2 ${shelfOver ? 'border-accent bg-muted' : 'border-line'}`}
        onDragOver={(e) => {
          if (dragging === null) return
          e.preventDefault()
          setShelfOver(true)
        }}
        onDragLeave={() => setShelfOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setShelfOver(false)
          const id = draggedId(e)
          if (id !== null) onShelve(id)
        }}
        aria-label={`Отложено у базы ${base.code}`}
      >
        <button
          className={meaningClass('quiet', true)}
          onClick={() => setShelfOpen((o) => !o)}
          title={shelfOpen ? 'Свернуть полку' : 'Показать отложенное'}
        >
          {shelfOpen ? 'свернуть' : 'показать'} · отложено {base.shelf.length}
        </button>
        <span className="ml-2 text-xs text-muted-foreground">
          подвал: бросьте сюда карточку — она не удаляется; вернуть — перетащить в колонку
        </span>
        {shelfOpen && (
          <div className="mt-2 flex flex-wrap gap-2">
            {base.shelf.length === 0 ? (
              <span className="text-xs text-muted-foreground">пусто</span>
            ) : (
              base.shelf.map((v) => (
                <div key={v.id} className="w-48">
                  {card(v, null)}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  )
}

interface LaneColumnProps extends BaseRowProps {
  lane: Lane
  head: ReactNode
  caption: ReactNode
  shown: Variant[]
  total: number
  renderCard: (v: Variant) => ReactNode
}

function LaneColumn({ lane, head, caption, shown, total, renderCard, armed, busy, failures, dragging, onArm, onFiles, onMove }: LaneColumnProps) {
  const [over, setOver] = useState(false)
  const isArmed = armed === lane.key
  const isBusy = busy === lane.key
  return (
    <div
      className={`flex w-48 shrink-0 flex-col gap-2 rounded-sm ${over ? 'bg-muted' : ''}`}
      aria-label={`Колонка ${lane.title}`}
      onDragOver={(e) => {
        if (dragging === null) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        setOver(false)
        const id = draggedId(e)
        if (id === null) return
        e.preventDefault()
        onMove(id, lane, beforeOf(e))
      }}
    >
      {head}
      {caption}
      <FileCatcher
        name={`Варианты: ${lane.title}`}
        accept="image/*"
        armed={isArmed}
        busy={isBusy}
        onArm={() => onArm(lane)}
        onFiles={(files) => onFiles(lane, files)}
        label={isBusy ? 'кладу варианты…' : isArmed ? '+ вариант: Ctrl+V сюда' : '+ вариант: нажмите и Ctrl+V, или бросьте файлы'}
      />
      {failures[lane.key] && <p className="text-xs text-destructive">{failures[lane.key]}</p>}
      {shown.map(renderCard)}
      {total > shown.length && (
        <p className="text-xs text-muted-foreground">
          показано {shown.length} из {total}
        </p>
      )}
    </div>
  )
}

function Side({ title, view, note }: { title: string; view: string | null; note: string | null }) {
  return (
    <figure className="flex flex-col gap-1">
      {view ? (
        <img src={plmImageUrl(view, 'preview') ?? ''} alt={title} className="h-40 w-full rounded-sm bg-muted object-contain" />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-sm bg-muted text-xs text-muted-foreground">нет</div>
      )}
      <figcaption className="text-xs text-muted-foreground" title={note ?? undefined}>
        {title}
        {note ? ' *' : ''}
      </figcaption>
    </figure>
  )
}

const moment = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function VariantCard({
  variant,
  label,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  variant: Variant
  label: Label | null
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  return (
    <button
      type="button"
      draggable
      data-variant-id={variant.id}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, String(variant.id))
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className="pf-card relative flex w-full cursor-grab flex-col gap-1 p-1 text-left"
      title="Открыть крупно; перетащить — выше, ниже, в другой цвет или в «Отложено»"
    >
      <img src={assetUrl(variant.image, 'thumb')} alt={variant.name} draggable={false} className="h-40 w-full rounded-sm bg-muted object-contain" />
      {variant.is_new && (
        <span className="absolute right-2 top-2">
          <StatusDot tone="rose" label="новое — вы его ещё не открывали" />
        </span>
      )}
      <span className="flex min-w-0 items-center gap-1 text-xs">
        <Avatar name={variant.author ?? undefined} size="xs" />
        <span className="truncate">{variant.author ?? 'автор неизвестен'}</span>
      </span>
      {label ? (
        <span className="flex flex-col gap-0.5">
          <Badge tone={label.tone}>{label.name}</Badge>
          {variant.label_by && variant.label_at && (
            <span className="truncate text-xs text-muted-foreground">
              {variant.label_by}, {moment(variant.label_at)}
            </span>
          )}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">без метки</span>
      )}
    </button>
  )
}

function VariantViewer({
  opened,
  labels,
  onClose,
  onLabel,
  onPlace,
  onShelve,
}: {
  opened: { variant: Variant; place: Place } | null
  labels: Label[]
  onClose: () => void
  onLabel: (v: Variant, labelId: number | null) => Promise<void>
  onPlace: (v: Variant, lane: Lane, ids: number[]) => Promise<void>
  onShelve: (v: Variant, shelved: boolean) => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const variant = opened?.variant ?? null
  useEffect(() => setError(null), [variant?.id])
  const fail = (err: Error) => setError(`${err.message} — повторите.`)
  const options = [
    { value: '', label: 'без метки' },
    ...labels
      .filter((l) => l.active || l.id === variant?.label_id)
      .map((l) => ({ value: String(l.id), label: l.active ? l.name : `${l.name} (погашена)` })),
  ]
  const place = opened?.place
  const lane = place?.lane ?? null
  const at = lane && variant ? lane.ids.indexOf(variant.id) : -1
  return (
    <Modal open={variant !== null} onClose={onClose} title={variant?.name ?? ''}>
      {variant && place && (
        <div className="flex flex-col gap-3">
          <img src={assetUrl(variant.image, 'preview')} alt={variant.name} className="max-h-[60vh] w-full object-contain" />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="flex items-center gap-1">
              <Avatar name={variant.author ?? undefined} size="sm" />
              {variant.author ?? 'автор неизвестен'}
            </span>
            <span className="text-muted-foreground">{moment(variant.created_at)}</span>
            <label className="flex items-center gap-2">
              метка
              <Select
                options={options}
                value={variant.label_id ? String(variant.label_id) : ''}
                onChange={(e) => void onLabel(variant, e.target.value ? Number(e.target.value) : null).catch(fail)}
                aria-label="Метка варианта"
              />
            </label>
          </div>
          {variant.label_by && variant.label_at && (
            <p className="text-xs text-muted-foreground">
              метку поставил(а) {variant.label_by}, {moment(variant.label_at)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {lane && (
              <>
                <button
                  className={meaningClass('quiet', true)}
                  disabled={at <= 0}
                  onClick={() => void onPlace(variant, lane, shifted(lane.ids, variant.id, -1)).catch(fail)}
                >
                  выше
                </button>
                <button
                  className={meaningClass('quiet', true)}
                  disabled={at < 0 || at >= lane.ids.length - 1}
                  onClick={() => void onPlace(variant, lane, shifted(lane.ids, variant.id, 1)).catch(fail)}
                >
                  ниже
                </button>
              </>
            )}
            <label className="flex items-center gap-2">
              в колонку
              <Select
                options={[
                  { value: '', label: lane ? lane.title : 'выберите' },
                  ...place.lanes.filter((l) => l.key !== lane?.key).map((l) => ({ value: l.key, label: l.title })),
                ]}
                value=""
                onChange={(e) => {
                  const target = place.lanes.find((l) => l.key === e.target.value)
                  if (target) void onPlace(variant, target, [variant.id, ...target.ids]).catch(fail)
                }}
                aria-label="Перенести в колонку"
              />
            </label>
            {place.shelved ? (
              <button className={meaningClass('agree', true)} onClick={() => void onShelve(variant, false).catch(fail)}>
                вернуть из «Отложено»
              </button>
            ) : (
              <button className={meaningClass('withdraw', true)} onClick={() => void onShelve(variant, true).catch(fail)}>
                отложить
              </button>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </Modal>
  )
}

const TONE_NAMES: Record<string, string> = {
  teal: 'бирюзовый',
  green: 'зелёный',
  blue: 'синий',
  amber: 'янтарный',
  rose: 'розовый',
  violet: 'фиолетовый',
  slate: 'серый',
}

function LabelsEditor({
  open,
  labels,
  onClose,
  onChanged,
}: {
  open: boolean
  labels: Label[]
  onClose: () => void
  onChanged: () => void
}) {
  const [name, setName] = useState('')
  const [tone, setTone] = useState<string>('slate')
  const [error, setError] = useState<string | null>(null)
  const tones = TONES.map((t) => ({ value: t, label: TONE_NAMES[t] ?? t }))
  const act = (run: () => Promise<unknown>) =>
    run()
      .then(() => {
        setError(null)
        onChanged()
      })
      .catch((e: Error) => setError(e.message))
  return (
    <Modal open={open} onClose={onClose} title="Метки вариантов">
      <p className="mb-3 text-sm text-muted-foreground">
        Метки правят сами: название и цвет. Убрать метку — погасить: на карточках она останется, новым её не поставят.
      </p>
      <div className="flex flex-col gap-2">
        {labels.map((l) => (
          <div key={l.id} className="flex items-center gap-2">
            <Badge tone={l.tone}>{l.name}</Badge>
            {!l.active && <span className="text-xs text-muted-foreground">погашена</span>}
            <span className="flex-1" />
            <Select
              options={tones}
              value={l.tone}
              onChange={(e) => void act(() => changeLabel(l.id, { tone: e.target.value }))}
              aria-label={`Цвет метки ${l.name}`}
            />
            <button
              className={meaningClass(l.active ? 'withdraw' : 'agree', true)}
              onClick={() => void act(() => changeLabel(l.id, { active: !l.active }))}
            >
              {l.active ? 'погасить' : 'вернуть'}
            </button>
          </div>
        ))}
      </div>
      <form
        className="mt-4 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void act(() => addLabel(name, tone).then(() => setName('')))
        }}
      >
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Новая метка" aria-label="Название новой метки" />
        <Select options={tones} value={tone} onChange={(e) => setTone(e.target.value)} aria-label="Цвет новой метки" />
        <button type="submit" className={buttonClass({ tone: 'accent', variant: 'soft' })} disabled={!name.trim()}>
          добавить
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Modal>
  )
}
