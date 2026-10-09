// Страница «Принты» (US-0495): библиотека картинками, а не референсами — одна
// картинка стоит в десятке референсов. Плитка рядами по пропорциям (US-0713):
// картинка, имя, три сильных тега; остальное — в окне по нажатию. Поиск — по весам любым
// русским словом (план 071). Файлы бросаются прямо на страницу: уходят в
// библиотеку и сразу получают теги и название.

import { Checkbox, EmptyState, Hint, IconButton, PageHeader, Select, TextInput, buttonClass, counted } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { AssignBar, DropFilterBar } from '../candidates/DropFilter'
import { HotkeysHint } from '../candidates/HotkeysHint'
import { Justified, JustifiedCell, useRatios } from '../candidates/Justified'
import { Viewer } from '../candidates/Viewer'
import { Votes } from '../candidates/Votes'
import type { KeyRow } from '../shared/keys'
import { DECISION_NAMES, passes, useDropFilter, type DropDecision } from '../shared/filters'
import { CODE } from '../app/shell'
import { useCan } from '../shared/api/platform'
import {
  assetUrl,
  defectText,
  fetchLibrary,
  linkImages,
  markDefect,
  unmarkDefect,
  recogniseAssets,
  searchAssets,
  setKind,
  fetchRetag,
  uploadAssets,
  voteLibrary,
  KIND_OPTIONS,
  UploadRefused,
  type LibraryItem,
} from '../shared/api/assets'

const SOURCES: Record<string, string> = { catalog: 'из каталога', inherited: 'как у той же картинки' }

const PRINTS_KEYS: readonly KeyRow[] = [
  { keys: '← → ↑ ↓', what: 'по картинкам: вбок — соседняя, вверх-вниз — в соседнем ряду' },
  { keys: 'Enter', what: 'открыть крупно' },
  { keys: 'Пробел', what: 'выделить картинку' },
  { keys: 'Ctrl + щелчок', what: 'добавить к выделенным или убрать' },
  { keys: 'Shift + щелчок', what: 'выделить от прошлой выделенной до этой' },
  { keys: 'Esc', what: 'снять выделение' },
  { keys: '?', what: 'эта подсказка' },
]

const DROP_STATUS: Record<string, string> = { proposed: 'предложен', approved: 'одобрен', rejected: 'не одобрен' }

/** Кружок статуса в правом верхнем углу (владелец 29.09): брак — красный,
 *  одобрен в дроп — зелёный, предложен — жёлтый, не одобрен — серый. С
 *  отбором дропа — статус в нём; без — лучший из всех дропов. */
