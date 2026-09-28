// Справочники: пока — люди и их роли в согласовании (решение 0016). Роль и
// ФИО ведёт приложение: у администратора платформы «все права», и понизить
// их до роли нельзя, а в согласовании он бывает дизайнером в одной работе и
// редактором в другой. Доступ по-прежнему у платформы.

import { EmptyState, PageHeader, Select, TextInput, buttonClass } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { CODE } from '../app/shell'
import { useCan, WITHOUT_PLATFORM } from '../shared/api/platform'
import { fetchPeople, ROLE_NAMES, setRole, type Person, type Role } from '../shared/api/people'

const ROLE_OPTIONS = (Object.keys(ROLE_NAMES) as Role[]).map((r) => ({ value: r, label: ROLE_NAMES[r] }))

export function Dictionaries() {
  const people = useQuery({ queryKey: ['people'], queryFn: fetchPeople })
  const canEdit = useCan(CODE, 'dictionaries', 'write')
  return (
    <div className="p-4">
      <PageHeader title="Справочники" description="Люди и роли в согласовании: кто дизайнер, кто редактор. Доступ к разделам — в платформе." />
      {people.isError && <p className="text-sm text-destructive">{(people.error as Error).message}</p>}
      {people.isPending && <p className="text-sm text-muted-foreground">Загружаю людей…</p>}
      {people.data?.length === 0 && (
        <EmptyState title="Людей пока нет" description="Люди приходят из платформы, когда им дают доступ к «Референсу»." />
      )}
      <div className="flex max-w-3xl flex-col gap-1">
        {people.data?.map((p) => <PersonRow key={p.id} person={p} canEdit={canEdit} />)}
        {canEdit && <NewPerson />}
      </div>
    </div>
  )
}

function PersonRow({ person, canEdit }: { person: Person; canEdit: boolean }) {
  const queries = useQueryClient()
  const [name, setName] = useState(person.full_name ?? '')
  const [role, setRoleValue] = useState<Role | ''>(person.role ?? '')
  const [error, setError] = useState<string | null>(null)
  const dirty = name !== (person.full_name ?? '') || role !== (person.role ?? '')
  const save = () =>
    role &&
    void setRole(person.id, name, role)
      .then(() => {
        setError(null)
        return queries.invalidateQueries({ queryKey: ['people'] })
      })
      .catch((e: Error) => setError(e.message))
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-line px-2 py-1 text-sm">
      <div className="w-64">
        <TextInput
          aria-label={`ФИО ${person.display_name}`}
          value={name}
          placeholder={`ФИО или ФИ — сейчас «${person.display_name}»`}
          disabled={!canEdit}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && dirty && save()}
        />
      </div>
      <div className="w-44">
        <Select
          aria-label={`роль ${person.display_name}`}
          options={ROLE_OPTIONS}
          placeholder="роль не назначена"
          value={role}
          disabled={!canEdit}
          onChange={(e) => setRoleValue(e.target.value as Role)}
        />
      </div>
      {!person.access && <span className="text-xs text-warning">нет доступа</span>}
      {canEdit && dirty && role && (
        <button className={buttonClass({ tone: 'accent', variant: 'outline', small: true })} onClick={save}>
          записать
        </button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

/** Завести человека вручную — только на стенде без платформы: там людей из
 *  платформы нет, а согласованию нужны двое и больше. За платформой люди
 *  приходят сами, по доступу. */
function NewPerson() {
  const queries = useQueryClient()
  const [name, setName] = useState('')
  const [role, setRoleValue] = useState<Role>('designer')
  const [error, setError] = useState<string | null>(null)
  if (!WITHOUT_PLATFORM) return null
  const add = () =>
    void setRole(`stand-${Date.now().toString(36)}`, name, role)
      .then(() => {
        setName('')
        setError(null)
        return queries.invalidateQueries({ queryKey: ['people'] })
      })
      .catch((e: Error) => setError(e.message))
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <div className="w-64">
        <TextInput aria-label="ФИО нового человека" value={name} placeholder="ФИО нового человека стенда"
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && add()} />
      </div>
      <div className="w-44">
        <Select aria-label="роль нового человека" options={ROLE_OPTIONS} value={role} onChange={(e) => setRoleValue(e.target.value as Role)} />
      </div>
      <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} disabled={!name.trim()} onClick={add}>
        завести
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
