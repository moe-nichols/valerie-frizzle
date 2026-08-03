import { ConfirmDialog, permanentRemovalDescription } from '@renderer/components/ConfirmDialog'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useAsyncSubmit } from '@renderer/lib/useAsyncSubmit'
import { usePolling } from '@renderer/lib/usePolling'
import { useAppSelector } from '@renderer/store/hooks'
import type { RuleDescription, RuleFilterInput } from '@shared/domain'
import { useState } from 'react'

interface SubscriptionRulesProps {
  profileId: string
  topicName: string
  subscriptionName: string
}

interface RuleFormState {
  ruleName: string
  filterType: 'Sql' | 'Correlation'
  sqlExpression: string
  correlationId: string
  messageId: string
  subject: string
  sessionId: string
  contentType: string
  actionSql: string
}

const emptyRuleForm: RuleFormState = {
  ruleName: '',
  filterType: 'Sql',
  sqlExpression: '',
  correlationId: '',
  messageId: '',
  subject: '',
  sessionId: '',
  contentType: '',
  actionSql: ''
}

function describeFilter(filter: RuleFilterInput): string {
  if (filter.type === 'Sql') {
    return `SQL: ${filter.sqlExpression}`
  }
  const parts = [
    filter.correlationId && `correlationId=${filter.correlationId}`,
    filter.messageId && `messageId=${filter.messageId}`,
    filter.subject && `subject=${filter.subject}`,
    filter.sessionId && `sessionId=${filter.sessionId}`,
    filter.contentType && `contentType=${filter.contentType}`
  ].filter(Boolean)
  return `Correlation: ${parts.length > 0 ? parts.join(', ') : '(matches all)'}`
}

