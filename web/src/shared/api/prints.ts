// Клиент набора принтов.

const BASE = import.meta.env.VITE_API_BASE ?? '/reference/api/'

export interface PrintItem {
  path: string
  name: string
  /** probe — эталон с вопросом, artwork — настоящий принт. */
  kind: 'probe' | 'artwork'
  subject: string | null
  answers: string | null
  /** Настоящий размер эталона на изделии, сантиметры. */
  width_cm: number | null
}

export async function fetchPrints(): Promise<PrintItem[]> {
  const r = await fetch(`${BASE}prints`)
  if (!r.ok) throw new Error(`Набор принтов: ${r.status}`)
  return (await r.json()) as PrintItem[]
}

export function printUrl(path: string): string {
  return `${BASE}prints/${path}`
}
