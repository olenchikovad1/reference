// Паспорт модели из plm рядом с работой (US-0893): бренд, поставщик, размерный
// ряд и отметки готовности — без ручного переписывания на доску.

import { useQuery } from '@tanstack/react-query'

import { fetchPlmPassport, fetchPlmStatus, plmOpenUrl, readinessLines } from '../../shared/api/plm'
import { Section } from './controls'

export function PlmPassport({ colorwayId }: { colorwayId: string }) {
  const status = useQuery({ queryKey: ['plm-status'], queryFn: fetchPlmStatus })
  const card = useQuery({
    queryKey: ['plm-passport', colorwayId],
    queryFn: () => fetchPlmPassport(colorwayId),
    enabled: Boolean(colorwayId),
  })
  if (card.isPending) {
    return (
      <Section title="Паспорт plm">
        <p className="text-xs text-muted-foreground">Загружаю…</p>
      </Section>
    )
  }
  if (card.isError || !card.data) {
    return (
      <Section title="Паспорт plm">
        <p className="text-xs text-muted-foreground">{(card.error as Error | undefined)?.message ?? 'нет данных'}</p>
      </Section>
    )
  }
  const p = card.data
  const open = plmOpenUrl(status.data?.web_url, p.plm_path)
  return (
    <Section title="Паспорт plm">
      <dl className="space-y-1 text-xs">
        <div>
          <dt className="text-muted-foreground">бренд</dt>
          <dd>{p.brand ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">поставщик</dt>
          <dd>{p.suppliers.length ? p.suppliers.join(', ') : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">размерный ряд</dt>
          <dd>{p.size_range ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">артикул</dt>
          <dd>
            {p.style_code}
            {p.article ? ` · ${p.article}` : ''}
          </dd>
        </div>
      </dl>
      <ul className="mt-2 space-y-0.5 text-xs">
        {readinessLines(p.readiness).map((row) => (
          <li key={row.label}>
            {row.label}: <strong>{row.state}</strong>
          </li>
        ))}
      </ul>
      {open && (
        <a className="mt-2 inline-block text-xs underline" href={open} target="_blank" rel="noreferrer">
          открыть в PLM
        </a>
      )}
    </Section>
  )
}

export function plmColorwayFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('plm_colorway')
}
