import Editor from '@monaco-editor/react'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import type { ApplicationPropertyValue, MessageEnvelope } from '@shared/domain'
import { type FormEvent, useState } from 'react'

interface MessageComposerProps {
  profileId: string
  entityPath: string
}

type BodyMode = 'text' | 'json' | 'xml'

const DEFAULT_CONTENT_TYPE_BY_MODE: Record<BodyMode, string> = {
  text: 'text/plain',
  json: 'application/json',
  xml: 'application/xml'
}

const MONACO_LANGUAGE_BY_MODE: Record<BodyMode, string> = {
  text: 'plaintext',
  json: 'json',
  xml: 'xml'
}

interface PropertyRow {
  key: string
  value: string
}

export function MessageComposer({
  profileId,
  entityPath
}: MessageComposerProps): React.JSX.Element {
  const [bodyMode, setBodyMode] = useState<BodyMode>('text')
  const [body, setBody] = useState('')
  const [contentType, setContentType] = useState('')
  const [subject, setSubject] = useState('')
  const [correlationId, setCorrelationId] = useState('')
  const [messageId, setMessageId] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [timeToLiveSeconds, setTimeToLiveSeconds] = useState('')
  const [sessionId, setSessionId] = useState('')
  // datetime-local value (local wall-clock); converted to epoch ms on send.
  const [scheduledEnqueueLocal, setScheduledEnqueueLocal] = useState('')
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sentAt, setSentAt] = useState<string | null>(null)

  function handleAddProperty(): void {
    setProperties((prev) => [...prev, { key: '', value: '' }])
  }

  function handlePropertyChange(index: number, field: keyof PropertyRow, value: string): void {
    setProperties((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

  function handleRemoveProperty(index: number): void {
    setProperties((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSend(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSending(true)
    setError(null)
    setSentAt(null)

    const applicationProperties: Record<string, ApplicationPropertyValue> = {}
    for (const row of properties) {
      if (row.key) applicationProperties[row.key] = row.value
    }

    const envelope: MessageEnvelope = {
      body,
      bodyMode,
      contentType: contentType || DEFAULT_CONTENT_TYPE_BY_MODE[bodyMode],
      subject: subject || undefined,
      correlationId: correlationId || undefined,
      messageId: messageId || undefined,
      replyTo: replyTo || undefined,
      timeToLive: timeToLiveSeconds ? Number(timeToLiveSeconds) * 1000 : undefined,
      sessionId: sessionId || undefined,
      scheduledEnqueueTime: scheduledEnqueueLocal
        ? new Date(scheduledEnqueueLocal).getTime()
        : undefined,
      applicationProperties:
        Object.keys(applicationProperties).length > 0 ? applicationProperties : undefined
    }

    const response = await window.sbAdmin.messages.send(profileId, entityPath, envelope)
    setSending(false)
    if (response.ok) {
      setSentAt(new Date().toLocaleTimeString())
    } else {
      setError(response.error.message)
    }
  }

  return (
    <form onSubmit={handleSend} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {sentAt && <p className="text-sm text-emerald-600 dark:text-emerald-400">Sent at {sentAt}</p>}

      <div className="space-y-1.5">
        <Label>Body mode</Label>
        <Select value={bodyMode} onValueChange={(value) => setBodyMode(value as BodyMode)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text">Text</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
            <SelectItem value="xml">XML</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div data-testid="message-body-editor" className="overflow-hidden rounded-md border">
        <Editor
          height="200px"
          theme="vs-dark"
          language={MONACO_LANGUAGE_BY_MODE[bodyMode]}
          value={body}
          onChange={(value) => setBody(value ?? '')}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="content-type">Content type</Label>
          <Input
            id="content-type"
            value={contentType}
            onChange={(event) => setContentType(event.target.value)}
            placeholder={DEFAULT_CONTENT_TYPE_BY_MODE[bodyMode]}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="message-subject">Label</Label>
          <Input
            id="message-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="message-correlation-id">Correlation ID</Label>
          <Input
            id="message-correlation-id"
            value={correlationId}
            onChange={(event) => setCorrelationId(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="message-id">Message ID</Label>
          <Input
            id="message-id"
            value={messageId}
            onChange={(event) => setMessageId(event.target.value)}
            placeholder="(auto-generated if blank)"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="message-reply-to">Reply to</Label>
          <Input
            id="message-reply-to"
            value={replyTo}
            onChange={(event) => setReplyTo(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="message-ttl">TTL (seconds)</Label>
          <Input
            id="message-ttl"
            type="number"
            value={timeToLiveSeconds}
            onChange={(event) => setTimeToLiveSeconds(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="message-session-id">Session ID</Label>
          <Input
            id="message-session-id"
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            placeholder="(required for session entities)"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="message-scheduled">Scheduled enqueue time</Label>
          <Input
            id="message-scheduled"
            type="datetime-local"
            value={scheduledEnqueueLocal}
            onChange={(event) => setScheduledEnqueueLocal(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Application properties</p>
        {properties.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              placeholder="key"
              value={row.key}
              onChange={(event) => handlePropertyChange(index, 'key', event.target.value)}
            />
            <Input
              placeholder="value"
              value={row.value}
              onChange={(event) => handlePropertyChange(index, 'value', event.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleRemoveProperty(index)}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={handleAddProperty}>
          Add property
        </Button>
      </div>

      <Button type="submit" disabled={sending}>
        {sending ? 'Sending…' : 'Send message'}
      </Button>
    </form>
  )
}
