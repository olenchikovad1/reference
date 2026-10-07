import { Hint, TextInput } from '@platform/ui'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { passTo, STATUS_NAMES, fetchAgendaOf, unpropose as unproposeDiscussion, type ReferenceFull as FullCard } from '../../shared/api/references'
import { fetchPeople } from '../../shared/api/people'
import { meaningClass } from '../../candidates/meaning'

import { Section } from './controls'

/** Исполнитель референса (US-0509): кто делает работу — и передать её
 *  дизайнеру, набрав часть ФИО. Передача видна строкой истории. */
export function ExecutorSection({ card, onChanged }: { card: FullCard; onChanged: (card: FullCard) => void }) {
  const people = useQuery({ queryKey: ['people'], queryFn: fetchPeople })
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const q = query.trim().toLowerCase()
  const designers = (people.data ?? []).filter(
    // Без доступа к приложению не предлагается: работу он не откроет.
    (p) => p.role === 'designer' && p.access && p.id !== card.executor?.id && p.display_name.toLowerCase().includes(q),
  )
  const when = (at: string) => new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <Section title="Исполнитель">
      <div className="flex flex-col gap-1 text-xs">
        <div>
          {card.executor ? card.executor.name : 'не назначен'}
          {card.executor && !card.executor.access && <span className="ml-1 text-warning">· нет доступа — передайте работу</span>}
        </div>
        <TextInput
          aria-label="передать работу: ФИО дизайнера"
          value={query}
          placeholder="передать: начните ФИО дизайнера"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {q &&
          designers.slice(0, 6).map((p) => (
            <button
              key={p.id}
              className={meaningClass('act', true)}
              onClick={() =>
                void passTo(card.id, p.id)
                  .then((transfers) => {
                    setQuery('')
                    setError(null)
                    onChanged({ ...card, executor: { id: p.id, name: p.display_name, access: p.access }, transfers })
                  })
                  .catch((e: Error) => setError(e.message))
              }
            >
              передать: {p.display_name}
            </button>
          ))}
        {q && designers.length === 0 && (
          <span className="text-muted-foreground">
            дизайнера с доступом и таким ФИО нет. Роль «дизайнер» дают в «Справочниках», доступ к приложению — в платформе.
          </span>
        )}
        {error && <span className="text-destructive">{error}</span>}
        {(card.transfers ?? []).map((t, i) => (
          <div key={i} className="text-muted-foreground">
            {when(t.at)}: {t.from_name ?? 'без исполнителя'} → {t.to_name}
            {t.by_name && t.by_name !== t.from_name ? ` · передал ${t.by_name}` : ''}
          </div>
        ))}
      </div>
    </Section>
  )
}

/** Согласование (US-0510): статус, шаги, доступные смотрящему, и путь по
 *  версиям. Вернуть можно только с замечанием. */
export function ReviewSection({ card }: { card: FullCard; onChanged?: (card: FullCard) => void }) {
  const status = card.status ?? 'draft'
  const [wholePath, setWholePath] = useState(false)
  const when = (at: string) => new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <Section title={`Согласование · ${STATUS_NAMES[status]}`}>
      <div className="flex flex-col gap-1 text-xs">
        {/* Путь по версиям свёрнут до двух последних шагов: он растёт с каждым
            кругом, а замечания под ним не должны уезжать вниз (US-0689).
            Решения — в полосе внизу окна (план 094). */}
        {(card.status_events ?? []).length > 2 && (
          <button className="self-start text-muted-foreground underline" onClick={() => setWholePath((v) => !v)}>
            {wholePath ? 'свернуть путь' : `весь путь · ${(card.status_events ?? []).length}`}
          </button>
        )}
        {(card.status_events ?? []).slice(wholePath ? 0 : -2).map((e, i) => (
          <div key={i} className="text-muted-foreground">
            версия {e.number} · {when(e.at)} · {e.by_name ?? 'без входа'}: {STATUS_NAMES[e.to]}
            {e.comment ? ` — «${e.comment}»` : ''}
          </div>
        ))}
      </div>
    </Section>
  )
}

/** «На повестке» (план 099): что предложили обсудить — кто, когда, что;
 *  тут же «снять с обсуждения». Пусто — блока нет. */
export function AgendaSection({ card }: { card: FullCard }) {
  const queries = useQueryClient()
  const agenda = useQuery({ queryKey: ['agenda', card.id], queryFn: () => fetchAgendaOf(card.id) })
  const [error, setError] = useState<string | null>(null)
  const rows = agenda.data ?? []
  if (rows.length === 0) return null
  const when = (at: string) => new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <Section title={`На повестке · ${rows.length}`}>
      <div className="flex flex-col gap-1 text-xs">
        {rows.map((a, i) => (
          <div key={i} className="rounded border border-warning/40 bg-warning/10 px-2 py-1">
            <div className="font-semibold">{a.reason}</div>
            <div className="text-muted-foreground">
              {a.by_name ?? 'без входа'} · {when(a.at)}
            </div>
          </div>
        ))}
        <Hint text="Убрать из повестки — обсуждать не нужно">
          <button
            className={`${meaningClass('withdraw', true, true)} self-start`}
            onClick={() =>
              void unproposeDiscussion(card.id)
                .then(() => {
                  setError(null)
                  void queries.invalidateQueries({ queryKey: ['agenda', card.id] })
                  void queries.invalidateQueries({ queryKey: ['references'] })
                  void queries.invalidateQueries({ queryKey: ['agenda-page'] })
                })
                .catch((e: Error) => setError(e.message))
            }
          >
            снять с обсуждения
          </button>
        </Hint>
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </Section>
  )
}