function StatusDot({ item, drop }: { item: LibraryItem; drop: number | null }) {
  const links = item.drops.filter((d) => drop === null || d.id === drop)
  const of = (d: (typeof links)[number]) => (d.via !== null ? 'approved' : (d.status ?? 'proposed'))
  const best = item.defect
    ? 'defect'
    : (['approved', 'proposed', 'rejected'] as const).find((st) => links.some((d) => of(d) === st))
  if (!best) return null
  const look = {
    defect: ['bg-destructive', '✕', item.defect ? defectText(item.defect) : ''],
    approved: ['bg-success', '✓', ''],
    proposed: ['bg-warning', '?', ''],
    rejected: ['bg-muted-foreground', '–', ''],
  }[best]
  const text =
    best === 'defect'
      ? look[2]
      : links.map((d) => `${d.name}: ${d.via !== null ? `через референс №${d.via}` : DROP_STATUS[d.status ?? 'proposed']}`).join('; ')
  return (
    <span
      className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold text-white shadow ${look[0]}`}
      title={text}
      aria-label={text}
    >
      {look[1]}
    </span>
  )
}

export function Prints() {
  // Фильтр «брак»: забракованное не видно нигде, кроме него (US-0499).
  const [defects, setDefects] = useState(false)
  const library = useQuery({ queryKey: ['library', defects], queryFn: () => fetchLibrary(defects) })
  const canDefect = useCan(CODE, 'prints', 'mark-defect')
  const [opened, setOpened] = useState<string | null>(null)
  // Окно открывается сразу с вводом причины брака — из значка на плитке.
  const [openedToDefect, setOpenedToDefect] = useState(false)
  const openedItem = library.data?.find((i) => i.digest === opened) ?? null
  const [ratioOf, learnRatio] = useRatios()
  function vote(digest: string, value: -1 | 0 | 1) {
    voteLibrary('images', digest, value)
      .then(() => queries.invalidateQueries({ queryKey: ['library'] }))
      .catch((e: Error) => setError(`${e.message} — повторите.`))
  }
  const queries = useQueryClient()
  // Ход переразметки (US-0629): пока идёт — перечитывается сам, закончилась —
  // библиотека перечитывается один раз, чтобы показать новые теги.
  const retag = useQuery({
    queryKey: ['retag'],
    queryFn: fetchRetag,
    refetchInterval: (q) => (q.state.data && !q.state.data.finished ? 1500 : false),
  })
  const retagRunning = !!retag.data && !retag.data.finished
  useEffect(() => {
    if (retag.data?.finished) void queries.invalidateQueries({ queryKey: ['library'] })
  }, [retag.data?.finished, queries])
  const [query, setQuery] = useState('')
  const found = useWeights(query)
  const [busy, setBusy] = useState<string | null>(null)
  const drop = useDropFilter()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  /** Файлы в библиотеку: загрузить, узнать (теги и название), показать. */
  async function add(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    setBusy(`Загружаю ${images.length}…`)
    setError(null)
    try {
      const stored = await uploadAssets(images)
      setBusy('Смотрю, что на картинках…')
      const seen = await recogniseAssets(stored.map((a) => a.digest))
      // Забракованная, загруженная снова, — сразу сказать: тем же файлом или
      // пересохранённой её узнаёт вектор.
      const bad = seen.filter((s) => s.defect)
      if (bad.length) setError(bad.map((s) => `${stored.find((a) => a.digest === s.digest)?.name ?? s.digest}: ${defectText(s.defect!)}`).join('; '))
      await queries.invalidateQueries({ queryKey: ['library'] })
    } catch (e) {
      setError(e instanceof UploadRefused ? e.reason : `Не загрузилось: ${e instanceof Error ? e.message : e} — повторите.`)
    } finally {
      setBusy(null)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    void add([...e.dataTransfer.files])
  }

  // В поиске — порядок и вес поиска; без него — библиотека, свежие первыми.
  // Фильтр дропа поверх: картинка без дропа не пропадает — без фильтра она
  // среди всех и находится поиском.
  const items: { item: LibraryItem; weight?: number; because?: string | null }[] = (
    found.rows === null
      ? (library.data ?? []).map((item) => ({ item }))
      : found.rows.flatMap((f) => {
          const item = library.data?.find((i) => i.digest === f.digest)
          return item ? [{ item, weight: f.weight, because: f.because }] : []
        })
  ).filter(({ item }) =>
    passes({ drops: item.drops.map((d) => d.id), audiences: item.audiences.map((a) => a.code), categories: item.categories }, drop.filter) &&
      printMatchesDecision(item, drop.filter.decision, drop.filter.drop),
  )

  function assign(what: { drop_id?: number; audience?: string }) {
    linkImages({ keys: [...picked], ...what })
      .then(() => {
        setPicked(new Set())
        return queries.invalidateQueries({ queryKey: ['library'] })
      })
      .catch((e: Error) => setError(`${e.message} — повторите.`))
  }
  // Ctrl+щелчок — добавить или убрать, Shift+щелчок — от прошлой выделенной
  // до этой: как на витрине референсов.
  const [lastPicked, setLastPicked] = useState<string | null>(null)
  function pickBy(digest: string, e: { shiftKey: boolean }) {
    if (e.shiftKey && lastPicked) {
      const order = items.map(({ item }) => item.digest)
      const [a, b] = [order.indexOf(lastPicked), order.indexOf(digest)].sort((x, y) => x - y)
      if (a >= 0) {
        setPicked((s) => new Set([...s, ...order.slice(a, b + 1)]))
        return
      }
    }
    toggle(digest)
    setLastPicked(digest)
  }
  /** Стрелки по плитке: вбок — соседняя, вверх-вниз — ближайшая в соседнем
   *  ряду; пробел выделяет, Enter открывает, Esc снимает выделение. */
  function onTilesKey(e: KeyboardEvent<HTMLDivElement>) {
    const tiles = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-tile]')]
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape' && picked.size) {
      setPicked(new Set())
      return
    }
    if (at < 0) return
    const here = tiles[at]
    if (e.key === ' ') {
      e.preventDefault()
      pickBy(here.dataset.tile!, e)
      return
    }
    let next: HTMLButtonElement | undefined
    if (e.key === 'ArrowRight') next = tiles[at + 1]
    else if (e.key === 'ArrowLeft') next = tiles[at - 1]
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const r = here.getBoundingClientRect()
      const x = r.left + r.width / 2
      const down = e.key === 'ArrowDown'
      const rows = tiles
        .map((t) => ({ t, r: t.getBoundingClientRect() }))
        .filter(({ r: o }) => (down ? o.top > r.bottom - 2 : o.bottom < r.top + 2))
      const row = down ? Math.min(...rows.map((o) => o.r.top)) : Math.max(...rows.map((o) => o.r.top))
      next = rows
        .filter((o) => Math.abs(o.r.top - row) < 4)
        .sort((p, q) => Math.abs(p.r.left + p.r.width / 2 - x) - Math.abs(q.r.left + q.r.width / 2 - x))[0]?.t
    } else return
    e.preventDefault()
    next?.focus()
    next?.scrollIntoView({ block: 'nearest' })
  }
  const toggle = (digest: string) =>
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(digest)) next.delete(digest)
      else next.add(digest)
      return next
    })

  return (
    <main className="min-h-[70vh] p-4" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <PageHeader
        title="Принты"
        description={
          found.rows === null
            ? `${library.data?.length ?? 0} картинок · файлы можно бросить прямо сюда`
            : `по слову «${query.trim()}» — ${items.length}, по весу`
        }
        actions={
          <div className="flex items-center gap-2">
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="снег, вертолёт, мишка…"
              aria-label="поиск по картинкам любым словом"
            />
            <button
              className={buttonClass({ tone: defects ? 'danger' : 'neutral', variant: defects ? 'soft' : 'outline' })}
              aria-pressed={defects}
              onClick={() => setDefects((v) => !v)}
              title="Забракованные картинки: в выдаче, дропах и референсах их нет"
            >
              брак
            </button>
            {/* Главное действие экрана — залитое (US-0716). Переразметка всей
                библиотеки — в «Справочниках», под подтверждением. */}
            <HotkeysHint rows={PRINTS_KEYS} label="Клавиши принтов" />
            <label className={`${buttonClass({ tone: 'accent', variant: 'solid' })} cursor-pointer`}>
              добавить файлы
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void add([...(e.target.files ?? [])])
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        }
      />
      <DropFilterBar {...drop}>
        <div className="w-52 shrink-0">
          <Select
            aria-label="решение в дропе"
            options={(Object.keys(DECISION_NAMES) as DropDecision[]).map((d) => ({
              value: d,
              label: DECISION_NAMES[d],
            }))}
            placeholder="любое решение"
            value={drop.filter.decision ?? ''}
            onChange={(e) => drop.set({ decision: (e.target.value || null) as DropDecision | null })}
          />
        </div>
      </DropFilterBar>
      <AssignBar selected={picked.size} noun={['картинка', 'картинки', 'картинок']} onAssign={assign} onClear={() => setPicked(new Set())}>

        {canDefect && !defects && <GroupDefect digests={[...picked]} onDone={() => setPicked(new Set())} />}
      </AssignBar>
      {busy && <p className="mb-2 text-sm text-muted-foreground">{busy}</p>}
      {(error || found.error) && <p className="mb-2 text-sm text-destructive">{error ?? found.error}</p>}
      {retagRunning && retag.data && (
        <div className="mb-2 rounded border border-line px-2 py-1 text-xs" role="status">
          {retagRunning
            ? `Переразметка библиотеки: ${retag.data.done} из ${retag.data.total}`
            : `Переразметка закончена: ${retag.data.done} из ${retag.data.total}`}
          {retag.data.failed.length > 0 && (
            <ul className="text-destructive">
              {retag.data.failed.map((f) => (
                <li key={f.digest}>
                  не удалось: {f.name} — {f.reason}
                </li>
              ))}
            </ul>
          )}
          {retag.data.after && (
            <div className="text-muted-foreground">
              сильных тегов в среднем:{' '}
              {Object.entries(retag.data.after)
                .map(([kind, a]) => `${kind} — было ${retag.data?.before[kind]?.['сильных тегов в среднем'] ?? '—'}, стало ${a['сильных тегов в среднем']}`)
                .join('; ')}
            </div>
          )}
        </div>
      )}

      {library.isError ? (
        <EmptyState
          title="Библиотека не пришла"
          description="Сервис не ответил. Обновите страницу; если повторится — стенд сервиса не поднят."
        />
      ) : library.isPending ? (
        <p className="text-sm text-muted-foreground">Загружаю библиотеку…</p>
      ) : library.data.length === 0 ? (
        <EmptyState title="Библиотека пуста" description="Перетащите сюда картинки или нажмите «добавить файлы» — теги и название появятся сами." />
      ) : found.rows !== null && items.length === 0 ? (
        <EmptyState title="Ничего не нашлось" description="Назовите предмет, а не настроение: «мяч», а не «весело»." />
      ) : (
        <Justified onKeyDown={onTilesKey}>
          {items.map(({ item, weight, because }) => {
            const title = item.name?.name ?? item.file_name
            const on = picked.has(item.digest)
            return (
              <JustifiedCell
                key={item.digest}
                ratio={ratioOf(item.digest)}
                caption={
                  <div className="px-0.5 pt-1 text-xs leading-tight">
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate font-medium" title={item.file_name}>
                        {title}
                      </span>
                      <Votes votes={item.votes} onVote={(v) => vote(item.digest, v)} />
                    </div>
                    <div className="mt-0.5 flex h-4 gap-1 overflow-hidden">
                      {item.tags
                        .filter((t) => t.strong)
                        .slice(0, 3)
                        .map((t) => (
                          <span key={t.code} className="shrink-0 rounded-full bg-tone-blue-soft px-1.5 leading-4" title={`тег · вес ${t.score.toFixed(2)}`}>
                            {t.name}
                          </span>
                        ))}
                    </div>
                  </div>
                }
              >
                <div
                  className={`group relative h-full w-full overflow-hidden rounded bg-muted ${on ? 'ring-2 ring-accent' : ''}`}
                >
                  <button
                    data-tile={item.digest}
                    className="h-full w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey || e.shiftKey) return pickBy(item.digest, e)
                      setOpenedToDefect(false)
                      setOpened(item.digest)
                    }}
                    aria-label={`открыть ${title}`}
                  >
                    <img
                      src={assetUrl(item.digest, 'thumb')}
                      alt={title}
                      className="h-full w-full object-cover"
                      onLoad={(e) => learnRatio(item.digest, e.currentTarget)}
                    />
                  </button>
                  <div className={`absolute left-1.5 top-1.5 ${on || picked.size > 0 ? '' : 'opacity-0 group-hover:opacity-100'}`}>
                    <Checkbox label="" aria-label={`выбрать ${title}`} checked={on} onChange={() => toggle(item.digest)} />
                  </div>
                  <StatusDot item={item} drop={drop.filter.drop} />
                  <div className="absolute bottom-1.5 right-1.5 flex gap-1 rounded bg-card/90 p-0.5 opacity-0 shadow-sm group-focus-within:opacity-100 group-hover:opacity-100">
                    <IconButton icon="search" size="xs" aria-label="открыть" title="Открыть крупно: теги, вид, дропы, где использован" onClick={() => { setOpenedToDefect(false); setOpened(item.digest) }} />
                    <IconButton
                      icon="calendar-days"
                      size="xs"
                      aria-label="в дроп"
                      title="Предложить в дроп: выделится одна эта картинка, дроп выбирается в полосе сверху"
                      onClick={() => setPicked(new Set([item.digest]))}
                    />
                    {canDefect && !item.defect && (
                      <IconButton
                        icon="ban"
                        size="xs"
                        danger
                        aria-label="в брак"
                        title="В брак — с причиной: картинка пропадёт из выдачи, дропов и новых референсов"
                        onClick={() => { setOpenedToDefect(true); setOpened(item.digest) }}
                      />
                    )}
                  </div>
                  {item.warnings.length > 0 && (
                    <span
                      className="absolute right-9 top-1.5 flex h-6 items-center rounded-full bg-tone-amber-soft px-1.5 text-xs"
                      title={item.warnings.map((w) => w.text).join('; ')}
                    >
                      ⚠
                    </span>
                  )}
                  {weight !== undefined && (
                    <span
                      className="absolute bottom-1 left-1 rounded bg-card px-1 text-xs"
                      title={because ? 'слово запроса — её тег' : 'насколько картинка про запрос относительно всей библиотеки'}
                    >
                      {because ?? `вес ${weight.toFixed(1)}`}
                    </span>
                  )}
                </div>
              </JustifiedCell>
            )
          })}
        </Justified>
      )}
      {openedItem && (
        <PrintDetails
          key={openedItem.digest}
          item={openedItem}
          defecting={openedToDefect}
          at={items.findIndex(({ item }) => item.digest === openedItem.digest)}
          total={items.length}
          onMove={(to) => {
            setOpenedToDefect(false)
            setOpened(items[to].item.digest)
          }}
          onVote={(v) => vote(openedItem.digest, v)}
          onClose={() => setOpened(null)}
        />
      )}
    </main>
  )
}

/** Картинка крупно и всё, что о ней знаем (US-0715): вид с поправкой,
 *  предупреждения, дропы, «где использован», брак, голоса; соседние —
 *  стрелками. */
function PrintDetails({
  item,
  defecting,
  at,
  total,
  onMove,
  onVote,
  onClose,
}: {
  item: LibraryItem
  defecting: boolean
  at: number
  total: number
  onMove: (to: number) => void
  onVote: (value: -1 | 0 | 1) => void
  onClose: () => void
}) {
  const canDefect = useCan(CODE, 'prints', 'mark-defect')
  const canEdit = useCan(CODE, 'prints', 'write')
  const queries = useQueryClient()
  const navigate = useNavigate()
  const [marking, setMarking] = useState(defecting)
  const [markReason, setMarkReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const refresh = () => queries.invalidateQueries({ queryKey: ['library'] })
  const fail = (e: Error) => setError(`${e.message} — повторите.`)
  const title = item.name?.name ?? item.file_name
  return (
    <Viewer
      label={`картинка ${title}`}
      title={title}
      at={Math.max(0, at)}
      total={total}
      onMove={onMove}
      onClose={onClose}
      tools={<Votes votes={item.votes} onVote={onVote} large />}
    >
      <div className="flex min-h-0 w-full">
        <div className="flex min-w-0 flex-1 items-center justify-center bg-muted p-4">
          <img src={assetUrl(item.digest, 'preview')} alt={title} className="max-h-full max-w-full object-contain" />
        </div>
        <div className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l border-line p-3 text-sm">
          <div className="text-xs text-muted-foreground">
            {item.file_name} · {item.name ? (SOURCES[item.name.source] ?? item.name.source) : 'название неизвестно'}
          </div>
          <div className="flex flex-wrap gap-1">
            {item.tags
              .filter((t) => t.strong)
              .map((t) => (
                <span key={t.code} className="rounded bg-tone-blue-soft px-1.5 text-xs" title={`вес ${t.score.toFixed(4)} · ${t.model}`}>
                  {t.name}
                </span>
              ))}
          </div>
          {item.warnings.map((w) => (
            <div key={w.kind + w.text} className="rounded bg-tone-amber-soft px-1.5 text-xs" role="note">
              {w.text}
            </div>
          ))}
          {item.kind && (
            <div className="flex flex-col items-start gap-1 text-xs text-muted-foreground">
              <div className="w-48">
                <Select
                  aria-label={`вид картинки ${title}`}
                  options={KIND_OPTIONS}
                  value={item.kind.kind}
                  disabled={!canEdit}
                  onChange={(e) => void setKind(item.digest, e.target.value).then(refresh).catch(fail)}
                />
              </div>
              <span title="вид решает, какая модель ставит теги">
                {item.kind.manual
                  ? 'вид поправлен рукой'
                  : item.kind.both
                    ? `не уверена: ещё ${KIND_OPTIONS.find((o) => o.value === item.kind?.second)?.label ?? item.kind.second} — размечена обеими`
                    : 'вид определён сам'}
              </span>
            </div>
          )}
          {item.drops.length > 0 && (
            <div className="text-xs">
              <div className="text-muted-foreground">дропы:</div>
              {item.drops.map((d) => (
                <div key={d.id}>
                  {d.name} —{' '}
                  {d.via === null ? (
                    { proposed: 'предложен', approved: 'одобрен', rejected: 'не одобрен' }[d.status ?? 'proposed'] + (d.reason ? ` («${d.reason}»)` : '')
                  ) : (
                    <button className="underline" onClick={() => navigate(`/references/${d.via}`)}>
                      через референс №{d.via}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-muted-foreground">где использован:</span>
            {item.references.length === 0 && <span className="text-muted-foreground">нигде</span>}
            {item.references.map((r) => (
              <button
                key={r.id}
                className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
                onClick={() => {
                  onClose()
                  navigate(`/references/${r.id}`, { state: { inApp: true } })
                }}
                title={r.name}
              >
                №{r.id}
              </button>
            ))}
          </div>
          {item.defect && <div className="text-xs text-destructive">{defectText(item.defect)}</div>}
          {canDefect && item.defect && (
            <button
              className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
              onClick={() => void unmarkDefect(item.digest).then(refresh).then(onClose).catch(fail)}
            >
              снять брак
            </button>
          )}
          {canDefect && !item.defect && !marking && (
            <button className={buttonClass({ tone: 'danger', variant: 'outline', small: true })} onClick={() => setMarking(true)}>
              в брак…
            </button>
          )}
          {marking && (
            <div className="flex gap-1">
              <TextInput
                value={markReason}
                onChange={(e) => setMarkReason(e.target.value)}
                placeholder="почему — обязательно"
                aria-label="причина брака"
                autoFocus
              />
              <button
                className={buttonClass({ tone: 'danger', variant: 'solid', small: true })}
                disabled={!markReason.trim()}
                onClick={() => void markDefect(item.digest, markReason.trim()).then(refresh).then(onClose).catch(fail)}
              >
                забраковать
              </button>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </Viewer>
  )
}

/** Поиск по весам с задержкой: запрос на каждую букву ни к чему. */
type Hit = { digest: string; weight: number; because: string | null }

function useWeights(query: string): { rows: Hit[] | null; error: string | null } {
  const [rows, setRows] = useState<Hit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setRows(null)
      setError(null)
      return
    }
    let stale = false
    const t = setTimeout(() => {
      searchAssets(q)
        .then((found) => {
          if (stale) return
          setRows(found.map((f) => ({ digest: f.digest, weight: f.weight, because: f.because ?? null })))
          setError(null)
        })
        .catch((e: Error) => !stale && setError(`Поиск не ответил: ${e.message}`))
    }, 350)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [query])
  return { rows, error }
}

/** Решение принта в дропе (US-0889): «через референс» считается одобренным. */
function printMatchesDecision(
  item: LibraryItem,
  decision: DropDecision | null,
  dropId: number | null,
): boolean {
  if (decision === null) return true
  const links = dropId !== null ? item.drops.filter((d) => d.id === dropId) : item.drops
  if (links.length === 0) return false
  return links.some((d) => {
    const st = d.via !== null ? 'approved' : (d.status ?? 'proposed')
    return st === decision
  })
}

/** Брак выделенным разом (US-0714): одна причина на всех, каждую — отдельно. */
function GroupDefect({ digests, onDone }: { digests: string[]; onDone: () => void }) {
  const queries = useQueryClient()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const all = counted(digests.length, 'картинка', 'картинки', 'картинок')
  if (!asking)
    return (
      <Hint text={`${all} — в брак с одной причиной: пропадут из выдачи, дропов и новых референсов; вернуть — фильтр «брак»`}>
        <button className={buttonClass({ tone: 'danger', variant: 'outline', small: true })} onClick={() => setAsking(true)}>
          в брак…
        </button>
      </Hint>
    )
  return (
    <div className="flex items-center gap-1">
      <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="почему — обязательно" aria-label="причина брака" autoFocus />
      <button
        className={buttonClass({ tone: 'danger', variant: 'solid', small: true })}
        disabled={!reason.trim()}
        onClick={() =>
          void Promise.all(digests.map((d) => markDefect(d, reason.trim())))
            .then(() => queries.invalidateQueries({ queryKey: ['library'] }))
            .then(onDone)
            .catch((e: Error) => setError(`${e.message} — повторите.`))
        }
      >
        забраковать {digests.length}
      </button>
      <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={() => setAsking(false)}>
        не надо
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
