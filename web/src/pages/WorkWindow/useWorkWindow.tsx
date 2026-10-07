import { useWindowState } from './windowState'
import { useWindowActions } from './windowActions'
import { useWindowEffects } from './windowEffects'
import { useStandFiller } from './windowStand'

// Рабочее окно — состояние, действия и эффекты (план 114, US-0894). Три части
// зовутся по порядку, как стояли в одной функции: порядок хуков React тот же.

export function useWorkWindow() {
  const s = useWindowState()
  const a = useWindowActions(s)
  useStandFiller(s, a)
  const e = useWindowEffects(s, a)
  return { ...s, ...a, ...e }
}

export type WorkWindowState = ReturnType<typeof useWorkWindow>
