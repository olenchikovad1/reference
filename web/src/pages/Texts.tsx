// Страница «Тексты» (US-0496): какие надписи уже были и где — чтобы не
// повторить прошлогоднее или, наоборот, взять удачное. Строка на надпись:
// написание, шрифты, в скольких референсах. Поиск по словам, а не по весам:
// «ЛЕТО 2025» находит и «ЛЕТО 2024» — похожим, с отметкой (решение 0010).
// Надпись можно завести заранее, под будущий дроп.

import { DataTable, EmptyState, PageHeader, TextInput, buttonClass, type DataColumn } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CODE } from '../app/shell'
import { useCan } from '../shared/api/platform'
import { fetchTexts, planText, type TextRow } from '../shared/api/texts'

const MATCH: Record<string, string> = { same: 'дословно', words: 'все слова', close: 'похоже' }

export function Texts() {
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState('')
  const texts = useQuery({ queryKey: ['texts', asked], queryFn: () => fetchTexts(asked) })
  const queries = useQueryClient()
  const navigate = useNavigate()
  const canPlan = useCan(CODE, 'texts', 'write')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Запрос на каждую букву ни к чему: ищем, когда рука остановилась.
  useEffect(() => {
    const t = setTimeout(() => setAsked(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  function plan() {
    const text = draft.trim()
    if (!text) return
    planText(text)
      .then(() => {
        setDraft('')
        setError(null)
        return queries.invalidateQueries({ queryKey: ['texts'] })
      })
      .catch((e: Error) => setError(`Не завелась: ${e.message} — повторите.`))
  }

  const columns: DataColumn<TextRow>[] = [
    {
      id: 'text',
      header: 'надпись',
      width: 'w-80',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="font-semibold" style={r.fonts[0] ? { fontFamily: `"${r.fonts[0]}", sans-serif` } : undefined}>
            {r.text}
          </span>
          {r.match && (
            <span className="rounded bg-tone-amber-soft px-1.5 text-xs" title={r.similarity !== null ? `похожесть ${r.similarity}` : undefined}>
              {MATCH[r.match] ?? r.match}
              {r.match === 'close' && r.similarity !== null && ` ${Math.round(r.similarity * 100)}%`}
            </span>
          )}
          {r.planned && <span className="rounded bg-tone-blue-soft px-1.5 text-xs">заведена заранее</span>}
        </span>
      ),
    },
    { id: 'fonts', header: 'шрифты', cell: (r) => (r.fonts.length ? r.fonts.join(', ') : '—') },
    {
      id: 'refs',
      header: 'референсов',
      width: 'w-64',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          <span className="tabular-nums">{r.references.length}</span>
          {r.references.map((c) => (
            <button
              key={c.id}
              className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
              onClick={() => navigate(`/references/${c.id}`)}
              title={c.name}
            >
              №{c.id}
            </button>
          ))}
        </span>
      ),
    },
  ]

  return (
    <main className="p-4">
      <PageHeader
        title="Тексты"
        description={asked ? `по словам «${asked}» — ${texts.data?.length ?? 0}` : 'надписи из референсов и заведённые заранее'}
        actions={
          <div className="flex items-center gap-2">
            <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="лето, 2025…" aria-label="поиск надписи по словам" />
            {canPlan && (
              <>
                <TextInput
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && plan()}
                  placeholder="С НОВЫМ 2027"
                  aria-label="завести надпись заранее"
                />
                <button className={buttonClass({ tone: 'accent', variant: 'outline' })} onClick={plan} disabled={!draft.trim()}>
                  завести
                </button>
              </>
            )}
          </div>
        }
      />
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      {texts.isError ? (
        <EmptyState title="Тексты не пришли" description="Сервис не ответил. Обновите страницу; если повторится — стенд сервиса не поднят." />
      ) : (
        <DataTable
          rows={texts.data ?? []}
          columns={columns}
          rowKey={(r) => r.text}
          isLoading={texts.isPending}
          pagination="off"
          empty={
            asked
              ? 'Такой надписи не было — ни дословно, ни похожей. Можно завести её заранее.'
              : 'Надписей пока нет: они появятся из сохранённых референсов, или заведите слоган заранее.'
          }
        />
      )}
    </main>
  )
}