export function SubscriptionRules({
  profileId,
  topicName,
  subscriptionName
}: SubscriptionRulesProps): React.JSX.Element {
  const pollIntervalMs = useAppSelector((state) => state.settings.pollIntervalMs)
  const [expanded, setExpanded] = useState(false)
  const [rules, setRules] = useState<RuleDescription[]>([])
  const [error, setError] = useState<string | null>(null)

  // One state object for the whole rule form (the entityForms FieldsState pattern),
  // instead of a useState per field.
  const [form, setForm] = useState<RuleFormState>(emptyRuleForm)
  const set = <K extends keyof RuleFormState>(key: K, value: RuleFormState[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }))
  // Non-null while editing an existing rule (its name is then immutable); null = create mode.
  const [editingName, setEditingName] = useState<string | null>(null)
  const [deletingName, setDeletingName] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    const response = await window.sbAdmin.entities.rules.list(
      profileId,
      topicName,
      subscriptionName
    )
    if (response.ok) {
      setRules(response.data)
      setError(null)
    } else {
      setError(response.error.message)
    }
  }

  // Auto-refresh only while expanded, at the same cadence as the rest of the UI —
  // a collapsed rules list has nothing on screen to go stale.
  usePolling(refresh, expanded ? pollIntervalMs : null)

  async function handleToggle(): Promise<void> {
    const next = !expanded
    setExpanded(next)
    if (next) {
      await refresh()
    }
  }

  function resetForm(): void {
    setEditingName(null)
    setForm(emptyRuleForm)
  }

  function startEdit(rule: RuleDescription): void {
    setEditingName(rule.name)
    setForm({
      ...emptyRuleForm,
      ruleName: rule.name,
      actionSql: rule.action?.sqlExpression ?? '',
      ...(rule.filter.type === 'Sql'
        ? { filterType: 'Sql' as const, sqlExpression: rule.filter.sqlExpression }
        : {
            filterType: 'Correlation' as const,
            correlationId: rule.filter.correlationId ?? '',
            messageId: rule.filter.messageId ?? '',
            subject: rule.filter.subject ?? '',
            sessionId: rule.filter.sessionId ?? '',
            contentType: rule.filter.contentType ?? ''
          })
    })
  }

  const ruleForm = useAsyncSubmit(
    () => {
      const filter: RuleFilterInput =
        form.filterType === 'Sql'
          ? { type: 'Sql', sqlExpression: form.sqlExpression }
          : {
              type: 'Correlation',
              correlationId: form.correlationId || undefined,
              messageId: form.messageId || undefined,
              subject: form.subject || undefined,
              sessionId: form.sessionId || undefined,
              contentType: form.contentType || undefined
            }
      const input = {
        topicName,
        subscriptionName,
        name: form.ruleName,
        filter,
        action: form.actionSql.trim() ? { sqlExpression: form.actionSql.trim() } : undefined
      }
      return editingName
        ? window.sbAdmin.entities.rules.update(profileId, input)
        : window.sbAdmin.entities.rules.create(profileId, input)
    },
    async () => {
      resetForm()
      await refresh()
    }
  )

  async function handleDelete(name: string): Promise<void> {
    const response = await window.sbAdmin.entities.rules.delete(
      profileId,
      topicName,
      subscriptionName,
      name
    )
    if (response.ok) {
      await refresh()
    } else {
      setError(response.error.message)
    }
  }

  return (
    <Collapsible open={expanded} onOpenChange={() => handleToggle()} className="ml-6">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm">
          {expanded ? 'Hide rules' : 'Show rules'}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-6 space-y-3 pt-2">
        {error && <p className="text-destructive text-sm">{error}</p>}
        <ul className="space-y-1">
          {rules.map((rule) => (
            <li key={rule.name} className="flex items-center gap-2 text-sm">
              <span>
                {rule.name} — {describeFilter(rule.filter)}
                {rule.action && ` → action: ${rule.action.sqlExpression}`}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => startEdit(rule)}
              >
                Edit
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setDeletingName(rule.name)}>
                Delete
              </Button>
            </li>
          ))}
          {rules.length === 0 && <li className="text-muted-foreground text-sm">No rules yet.</li>}
        </ul>
        <form onSubmit={ruleForm.submit} className="max-w-md space-y-3">
          {ruleForm.error && (
            <Alert variant="destructive">
              <AlertDescription>{ruleForm.error}</AlertDescription>
            </Alert>
          )}
          {editingName && (
            <p className="text-muted-foreground text-sm">Editing rule “{editingName}”.</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`rule-name-${topicName}-${subscriptionName}`}>Rule name</Label>
            <Input
              id={`rule-name-${topicName}-${subscriptionName}`}
              value={form.ruleName}
              onChange={(event) => set('ruleName', event.target.value)}
              disabled={editingName !== null}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Filter type</Label>
            <Select
              value={form.filterType}
              onValueChange={(value) => set('filterType', value as 'Sql' | 'Correlation')}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Sql">SQL</SelectItem>
                <SelectItem value="Correlation">Correlation</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.filterType === 'Sql' ? (
            <div className="space-y-1.5">
              <Label htmlFor={`sql-expression-${topicName}-${subscriptionName}`}>
                SQL expression
              </Label>
              <Input
                id={`sql-expression-${topicName}-${subscriptionName}`}
                value={form.sqlExpression}
                onChange={(event) => set('sqlExpression', event.target.value)}
                placeholder="sys.Label = 'urgent'"
                required
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`correlation-id-${topicName}-${subscriptionName}`}>
                  Correlation ID
                </Label>
                <Input
                  id={`correlation-id-${topicName}-${subscriptionName}`}
                  value={form.correlationId}
                  onChange={(event) => set('correlationId', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`message-id-${topicName}-${subscriptionName}`}>Message ID</Label>
                <Input
                  id={`message-id-${topicName}-${subscriptionName}`}
                  value={form.messageId}
                  onChange={(event) => set('messageId', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`subject-${topicName}-${subscriptionName}`}>Subject</Label>
                <Input
                  id={`subject-${topicName}-${subscriptionName}`}
                  value={form.subject}
                  onChange={(event) => set('subject', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`session-id-${topicName}-${subscriptionName}`}>Session ID</Label>
                <Input
                  id={`session-id-${topicName}-${subscriptionName}`}
                  value={form.sessionId}
                  onChange={(event) => set('sessionId', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`content-type-${topicName}-${subscriptionName}`}>
                  Content type
                </Label>
                <Input
                  id={`content-type-${topicName}-${subscriptionName}`}
                  value={form.contentType}
                  onChange={(event) => set('contentType', event.target.value)}
                />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`rule-action-${topicName}-${subscriptionName}`}>
              SQL action (optional)
            </Label>
            <Input
              id={`rule-action-${topicName}-${subscriptionName}`}
              value={form.actionSql}
              onChange={(event) => set('actionSql', event.target.value)}
              placeholder="SET sys.Label = 'HANDLED'"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={ruleForm.submitting}>
              {editingName ? 'Save rule' : 'Add rule'}
            </Button>
            {editingName && (
              <Button type="button" variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
            )}
          </div>
        </form>
        <ConfirmDialog
          open={deletingName !== null}
          onOpenChange={(nextOpen) => !nextOpen && setDeletingName(null)}
          title="Delete rule?"
          description={permanentRemovalDescription(deletingName ?? '')}
          onConfirm={() => {
            if (!deletingName) return
            const name = deletingName
            setDeletingName(null)
            void handleDelete(name)
          }}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}
