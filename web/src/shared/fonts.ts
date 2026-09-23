// Шрифты, загруженные в систему.
//
// Только они и никакие другие: то, что видно на экране, обязано совпадать с
// тем, что уйдёт в печать. Шрифт, подтянутый с чужого сервера, этого не
// гарантирует — он может отдать другую версию начертания, и надпись поедет.
//
// У каждого названа лицензия: это заготовка проверки «лицензированность
// шрифта» из линтера, и заводить её задним числом дороже, чем назвать сразу.

export interface Font {
  readonly family: string
  readonly role: string
  readonly license: string
  /** Покрывает ли кириллицу. Без неё шрифт в набор не берётся вовсе. */
  readonly cyrillic: boolean
  readonly weights: readonly number[]
}

export const FONTS: readonly Font[] = [
  { family: 'Inter', role: 'обычный текст', license: 'SIL OFL 1.1', cyrillic: true, weights: [400, 700] },
  { family: 'Oswald', role: 'заголовок принта', license: 'SIL OFL 1.1', cyrillic: true, weights: [400, 600] },
  { family: 'Playfair Display', role: 'антиква', license: 'SIL OFL 1.1', cyrillic: true, weights: [400, 700] },
  { family: 'Caveat', role: 'рукописный', license: 'SIL OFL 1.1', cyrillic: true, weights: [400, 700] },
]

export const DEFAULT_FONT = FONTS[1]

export function findFont(family: string): Font {
  return FONTS.find((f) => f.family === family) ?? DEFAULT_FONT
}
