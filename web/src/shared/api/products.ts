import type { SizeGrid } from '../grading'
import type { TorsoData } from '../torso'

// Клиент описания изделия.
//
// Обращения идут по тому же префиксу, что будет в платформе за шлюзом, — в
// разработке он тот же, иначе зашитый корень обнаружится только после выкладки.

const BASE = import.meta.env.VITE_API_BASE ?? '/reference/api/'

export interface Calibration {
  px_per_cm: number
  provisional: boolean
  projection: string
  derived_from: string | null
  range_if_size_unknown: number[] | null
  note: string | null
}

export interface State {
  code: string
  display_name: string
  /** precise — по нему размещают и считают; illustrative — только показ. */
  kind: 'precise' | 'illustrative'
  hood: string | null
  zipper: string | null
  frame: { width: number; height: number; sha256: string }
  silhouette: Record<string, number>
  anchors: Record<string, [number, number]>
  zones: Record<string, [number, number][]>
  lines: Record<string, [number, number][]>
  defects: string[]
}

/** Опущенный капюшон: длина капюшона по размерам из табелей Cosmic и доля,
 *  которую он закрывает, — граница расчётная, и это видно. */
export interface HoodDown {
  provisional: boolean
  source: string
  lies_share: number
  why?: string | null
  length_cm_by_size: Record<string, number>
}

export interface Product {
  /** Упрощённый объём торса. Нет — показ плоский, как раньше. */
  torso?: TorsoData | null
  /** Размерная сетка. Нет — размер меняет только поле печати. */
  size_grid?: SizeGrid | null
  /** Куда ляжет опущенный капюшон — расчётно (US-0519). */
  hood_down?: HoodDown | null
  code: string
  display_name: string
  kind: string
  size_set: { name: string; sizes: number[]; simulated: number[] }
  rendered_size: number | null
  rendered_size_assumed: number | null
  calibration: Calibration
  states: State[]
  states_absent: string[]
  print_fields: { provisional: boolean; unit: string; by_size: Record<string, Record<string, number[]>> } | null
  print_rules: {
    provisional: boolean
    method: string
    min_letter_cm: number
    warn_letter_cm: number
    min_stroke_cm: number
    max_colours: number
  } | null
}

export async function fetchProduct(code: string): Promise<Product> {
  const r = await fetch(`${BASE}products/${code}`)
  if (!r.ok) throw new Error(`Изделие ${code}: ${r.status}`)
  return (await r.json()) as Product
}

/** Изделие — одно на все карточки: в кэше запросов на всю вкладку. */
export const productQuery = (code: string) => ({
  queryKey: ['product', code],
  queryFn: () => fetchProduct(code),
  staleTime: Infinity,
})

export function frameUrl(code: string, state: string): string {
  return `${BASE}products/${code}/states/${state}/frame`
}
