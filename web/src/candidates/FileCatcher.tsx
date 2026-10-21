// Приёмник пачки файлов: бросить несколько, вставить Ctrl+V, выбрать кнопкой.
//
// Кандидат в @platform/ui: DropZone платформы — «область на один файл»
// (onFile берёт первый), а варианту коллекции нужна пачка и вставка из
// буфера — картинка из ChatGPT приходит «Копировать изображение», а не
// файлом. Предметной области не знает: что делать с файлами, решает экран.
//
// Нажатие по области её «взводит», а не открывает выбор файла: человек
// нажимает колонку, чтобы вставить Ctrl+V, и окно выбора на каждое нажатие
// мешало бы. Выбор — отдельной кнопкой внутри, она же путь с клавиатуры и с
// планшета. Подсветка при броске — счётчиком входов, а не флагом: dragleave
// приходит и при переходе на вложенный элемент.

import { buttonClass } from '@platform/ui'
import { useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'

export interface FileCatcherProps {
  /** Что делать с пачкой. Пустая пачка сюда не приходит. */
  onFiles: (files: File[]) => void
  /** Как область называется вслух: «Варианты цвета 12-2905». */
  name: string
  /** Призыв внутри области. */
  label?: ReactNode
  /** Что принимаем — уходит в поле выбора как есть. */
  accept?: string
  /** Идёт отправка: область не принимает второй пачки. */
  busy?: boolean
  /** Область «взведена» — вставка с клавиатуры уйдёт сюда; рамка ярче. */
  armed?: boolean
  /** Человек нажал или перешёл в область — экран взводит её. */
  onArm?: () => void
}

function filesOf(list: FileList | null | undefined): File[] {
  return list ? Array.from(list) : []
}

export function FileCatcher({ onFiles, name, label, accept, busy, armed, onArm }: FileCatcherProps) {
  const [over, setOver] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const give = (files: File[]) => {
    if (busy || files.length === 0) return
    onFiles(files)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(0)
    onArm?.()
    give(filesOf(e.dataTransfer?.files))
  }
  const onPaste = (e: ClipboardEvent) => {
    const files = filesOf(e.clipboardData?.files)
    if (files.length === 0) return
    e.preventDefault()
    give(files)
  }

  const lit = over > 0 || armed
  return (
    <div
      role="group"
      aria-label={name}
      aria-busy={busy || undefined}
      tabIndex={0}
      onFocus={onArm}
      onClick={onArm}
      onPaste={onPaste}
      onDragEnter={(e) => {
        e.preventDefault()
        setOver((n) => n + 1)
      }}
      onDragLeave={() => setOver((n) => Math.max(0, n - 1))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded border border-dashed p-2 text-center text-xs outline-none ${
        lit ? 'border-accent bg-muted text-foreground' : 'border-line text-muted-foreground'
      } ${busy ? 'opacity-60' : ''}`}
      title="Нажмите и вставьте Ctrl+V, перетащите файлы или выберите их"
    >
      {label}
      <button
        type="button"
        className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          onArm?.()
          input.current?.click()
        }}
      >
        выбрать файлы
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          give(filesOf(e.target.files))
          e.target.value = ''
        }}
      />
    </div>
  )
}
