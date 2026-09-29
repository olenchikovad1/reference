// «Нравится» и «не нравится» у принта или надписи (US-0715): число тех и
// других и свой голос; второе нажатие того же — снять. Мнение, а не решение:
// в дроп берут одобрением. Кандидат в платформу (решение 0005).

import { Hint } from '@platform/ui'

import type { Votes as VotesData } from '../shared/api/assets'
import { ThumbsUp } from './ThumbsUp'

export function Votes({
  votes,
  onVote,
  large = false,
}: {
  votes: VotesData
  /** +1, −1 или 0 — снять свой голос. */
  onVote: (value: -1 | 0 | 1) => void
  large?: boolean
}) {
  const size = large ? 18 : 13
  const pad = large ? 'px-2 py-1 text-sm' : 'px-1 text-xs'
  const one = (value: 1 | -1, count: number) => {
    const mine = votes.mine === value
    const tint = value > 0 ? 'text-success bg-success/15' : 'text-destructive bg-destructive/15'
    return (
      <Hint text={mine ? 'Снять свой голос' : value > 0 ? 'Нравится' : 'Не нравится'}>
        <button
          type="button"
          aria-pressed={mine}
          aria-label={`${value > 0 ? 'нравится' : 'не нравится'}: ${count}`}
          className={`flex items-center gap-1 rounded tabular-nums hover:bg-muted ${pad} ${mine ? tint : 'text-muted-foreground'}`}
          onClick={(e) => {
            e.stopPropagation()
            onVote(mine ? 0 : value)
          }}
        >
          <ThumbsUp size={size} className={value < 0 ? 'rotate-180' : undefined} />
          {count > 0 && count}
        </button>
      </Hint>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {one(1, votes.up)}
      {one(-1, votes.down)}
    </span>
  )
}
