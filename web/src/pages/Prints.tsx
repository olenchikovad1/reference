// Страница «Принты» (US-0495): библиотека картинками, а не референсами — одна
// картинка стоит в десятке референсов. Плитка: миниатюра, название с
// источником, сильные теги с весом, «где использован». Поиск — по весам любым
// русским словом (план 071). Файлы бросаются прямо на страницу: уходят в
// библиотеку и сразу получают теги и название.

import { Checkbox, EmptyState, PageHeader, TextInput, buttonClass } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { AssignBar, DropFilterBar } from '../candidates/DropFilter'
import { passes, useDropFilter } from '../shared/filters'
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
  uploadAssets,
  UploadRefused,
  type LibraryItem,
} from '../shared/api/assets'

const SOURCES: Record<string, string> = { catalog: 'из каталога', inherited: 'как у той же картинки' }

export function Prints() {
  // Фильтр «брак»: забракованное не видно нигде, кроме него (US-0499).
  const [defects, setDefects] = useState(false)
  const library = useQuery({ queryKey: ['library', defects], queryFn: () => fetchLibrary(defects) })
  const canDefect = useCan(CODE, 'prints', 'mark-defect')
  const [marking, setMarking] = useState<string | null>(null)
  const [markReason, setMarkReason] = useState('')

  function mark(digest: string) {
    markDefect(digest, markReason.trim())
      .then(() => {
        setMarking(null)
        setMarkReason('')
        return queries.invalidateQueries({ queryKey: ['library'] })
      })
      .catch((e: Error) => setError(`${e.message} — повторите.`))
  }
  const queries = useQueryClient()
  const navigate = useNavigate()
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
  const items: { item: LibraryItem; weight?: number }[] = (
    found.rows === null
      ? (library.data ?? []).map((item) => ({ item }))
      : found.rows.flatMap((f) => {
          const item = library.data?.find((i) => i.digest === f.digest)
          return item ? [{ item, weight: f.weight }] : []
        })
  ).filter(({ item }) =>
    passes({ drops: item.drops.map((d) => d.id), audiences: item.audiences.map((a) => a.code), categories: item.categories }, drop.filter),
  )

  function assign(what: { drop_id?: number; audience?: string }) {
    linkImages({ keys: [...picked], ...what })
      .then(() => {
        setPicked(new Set())
        return queries.invalidateQueries({ queryKey: ['library'] })
      })
      .catch((e: Error) => setError(`${e.message} — повторите.`))
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
            <label className={buttonClass({ tone: 'accent', variant: 'outline' })}>
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
      <DropFilterBar {...drop} />
      <AssignBar selected={picked.size} onAssign={assign} onClear={() => setPicked(new Set())} />
      {busy && <p className="mb-2 text-sm text-muted-foreground">{busy}</p>}
      {(error || found.error) && <p className="mb-2 text-sm text-destructive">{error ?? found.error}</p>}

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
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {items.map(({ item, weight }) => (
            <article key={item.digest} className="pf-card flex flex-col overflow-hidden border border-line text-sm">
              <div className="relative aspect-square bg-muted">
                <div className="absolute left-2 top-2 z-10">
                  <Checkbox
                    label=""
                    aria-label={`выбрать ${item.name?.name ?? item.file_name}`}
                    checked={picked.has(item.digest)}
                    onChange={() => toggle(item.digest)}
                  />
                </div>
                <img src={assetUrl(item.digest, 'thumb')} alt={item.name?.name ?? item.file_name} className="h-full w-full object-contain" />
                {weight !== undefined && (
                  <span className="absolute right-1 top-1 rounded bg-card px-1 text-xs" title="насколько картинка про запрос относительно всей библиотеки">
                    вес {weight.toFixed(1)}
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-2">
                <div className="truncate font-semibold" title={item.file_name}>
                  {item.name?.name ?? item.file_name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {item.name ? (SOURCES[item.name.source] ?? item.name.source) : 'название неизвестно'}
                </div>
                <div className="flex flex-wrap gap-1">
                  {item.tags
                    .filter((t) => t.strong)
                    .slice(0, 5)
                    .map((t) => (
                      <span key={t.code} className="rounded bg-tone-blue-soft px-1.5 text-xs" title={`вес ${t.score.toFixed(4)} · ${t.model}`}>
                        {t.name}
                      </span>
                    ))}
                </div>
                {drop.filter.drop !== null &&
                  item.drops
                    .filter((d) => d.id === drop.filter.drop)
                    .map((d) => (
                      <div key={d.id} className="text-xs text-muted-foreground">
                        {d.via === null ? (
                          `в дропе: ${{ proposed: 'предложен', approved: 'одобрен', rejected: 'не одобрен' }[d.status ?? 'proposed']}` +
                          (d.reason ? ` — «${d.reason}»` : '')
                        ) : (
                          <>
                            в дропе: через{' '}
                            <button className="underline" onClick={() => navigate(`/references/${d.via}`)}>
                              референс №{d.via}
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                {item.defect && <div className="text-xs text-destructive">{defectText(item.defect)}</div>}
                {canDefect && item.defect && (
                  <button
                    className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
                    onClick={() => void unmarkDefect(item.digest).then(() => queries.invalidateQueries({ queryKey: ['library'] }))}
                  >
                    снять брак
                  </button>
                )}
                {canDefect && !item.defect && marking !== item.digest && (
                  <button className={buttonClass({ tone: 'danger', variant: 'outline', small: true })} onClick={() => setMarking(item.digest)}>
                    брак
                  </button>
                )}
                {marking === item.digest && (
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
                      onClick={() => mark(item.digest)}
                    >
                      забраковать
                    </button>
                  </div>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-1 text-xs">
                  <span className="text-muted-foreground">где использован:</span>
                  {item.references.length === 0 && <span className="text-muted-foreground">нигде</span>}
                  {item.references.map((r) => (
                    <button
                      key={r.id}
                      className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
                      onClick={() => navigate(`/references/${r.id}`)}
                      title={r.name}
                    >
                      №{r.id}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  )
}

/** Поиск по весам с задержкой: запрос на каждую букву ни к чему. */
function useWeights(query: string): { rows: { digest: string; weight: number }[] | null; error: string | null } {
  const [rows, setRows] = useState<{ digest: string; weight: number }[] | null>(null)
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
          setRows(found.map((f) => ({ digest: f.digest, weight: f.weight })))
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
