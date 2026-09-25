// Дропы, их ассортимент и товарная иерархия (US-0489). Справочники свои
// (решение 0013), устройство как в Cosmic и PLM.

const BASE = import.meta.env.VITE_API_BASE ?? '/reference/api/'

export interface Drop {
  id: number
  name: string
  season: string
  release_from: string
  release_to: string
  audience: string
  theme: string
  /** Погашенный: для нового референса не предлагается, но виден там, где стоит. */
  retired: boolean
}

export interface GarmentModel {
  id: number
  code: string
  name: string
  category: string
  /** Можно ли рисовать: у изделия есть кадры. Нельзя — reason говорит почему. */
  can_work: boolean
  reason?: string | null
}

export interface Cell {
  colour_model_id: number
  /** Сколько референсов на цветомодели; 0 — «ещё не нарисовано». */
  references: number
}

export interface Matrix {
  drop: Drop
  colours: { code: string; name: string; rgb?: number[] | null }[]
  rows: { model: GarmentModel; cells: Record<string, Cell> }[]
}

export interface TreeNode {
  id: number
  level: 'direction' | 'gender' | 'group' | 'category'
  name: string
  /** Адресат узла «пол»: boys, girls; у остальных пусто. */
  audience?: string | null
  children: TreeNode[]
  models: (GarmentModel & { colour_models: { id: number; colour_code: string; drops: string[]; drop_ids: number[] }[] })[]
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path)
  if (!r.ok) throw new Error(`справочник не ответил: ${r.status}`)
  return r.json()
}

export const fetchDrops = () => get<Drop[]>('drops')
export const fetchMatrix = (dropId: number) => get<Matrix>(`drops/${dropId}/matrix`)
export const fetchCatalogue = () => get<TreeNode[]>('catalogue')

/** Предложенное в дроп (US-0506): что, кем и в каком статусе. */
export interface BoardItem {
  kind: 'image' | 'text'
  key: string
  title: string
  status: 'proposed' | 'approved' | 'rejected'
  proposed_by: string | null
  proposed_by_name: string | null
  proposed_at: string
  decided_by: string | null
  decided_by_name: string | null
  decided_at: string | null
  reason: string | null
}

export interface Board {
  items: BoardItem[]
  /** Стоит в референсах дропа, но не предлагалось — одобрения само не получает. */
  via_references: { kind: 'image' | 'text'; key: string; title: string; references: number[] }[]
}

export const fetchBoard = (dropId: number) => get<Board>(`drops/${dropId}/board`)

/** Одобрить или не одобрить — у отказа причина обязательна. */
export async function decide(
  dropId: number,
  body: { kind: string; keys: string[]; status: 'approved' | 'rejected'; reason?: string },
): Promise<void> {
  const r = await fetch(`${BASE}drops/${dropId}/decisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(r.status === 422 ? 'у отказа нужна причина' : `решение не записалось: ${r.status}`)
}
