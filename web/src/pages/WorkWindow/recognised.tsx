import { TextInput } from '@platform/ui'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { Match, Named, Tag } from '../../shared/api/assets'
import { assetUrl, digestOf, markDefect } from '../../shared/api/assets'
import type { ReferenceMatch } from '../../shared/api/references'
import { weightText } from '../../shared/percent'
import { meaningClass } from '../../candidates/meaning'

import { S } from './styles'

// Стили временные и нарочно скупые: визуальный язык приедет из @platform/tokens,
// и заводить здесь свой набор цветов нельзя — он потом не выполется.
export const FILE_LEVELS: Record<Match['level'], string> = {
  file: 'Этот же файл уже загружали',
  same: 'Та же картинка, файл другой',
  close: 'Похожая картинка',
}

// По чему совпал собранный принт. Формулировки разные, потому что разные и
// выводы: совпавший лист — готовый дубль, совпавший рисунок при других словах —
// РАЗНАЯ работа, совпавшая надпись при другом рисунке — почти одна и та же.
export const BY: Record<ReferenceMatch['by'], string> = {
  print: 'Такой принт уже собирали целиком',
  picture: 'Тот же рисунок, слова другие',
  slogan: 'Такая надпись уже была',
}

export interface Row {
  readonly key: string
  readonly title: string
  readonly detail: string
  readonly thumb?: string
}

export function fileRows(matches: Match[]): Row[] {
  // Сильное совпадение вверху: точное раньше похожего.
  const order: Match['level'][] = ['file', 'same', 'close']
  return [...matches]
    .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level))
    .map((m) => ({
      key: `f-${m.digest}-${m.level}`,
      title: `${FILE_LEVELS[m.level]}: ${m.name}`,
      detail:
        m.level === 'file'
          ? 'тот же файл — совпало содержимое'
          : `совпадение ${(m.similarity * 100).toFixed(0)}%`,
      thumb: m.digest,
    }))
}

export function cardDetail(m: ReferenceMatch): string {
  if (m.by === 'print') return 'совпал печатный лист — это готовый дубль'
  if (m.by === 'picture') return 'совпал рисунок, а слова другие — работа разная'
  return m.level === 'same'
    ? `надпись та же: «${m.text}»`
    : `надпись близкая: «${m.text}», совпало ${(m.similarity * 100).toFixed(0)}%`
}

export function cardRows(matches: ReferenceMatch[]): Row[] {
  return matches.map((m, i) => ({
    key: `c-${m.reference_id}-${m.by}-${i}`,
    title: `${BY[m.by]}: ${m.name || 'без имени'}`,
    detail: cardDetail(m),
  }))
}

/** Окно узнавания. Показывается ТОЛЬКО когда есть что показать. */
export function Recognised({ rows, onClose }: { rows: Row[]; onClose: () => void }) {
  return (
    <div style={S.found}>
      <div style={S.foundHead}>
        <strong>Такое у нас уже было</strong>
        <button onClick={onClose} style={S.btn}>
          закрыть
        </button>
      </div>
      {rows.map((r) => (
        <div key={r.key} style={S.foundRow}>
          {r.thumb ? (
            <img src={assetUrl(r.thumb, 'thumb')} alt="" style={S.foundThumb} />
          ) : (
            <div style={S.foundThumb} />
          )}
          <div>
            <div>{r.title}</div>
            <div style={S.dim}>{r.detail}</div>
            {/* Место под итог продаж оставлено честно пустым: продаж у нас
                пока нет, и подставлять вместо них выдумку нельзя — по ней
                начнут принимать решения. */}
            <div style={S.dim}>чем кончилось: продаж по этому ещё не собрано</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Источник названия словами. Подпись из каталога и унаследованное — разная
 *  надёжность: второе перепроверяют, и различать их надо с одного взгляда. */
export const NAME_SOURCES: Record<string, string> = { catalog: 'из каталога', inherited: 'как у той же картинки' }

/** Вес — доля слова среди десяти тысяч слов словаря, обычно от 0.0005 до
 *  0.05. Двумя знаками после запятой почти всё стало бы «0.00», поэтому —
 *  проценты с двумя значащими цифрами: «танк 0.50 %», «артиллерист 1.2 %». */

/** Теги картинки: сильные видны сразу, остальные из двадцати — по раскрытию.
 *  Вес рядом с тегом: человек сам решает, верить ли «снег 0.31 %», — границу
 *  сильных ставит машина, судит он. */
export function TagChips({ tags }: { tags: Tag[] }) {
  const [open, setOpen] = useState(false)
  const strong = tags.filter((t) => t.strong)
  const rest = tags.filter((t) => !t.strong)
  const chip = (tg: Tag, style: React.CSSProperties) => (
    <span key={tg.code} style={style} title={`вес ${tg.score.toFixed(4)} · ${tg.model}`}>
      {tg.name} <span style={S.tagScore}>{weightText(tg.score)}</span>
    </span>
  )
  return (
    <span style={S.tags}>
      {strong.map((tg) => chip(tg, S.tagChip))}
      {open && rest.map((tg) => chip(tg, S.tagWeak))}
      {rest.length > 0 && (
        <button
          style={S.tagMore}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        >
          {open ? 'свернуть' : `ещё ${rest.length}`}
        </button>
      )}
    </span>
  )
}

export function NameChip({ named }: { named: Named }) {
  const from = NAME_SOURCES[named.source] ?? named.source
  return (
    <span
      style={named.source === 'catalog' ? S.name : S.nameInherited}
      title={
        named.from_digest
          ? `Название взято у той же картинки, загруженной раньше (${named.from_digest.slice(0, 8)}…)`
          : 'Подпись принта в каталоге набора'
      }
    >
      {named.name} <span style={S.nameSource}>· {from}</span>
    </span>
  )
}

/** Забраковать картинку из окна (план 095): брак ставится в библиотеке —
 *  для всех референсов, где она есть, — с причиной; как на «Принтах». */
export function DefectPrint({ src, name }: { src: string; name: string }) {
  const queries = useQueryClient()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const send = () =>
    void markDefect(digestOf(src), reason.trim())
      .then(() => {
        setDone(reason.trim())
        setAsking(false)
        setError(null)
        void queries.invalidateQueries({ queryKey: ['library'] })
      })
      .catch((e: Error) => setError(e.message))
  if (done) return <p className="mb-2 text-xs text-destructive">«{name}» в браке: {done} — в новых референсах её не положить</p>
  return (
    <div className="mb-2 flex flex-col gap-1 text-xs">
      {!asking ? (
        <button className={`${meaningClass('destroy', true, true)} self-start`} onClick={() => setAsking(true)}>
          забраковать картинку
        </button>
      ) : (
        <div className="flex gap-1">
          <TextInput
            aria-label="почему в брак"
            autoFocus
            value={reason}
            placeholder="почему в брак — видно всем"
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && reason.trim()) send()
              if (e.key === 'Escape') setAsking(false)
            }}
          />
          <button className={meaningClass('destroy', true, true)} disabled={!reason.trim()} onClick={send}>
            в брак
          </button>
        </div>
      )}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  )
}
