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
  children: TreeNode[]
  models: (GarmentModel & { colour_models: { id: number; colour_code: string; drops: string[] }[] })[]
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path)
  if (!r.ok) throw new Error(`справочник не ответил: ${r.status}`)
  return r.json()
}

export const fetchDrops = () => get<Drop[]>('drops')
export const fetchMatrix = (dropId: number) => get<Matrix>(`drops/${dropId}/matrix`)
export const fetchCatalogue = () => get<TreeNode[]>('catalogue')
