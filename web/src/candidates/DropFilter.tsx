// Фильтр «дроп · адресат · вид одежды» и назначение выбранным (US-0497).
//
// Select платформы растягивается во всю ширину (w-full): в строку их ставит
// обёртка фиксированной ширины, иначе выборы встают друг над другом.
//
// Кандидат в набор платформы (решение 0005) только раскладкой: сами выборы —
// Select из @platform/ui, а смысл (дропы, адресаты) — наш. Один и тот же на
// «Референсах», «Принтах», «Текстах», «Изделиях»: разные фильтры на соседних
// страницах учат, что фильтр — не то же, что на соседней.

import { Hint, Select, buttonClass, counted } from '@platform/ui'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { fetchCatalogue, fetchDrops, type TreeNode } from '../shared/api/drops'
import { AUDIENCE_NAMES, type Audience, type DropFilter } from '../shared/filters'

const AUDIENCE_OPTIONS = (Object.keys(AUDIENCE_NAMES) as Audience[]).map((a) => ({ value: a, label: AUDIENCE_NAMES[a] }))

function categoriesOf(nodes: TreeNode[]): string[] {
  const out = new Set<string>()
  const walk = (n: TreeNode) => {
    if (n.level === 'category') out.add(n.name)
    n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return [...out].sort()
}

export function DropFilterBar({
  filter,
  set,
  reset,
  count,
  children,
}: {
  filter: DropFilter
  set: (patch: Partial<DropFilter>) => void
  reset: () => void
  count: number
  /** Свои отборы экрана — в том же ряду, что дроп, адресат и вид одежды. */
  children?: ReactNode
}) {
  const drops = useQuery({ queryKey: ['drops'], queryFn: fetchDrops })
  const tree = useQuery({ queryKey: ['catalogue'], queryFn: fetchCatalogue })
  // Погашенный в выборе не предлагается; стоит в адресе — виден, с отметкой.
  const dropOptions = (drops.data ?? [])
    .filter((d) => !d.retired || d.id === filter.drop)
    .map((d) => ({ value: String(d.id), label: d.retired ? `${d.name} · погашен` : d.name }))
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="фильтр по дропу, адресату и виду одежды">
      <div className="w-52 shrink-0">
<Select
        aria-label="дроп"
        options={dropOptions}
        placeholder="все дропы"
        value={filter.drop !== null ? String(filter.drop) : ''}
        onChange={(e) => set({ drop: e.target.value ? Number(e.target.value) : null })}
      />
</div>
      <div className="w-52 shrink-0">
<Select
        aria-label="адресат"
        options={AUDIENCE_OPTIONS}
        placeholder="любой адресат"
        value={filter.audience ?? ''}
        onChange={(e) => set({ audience: (e.target.value || null) as Audience | null })}
      />
</div>
      <div className="w-52 shrink-0">
<Select
        aria-label="вид одежды"
        options={categoriesOf(tree.data ?? []).map((c) => ({ value: c, label: c }))}
        placeholder="любой вид одежды"
        value={filter.category ?? ''}
        onChange={(e) => set({ category: e.target.value || null })}
      />
</div>
      {children}
      {count > 0 && (
        <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={reset}>
          сбросить ({count})
        </button>
      )}
    </div>
  )
}

/** Предложить выбранные в дроп или назначить им адресата — нескольким разом.
 *  В дропе они ждут решения на его доске (US-0506). */
/** Полоса выделенного (US-0714): сколько выделено и что с ними можно
 *  сделать — словами, и у каждого действия подсказка, что случится со всеми N.
 *  `noun` — три формы («картинка, картинки, картинок»); `children` — действия
 *  страницы сверх общих (у принтов — брак). */
export function AssignBar({
  selected,
  noun,
  onAssign,
  onClear,
  children,
}: {
  selected: number
  noun: readonly [string, string, string]
  onAssign: (what: { drop_id?: number; audience?: Audience }) => void
  onClear: () => void
  children?: ReactNode
}) {
  const drops = useQuery({ queryKey: ['drops'], queryFn: fetchDrops })
  const [drop, setDrop] = useState('')
  const [audience, setAudience] = useState('')
  if (selected === 0) return null
  const small = buttonClass({ tone: 'accent', variant: 'outline', small: true })
  const all = counted(selected, ...noun)
  const dropName = drops.data?.find((d) => String(d.id) === drop)?.name
  return (
    <div className="pf-card mb-3 flex flex-wrap items-center gap-2 border border-line p-2 text-sm" role="region" aria-label="действия с выделенным">
      <span className="font-semibold">выделено: {all}</span>
      <div className="w-52 shrink-0">
        <Select
          aria-label="дроп для назначения"
          options={(drops.data ?? []).filter((d) => !d.retired).map((d) => ({ value: String(d.id), label: d.name }))}
          placeholder="дроп…"
          value={drop}
          onChange={(e) => setDrop(e.target.value)}
        />
      </div>
      <Hint
        text={
          dropName
            ? `${all} — предложением в дроп «${dropName}»: одобрит или отклонит главный редактор на странице дропа`
            : 'Сначала выберите дроп слева'
        }
      >
        <button className={small} disabled={!drop} onClick={() => onAssign({ drop_id: Number(drop) })}>
          предложить в дроп
        </button>
      </Hint>
      <div className="w-52 shrink-0">
        <Select aria-label="адресат для назначения" options={AUDIENCE_OPTIONS} placeholder="адресат…" value={audience} onChange={(e) => setAudience(e.target.value)} />
      </div>
      <Hint
        text={
          audience
            ? `${all} получат адресата «${AUDIENCE_NAMES[audience as Audience]}»: по нему их находит отбор «адресат» на витрине и здесь`
            : 'Сначала выберите адресата слева'
        }
      >
        <button className={small} disabled={!audience} onClick={() => onAssign({ audience: audience as Audience })}>
          назначить адресата
        </button>
      </Hint>
      {children}
      <Hint text="Ничего не меняется — только снимается выделение">
        <button className={`${buttonClass({ tone: 'neutral', variant: 'outline', small: true })} ml-auto`} onClick={onClear}>
          снять выделение
        </button>
      </Hint>
    </div>
  )
}
