import { buttonClass } from '@platform/ui'


import { S } from './styles'

/** Ползунок показа. `hint` — что параметр делает на изделии словами, а не
 *  имя из шейдера: «гамма базы» без пояснения не говорит никому ничего. */
export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  digits,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  digits: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label style={S.slider}>
        <span style={S.numLabel}>{label}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={S.sliderValue}>{value.toFixed(digits)}</span>
      </label>
      {hint && <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function Num({
  label,
  value,
  unit = ' см',
  step = 0.1,
  digits = 1,
  onChange,
}: {
  label: string
  value: number
  unit?: string
  step?: number
  digits?: number
  onChange: (v: number) => void
}) {
  return (
    <label style={S.num}>
      <span style={S.numLabel}>{label}</span>
      <input
        type="number"
        step={step}
        value={Number(value.toFixed(digits))}
        onChange={(e) => onChange(Number(e.target.value))}
        style={S.input}
      />
      <span style={S.numUnit}>{unit}</span>
    </label>
  )
}

/** Раздел панели или служебной полосы. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <h2 className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  )
}


/** Кнопка окна: мелкая, тон — по смыслу. */
export const small = (tone: 'neutral' | 'accent' | 'danger' = 'neutral') =>
  buttonClass({ tone, variant: tone === 'accent' ? 'solid' : 'outline', small: true })
/** Кнопка-переключатель: нажатая — мягким акцентом. */
export const on = (active: boolean) => buttonClass({ tone: active ? 'accent' : 'neutral', variant: active ? 'soft' : 'outline', small: true })
