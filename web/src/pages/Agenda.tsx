// «Повестка» (план 098, 099): витрина того, что требует обсуждения на
// созвоне, — по дропам, с поводами, с теми же отборами, что на витрине.
// Встреч в приложении нет: созвоны идут в телемосте.

import { EmptyState, PageHeader } from '@platform/ui'
import { useQuery } from '@tanstack/react-query'

import { CardGrid } from '../candidates/CardGrid'
import { DropFilterBar } from '../candidates/DropFilter'
import { ReferenceCard } from '../candidates/ReferenceCard'
import { fetchAgenda, type AgendaItem, type Card } from '../shared/api/references'
import { useCards, useOpen } from '../shared/cardPages'
import { passes, useDropFilter } from '../shared/filters'

/** Повестка (план 098): витрина того, что требует обсуждения, — по дропам,
 *  с поводами на карточках, с теми же отборами, что на витрине. Встреч в
 *  приложении нет (владелец: они идут в телемосте); с повестки референс
 *  уходит решением по нему или «снять с обсуждения». */
export function Agenda() {
  const agenda = useQuery({ queryKey: ['agenda-page'], queryFn: fetchAgenda })
  const cards = useCards()
  const open = useOpen()
  const drop = useDropFilter()
  if (agenda.isError) return <p className="p-4 text-sm text-destructive">{(agenda.error as Error).message}</p>
  if (!agenda.data) return <p className="p-4 text-sm text-muted-foreground">Собираю повестку…</p>
  const when = (at: string) => new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  const rows = agenda.data
    .map((item) => ({ item, card: cards.get(item.reference_id) }))
    .filter((r): r is { item: AgendaItem; card: Card } => !!r.card)
    .filter(({ card }) =>
      passes(
        { drops: card.drop_ids, audiences: card.audience ? [card.audience] : [], categories: card.category ? [card.category] : [] },
        drop.filter,
      ),
    )
  // По дропам: референс, чья цветомодель выходит в нескольких, — в каждом.
  const groups = new Map<string, typeof rows>()
  for (const r of rows) for (const d of r.card.drops.length ? r.card.drops : ['без дропа']) groups.set(d, [...(groups.get(d) ?? []), r])
  return (
    <div className="p-4">
      <PageHeader title="Повестка" description="Что выдвинуто на обсуждение — по дропам, с поводами. Уходит с повестки, когда по референсу решили или сняли вручную." />
      <DropFilterBar {...drop} />
      {rows.length === 0 && (
        <EmptyState
          title="Обсуждать нечего"
          description="На повестку выдвигают из окна референса: «статус» → «выдвинуть на обсуждение», с поводом."
        />
      )}
      {[...groups.entries()].map(([name, list]) => (
        <section key={name} className="mb-4">
          <h2 className="mb-1 text-sm font-semibold">
            {name} · {list.length}
          </h2>
          <CardGrid>
            {list.map(({ item, card }) => (
              <div key={item.reference_id} className="grid h-64 min-w-0">
                <ReferenceCard
                  // Повод — полной строкой ниже (кто, когда, что), без краткой метки карточки.
                  card={{ ...card, agenda: [] }}
                  note={item.reasons.map((r) => ({ text: `${r.by_name ?? 'без входа'}, ${when(r.at)}: ${r.reason}`, tone: 'warning' as const }))}
                  onOpen={() => open(item.reference_id)}
                  onHover={open.warm(item.reference_id)}
                />
              </div>
            ))}
          </CardGrid>
        </section>
      ))}
    </div>
  )
}
