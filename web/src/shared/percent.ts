// Проценты в интерфейсе — только целые (владелец 29.09): «1.0e+2 %» и
// «0.64 %» не читаются. Меньше процента — «<1 %», больше ста не бывает.

export function weightText(score: number): string {
  const p = score * 100
  return p < 0.5 ? '<1 %' : `${Math.min(100, Math.round(p))} %`
}
