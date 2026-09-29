// Плитка рядами по пропорциям картинок, как в поиске картинок Яндекса
// (US-0713): в ряду все картинки одной высоты, ширина — по пропорции, ряд
// растянут по ширине экрана, дыр и пустых полей под картинкой нет.
//
// Чем отличается от `Masonry` платформы: кладка колонками читается вниз по
// колонке и переставляет картинки при каждом изменении ширины окна; здесь
// порядок — слева направо, свежие первыми, как и был. Раскладку делает
// браузер (flex с ростом по пропорции), скрипт ничего не пересчитывает.
// Кандидат в платформу (решение 0005).

import { useCallback, useState, type ReactNode } from 'react'

/** Высота ряда до растяжения, в точках: на ширине 1400 — пять-семь картинок. */
const ROW = 190

export function Justified({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2 after:block after:grow-[1000000] after:content-['']">{children}</div>
  )
}

/** Ячейка: картинка нужной пропорции и подпись под ней. Подпись одной
 *  высоты у всех — поэтому ряд остаётся ровным. */
export function JustifiedCell({ ratio, caption, children }: { ratio: number; caption?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ flexGrow: ratio, flexBasis: ratio * ROW }} className="min-w-0">
      <div className="relative w-full" style={{ paddingBottom: `${100 / ratio}%` }}>
        <div className="absolute inset-0">{children}</div>
      </div>
      {caption}
    </div>
  )
}

/** Пропорции картинок узнаются, когда миниатюра пришла: размеров в списке
 *  нет. До того — квадрат. Крайние пропорции прижаты, чтобы панорама не
 *  занимала ряд одна, а тонкая полоска не пропадала. */
export function useRatios(): [(key: string) => number, (key: string, img: HTMLImageElement) => void] {
  const [ratios, setRatios] = useState<Record<string, number>>({})
  const learn = useCallback((key: string, img: HTMLImageElement) => {
    if (!img.naturalWidth || !img.naturalHeight) return
    const r = Math.min(2.4, Math.max(0.45, img.naturalWidth / img.naturalHeight))
    setRatios((all) => (Math.abs((all[key] ?? 0) - r) < 0.01 ? all : { ...all, [key]: r }))
  }, [])
  const of = useCallback((key: string) => ratios[key] ?? 1, [ratios])
  return [of, learn]
}
