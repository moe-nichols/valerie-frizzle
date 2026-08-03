import { useState, type FormEvent } from 'react'
import type { RuleDescription, RuleFilterInput } from '@shared/domain'
import { usePolling } from '@renderer/lib/usePolling'
import { useAppSelector } from '@renderer/store/hooks'
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

interface SubscriptionRulesProps {
  profileId: string
  topicName: string
  subscriptionName: string
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

  const [ruleName, setRuleName] = useState('')
  const [filterType, setFilterType] = useState<'Sql' | 'Correlation'>('Sql')
  const [sqlExpression, setSqlExpression] = useState('')
  const [correlationId, setCorrelationId] = useState('')
  const [messageId, setMessageId] = useState('')
  const [subject, setSubject] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [contentType, setContentType] = useState('')
  const [actionSql, setActionSql] = useState('')
  // Non-null while editing an existing rule (its name is then immutable); null = create mode.
  const [editingName, setEditingName] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    const response = await window.sbAdmin.entities.rules.list(profileId, topicName, subscriptionName)
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
    setRuleName('')
    setFilterType('Sql')
    setSqlExpression('')
    setCorrelationId('')
    setMessageId('')
    setSubject('')
    setSessionId('')
    setContentType('')
    setActionSql('')
  }

  function startEdit(rule: RuleDescription): void {
    setEditingName(rule.name)
    setRuleName(rule.name)
    setActionSql(rule.action?.sqlExpression ?? '')
    if (rule.filter.type === 'Sql') {
      setFilterType('Sql')
      setSqlExpression(rule.filter.sqlExpression)
    } else {
      setFilterType('Correlation')
      setCorrelationId(rule.filter.correlationId ?? '')
      setMessageId(rule.filter.messageId ?? '')
      setSubject(rule.filter.subject ?? '')
      setSessionId(rule.filter.sessionId ?? '')
      setContentType(rule.filter.contentType ?? '')
    }
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const filter: RuleFilterInput =
      filterType === 'Sql'
        ? { type: 'Sql', sqlExpression }
        : {
            type: 'Correlation',
            correlationId: correlationId || undefined,
            messageId: messageId || undefined,
            subject: subject || undefined,
            sessionId: sessionId || undefined,
            contentType: contentType || undefined
          }
    const input = {
      topicName,
      subscriptionName,
      name: ruleName,
      filter,
      action: actionSql.trim() ? { sqlExpression: actionSql.trim() } : undefined
    }
    const response = editingName
      ? await window.sbAdmin.entities.rules.update(profileId, input)
      : await window.sbAdmin.entities.rules.create(profileId, input)
    if (response.ok) {
      resetForm()
      await refresh()
    } else {
      setError(response.error.message)
    }
  }

  async function handleDelete(name: string): Promise<void> {
    const response = await window.sbAdmin.entities.rules.delete(profileId, topicName, subscriptionName, name)
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
              <Button variant="outline" size="sm" className="ml-auto" onClick={() => startEdit(rule)}>
                Edit
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleDelete(rule.name)}>
                Delete
              </Button>
            </li>
          ))}
          {rules.length === 0 && <li className="text-muted-foreground text-sm">No rules yet.</li>}
        </ul>
        <form onSubmit={handleSubmit} className="max-w-md space-y-3">
          {editingName && (
            <p className="text-muted-foreground text-sm">Editing rule “{editingName}”.</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`rule-name-${topicName}-${subscriptionName}`}>Rule name</Label>
            <Input
              id={`rule-name-${topicName}-${subscriptionName}`}
              value={ruleName}
              onChange={(event) => setRuleName(event.target.value)}
              disabled={editingName !== null}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Filter type</Label>
            <Select
              value={filterType}
              onValueChange={(value) => setFilterType(value as 'Sql' | 'Correlation')}
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
          {filterType === 'Sql' ? (
            <div className="space-y-1.5">
              <Label htmlFor={`sql-expression-${topicName}-${subscriptionName}`}>SQL expression</Label>
              <Input
                id={`sql-expression-${topicName}-${subscriptionName}`}
                value={sqlExpression}
                onChange={(event) => setSqlExpression(event.target.value)}
                placeholder="sys.Label = 'urgent'"
                required
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`correlation-id-${topicName}-${subscriptionName}`}>Correlation ID</Label>
                <Input
                  id={`correlation-id-${topicName}-${subscriptionName}`}
                  value={correlationId}
                  onChange={(event) => setCorrelationId(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`message-id-${topicName}-${subscriptionName}`}>Message ID</Label>
                <Input
                  id={`message-id-${topicName}-${subscriptionName}`}
                  value={messageId}
                  onChange={(event) => setMessageId(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`subject-${topicName}-${subscriptionName}`}>Subject</Label>
                <Input
                  id={`subject-${topicName}-${subscriptionName}`}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`session-id-${topicName}-${subscriptionName}`}>Session ID</Label>
                <Input
                  id={`session-id-${topicName}-${subscriptionName}`}
                  value={sessionId}
                  onChange={(event) => setSessionId(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`content-type-${topicName}-${subscriptionName}`}>Content type</Label>
                <Input
                  id={`content-type-${topicName}-${subscriptionName}`}
                  value={contentType}
                  onChange={(event) => setContentType(event.target.value)}
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
              value={actionSql}
              onChange={(event) => setActionSql(event.target.value)}
              placeholder="SET sys.Label = 'HANDLED'"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit">{editingName ? 'Save rule' : 'Add rule'}</Button>
            {editingName && (
              <Button type="button" variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CollapsibleContent>
    </Collapsible>
  )
}
