// Один паспорт во всех местах: данные PLM не переписываются в справочник Reference.
import { buttonClass, Spinner, EmptyState } from '@platform/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { fetchPlmPassport, fetchPlmStatus, fetchPlmColorways, plmOpenUrl, readinessLines } from '../shared/api/plm'

export function PlmPassport({ colorwayId }: { colorwayId: string }) {
  const status = useQuery({ queryKey: ['plm-status'], queryFn: fetchPlmStatus })
  const card = useQuery({
    queryKey: ['plm-passport', colorwayId],
    queryFn: () => fetchPlmPassport(colorwayId),
    staleTime: 0,
    retry: 1,
  })
  return (
    <section aria-label="Паспорт PLM" className="space-y-2 border-t border-line py-3">
      <div className="flex items-center gap-2">
        <strong className="flex-1 text-sm">Паспорт PLM</strong>
        <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
          disabled={card.isFetching} onClick={() => void card.refetch()} title="Перечитать паспорт из PLM">обновить паспорт</button>
      </div>
      {card.isPending ? <div role="status" className="flex items-center gap-2 text-sm"><Spinner />Получаем паспорт PLM</div>
        : card.isError || !card.data ? <p role="alert" className="text-sm text-destructive">{card.error?.message ?? 'Паспорт не пришёл'}</p>
        : (() => {
          const p = card.data
          const open = plmOpenUrl(status.data?.web_url, p.plm_path)
          const files = [p.size_charts, p.patterns, p.technology, p.bom]
          return <>
            <dl className="space-y-1 text-xs">
              {[
                ['артикул', [p.style_code, p.article].filter(Boolean).join(' · ')],
                ['бренд', p.brand], ['поставщик', p.suppliers.join(', ')],
                ['категория', p.category], ['цвет', p.color], ['дроп', p.drop_code],
                ['размерный ряд', p.size_range],
              ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value || 'PLM не передал'}</dd></div>)}
              <div><dt className="text-muted-foreground">номер спецификации</dt><dd>PLM не передал</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">Размерный ряд — названия размеров. Физические мерки в сантиметрах этим паспортом не переданы.</p>
            <p className="text-xs font-medium">Готовность модели по PLM</p>
            <ul className="space-y-1 text-xs">{readinessLines(p.readiness).map((row, i) => <li key={row.label}>
              {row.label}: <strong>{row.state}</strong>
              <span className="text-muted-foreground"> · {files[i]?.length ? `документов: ${files[i]!.length}` : 'список файлов не получен'}</span>
            </li>)}</ul>
            <p className="text-xs text-muted-foreground">Отметки относятся к модели целиком и могут совпадать у разных цветов. Это сводная готовность PLM; пустой список файлов не означает, что документов в PLM нет.</p>
            {open ? <a className="inline-block text-xs underline" href={open} target="_blank" rel="noreferrer">открыть в PLM</a>
              : <p className="text-xs text-muted-foreground">PLM не передал адрес для перехода.</p>}
            {card.isFetching && <div role="status" className="flex items-center gap-2 text-xs"><Spinner />Обновляем паспорт</div>}
          </>
        })()}
    </section>
  )
}

/** Метаданные можно читать и у моделей без пригодных для рисования кадров. */
export function PlmPassportBrowser() {
  const catalog = useQuery({ queryKey: ['plm-colorways', ''], queryFn: () => fetchPlmColorways(), staleTime: 60_000, retry: 1 })
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [limit, setLimit] = useState(24)
  const query = search.trim().toLocaleLowerCase('ru')
  const found = (catalog.data ?? []).filter(c => `${c.style_code} ${c.article} ${c.title} ${c.color ?? ''}`.toLocaleLowerCase('ru').includes(query))
  return <div className="space-y-3">
    <label className="block text-sm">Модель, артикул или цвет
      <input className="pf-input mt-1 w-full" value={search} onChange={e => { setSearch(e.target.value); setLimit(24) }} />
    </label>
    {catalog.isPending && <div role="status" className="flex items-center gap-2 text-sm"><Spinner />Получаем модели PLM</div>}
    {catalog.isError && <div role="alert" className="text-sm">{catalog.error.message}{' '}
      <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={() => void catalog.refetch()}>повторить</button></div>}
    {selected ? <><button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={() => setSelected(null)}>к выбору модели</button><PlmPassport colorwayId={selected} /></>
      : <>
        {catalog.isSuccess && !found.length && <EmptyState title="Моделей не найдено" description="Измените запрос." />}
        <ul className="space-y-1">{found.slice(0, limit).map(c => <li key={c.id}>
          <button className="w-full rounded border border-line p-2 text-left text-sm hover:bg-muted" onClick={() => setSelected(c.id)} title="Открыть паспорт модели PLM">
            <strong>{c.style_code}</strong> · {c.article} · {c.color || 'цвет не передан'}
          </button>
        </li>)}</ul>
        {found.length > limit && <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
          onClick={() => setLimit(v => v + 24)}>ещё модели · показано {limit} из {found.length}</button>}
      </>}
  </div>
}
