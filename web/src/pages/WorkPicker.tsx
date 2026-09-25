// «Добавить» в рабочем окне (US-0507): что положить в референс. Три источника
// по порядку: одобренное в дропе референса, всё по этому дропу, поиск по всем —
// и с компьютера, перетаскиванием прямо сюда или на холст. Взятое не из
// одобренного помечено: «не одобрено к этому дропу». Фраза ложится надписью
// тем шрифтом, которым она уже стоит в референсах.

import { TextInput, buttonClass } from '@platform/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type DragEvent, type KeyboardEvent } from 'react'

import { assetUrl, fetchLibrary, searchAssets } from '../shared/api/assets'
import { fetchBoard, fetchDrops, type Board } from '../shared/api/drops'
import type { PrintItem } from '../shared/api/prints'
import { fetchTexts } from '../shared/api/texts'

/** Что перетаскивают из выбора на холст. */
export const PICK_TYPE = 'application/x-reference-pick'

export interface Pick {
  kind: 'image' | 'text'
  /** Хеш картинки или нормализованная надпись. */
  key: string
  title: string
  /** Одобрено к дропу референса — иначе на изделии будет отметка. */
  approved: boolean
}

type Source = 'approved' | 'drop' | 'all'

const STATUS: Record<string, string> = { proposed: 'предложено', approved: 'одобрено', rejected: 'не одобрено' }

