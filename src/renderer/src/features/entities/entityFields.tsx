import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'

/**
 * Small labelled field primitives shared by the entity create and edit dialogs, so the two
 * render identical inputs for the same property. Kept intentionally thin — they wrap the
 * existing ui/Input, ui/Checkbox, and ui/Label rather than introducing new form machinery.
 *
 * Durations are Service Bus ISO-8601 strings (e.g. `PT5M`, `P14D`); the app surfaces them
 * as raw text, matching how the Azure SDK and portal expose them.
 */

interface TextFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function TextField({ id, label, value, onChange, placeholder }: TextFieldProps): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

interface NumberFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  min?: number
  placeholder?: string
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  placeholder
}: NumberFieldProps): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

interface CheckboxFieldProps {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function CheckboxField({ id, label, checked, onChange }: CheckboxFieldProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  )
}

/** Parse a numeric form field, treating blank as "leave unset" (`undefined`). */
export function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Trim a text form field, treating blank as "leave unset" (`undefined`). */
export function optionalText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