export function WorkPicker({
  dropIds,
  prints,
  onPick,
  onFiles,
  onSetPrint,
}: {
  /** Дропы референса — от его цветомодели. Пусто — референс без дропа. */
  dropIds: number[]
  prints: PrintItem[]
  onPick: (pick: Pick) => void
  onFiles: (files: File[]) => void
  onSetPrint: (item: PrintItem) => void
}) {
  const drops = useQuery({ queryKey: ['drops'], queryFn: fetchDrops })
  const [dropId, setDropId] = useState<number | null>(dropIds[0] ?? null)
  useEffect(() => setDropId(dropIds[0] ?? null), [dropIds.join(',')])
  const board = useQuery({
    queryKey: ['drops', dropId, 'board'],
    queryFn: () => fetchBoard(dropId!),
    enabled: dropId !== null,
  })
  const [source, setSource] = useState<Source>(dropIds.length ? 'approved' : 'all')
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setAsked(query.trim()), 350)
    return () => clearTimeout(t)
  }, [query])
  const pictures = useQuery({ queryKey: ['search', asked], queryFn: () => searchAssets(asked), enabled: source === 'all' && !!asked })
  const phrases = useQuery({ queryKey: ['texts', asked], queryFn: () => fetchTexts(asked), enabled: source === 'all' && !!asked })
  // Названия картинок — из библиотеки: у найденного по смыслу только имя файла.
  const library = useQuery({ queryKey: ['library', false], queryFn: () => fetchLibrary(), enabled: source === 'all', staleTime: 60_000 })
  const titleOf = (digest: string, fallback: string) =>
    library.data?.find((i) => i.digest === digest)?.name?.name ?? fallback
  const approvedKeys = approvedIn(board.data)
  const dropName = drops.data?.find((d) => d.id === dropId)?.name

  const rows: (Pick & { status?: string; thumb?: string })[] =
    source === 'all'
      ? [
          ...(pictures.data ?? []).map((f) => ({
            kind: 'image' as const, key: f.digest, title: titleOf(f.digest, f.name), approved: approvedKeys.has(`image:${f.digest}`), thumb: f.digest,
          })),
          ...(phrases.data ?? []).map((t) => ({
            kind: 'text' as const, key: t.key, title: t.text, approved: approvedKeys.has(`text:${t.key}`),
          })),
        ]
      : [
          ...(board.data?.items ?? [])
            .filter((i) => source === 'drop' || i.status === 'approved')
            .map((i) => ({
              kind: i.kind, key: i.key, title: i.title, approved: i.status === 'approved', status: i.status,
              thumb: i.kind === 'image' ? i.key : undefined,
            })),
          ...(source === 'drop'
            ? (board.data?.via_references ?? []).map((v) => ({
                kind: v.kind, key: v.key, title: v.title, approved: false, status: `в референсе №${v.references[0]}`,
                thumb: v.kind === 'image' ? v.key : undefined,
              }))
            : []),
        ]

  /** Стрелки ходят по плитке, Enter кладёт — клавиши окна здесь молчат. */
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-pick]')]
    const at = all.indexOf(document.activeElement as HTMLButtonElement)
    const by: Record<string, number> = { ArrowDown: 2, ArrowUp: -2, ArrowRight: 1, ArrowLeft: -1 }
    if (at < 0 || !(e.key in by)) return
    e.preventDefault()
    all[Math.min(all.length - 1, Math.max(0, at + by[e.key]))]?.focus()
  }

  const drop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')))
  }
  const tab = (s: Source) => buttonClass({ tone: s === source ? 'accent' : 'neutral', variant: s === source ? 'soft' : 'outline', small: true })

  return (
    <div data-picker className="flex h-full flex-col gap-2" onDragOver={(e) => e.preventDefault()} onDrop={drop} onKeyDown={onKey}>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="откуда взять">
        <button role="tab" aria-selected={source === 'approved'} className={tab('approved')} disabled={!dropIds.length} onClick={() => setSource('approved')}>
          одобренное в дропе
        </button>
        <button role="tab" aria-selected={source === 'drop'} className={tab('drop')} disabled={!dropIds.length} onClick={() => setSource('drop')}>
          весь дроп
        </button>
        <button role="tab" aria-selected={source === 'all'} className={tab('all')} onClick={() => setSource('all')}>
          поиск по всем
        </button>
      </div>
      {dropIds.length > 1 && source !== 'all' && (
        <div className="flex flex-wrap gap-1">
          {dropIds.map((id) => (
            <button key={id} className={tab(id === dropId ? source : 'all')} onClick={() => setDropId(id)}>
              {drops.data?.find((d) => d.id === id)?.name ?? `дроп ${id}`}
            </button>
          ))}
        </div>
      )}
      {!dropIds.length && <p className="text-xs text-muted-foreground">у референса нет дропа — его цветомодель ни в одном</p>}
      {source === 'all' && (
        <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="вертолёт, снег, «С НОВЫМ 2027»…" aria-label="поиск по всей библиотеке" />
      )}
      <p className="text-xs text-muted-foreground">
        {source === 'approved' && `одобрено к «${dropName ?? '…'}» — кладётся без отметок`}
        {source === 'drop' && `всё по «${dropName ?? '…'}»: взятое не из одобренного будет отмечено`}
        {source === 'all' && (asked ? `по «${asked}»` : 'наберите слово — картинки по смыслу, фразы по словам')}
        {' · '}файл с компьютера — бросьте сюда или на изделие
      </p>

      <div className="grid gap-2 overflow-y-auto" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {rows.map((r) => (
          <button
            key={`${r.kind}-${r.key}`}
            data-pick
            draggable={r.kind === 'image'}
            onDragStart={(e) => e.dataTransfer.setData(PICK_TYPE, JSON.stringify(r))}
            onClick={() => onPick(r)}
            title={r.approved ? 'положить на изделие' : 'положить — будет отметка «не одобрено к этому дропу»'}
            className="flex flex-col items-center gap-1 rounded border border-line p-1 text-xs hover:bg-hover"
          >
            {r.thumb ? (
              <img src={assetUrl(r.thumb, 'thumb')} alt="" className="h-20 w-full object-contain" />
            ) : (
              <span className="flex h-20 w-full items-center justify-center text-center font-semibold">«{r.title}»</span>
            )}
            <span className="w-full truncate" title={r.title}>
              {r.title}
            </span>
            {(r.status || !r.approved) && (
              <span className={r.status === 'rejected' ? 'text-destructive' : 'text-muted-foreground'}>
                {r.status ? (STATUS[r.status] ?? r.status) : 'не одобрено к дропу'}
              </span>
            )}
          </button>
        ))}
      </div>
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {source === 'approved'
            ? 'К дропу пока ничего не одобрено — посмотрите «весь дроп» или найдите по всем.'
            : source === 'drop'
              ? 'В дроп ещё ничего не предлагали — предложить можно на «Принтах» и «Текстах».'
              : asked
                ? 'Ничего не нашлось — назовите предмет, а не настроение.'
                : ''}
        </p>
      )}

      {source === 'all' && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">набор стенда и эталоны</summary>
          <div className="mt-1 flex flex-col gap-1">
            {prints
              .slice()
              .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'probe' ? -1 : 1))
              .map((item) => (
                <button
                  key={item.path}
                  onClick={() => onSetPrint(item)}
                  title={[item.subject ?? item.name, item.answers].filter(Boolean).join(' — ')}
                  className="flex items-center gap-2 rounded border border-line px-2 py-1 text-left hover:bg-hover"
                >
                  <span className="flex-1 truncate">{item.subject ?? item.name}</span>
                  {item.kind === 'probe' && <span className="text-muted-foreground">эталон</span>}
                </button>
              ))}
          </div>
        </details>
      )}
    </div>
  )
}

/** Что одобрено к дропу: «вид:ключ». */
export function approvedIn(board: Board | undefined): Set<string> {
  return new Set((board?.items ?? []).filter((i) => i.status === 'approved').map((i) => `${i.kind}:${i.key}`))
}
