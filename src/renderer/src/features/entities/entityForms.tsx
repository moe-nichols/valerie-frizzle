import type {
  CreateQueueInput,
  CreateSubscriptionInput,
  CreateTopicInput,
  QueueDescription,
  SubscriptionDescription,
  TopicDescription,
  UpdateQueueInput,
  UpdateSubscriptionInput,
  UpdateTopicInput
} from '@shared/domain'
import { CheckboxField, NumberField, optionalNumber, optionalText, TextField } from './entityFields'

/**
 * Form state + field groups + converters for the queue/topic/subscription create and edit
 * dialogs. All properties are held as strings/booleans in the form and converted to the
 * `Create*Input`/`Update*Input` DTOs on submit (blank ⇒ leave unset, so the emulator applies
 * its own default on create and the value is untouched on update). Field groups take a
 * `mode` so create-only, immutable-after-creation properties (the `requires*` toggles) are
 * hidden when editing — matching what `Update*Input` actually accepts.
 */

type Mode = 'create' | 'edit'

// ---- Queue ----------------------------------------------------------------

export interface QueueFieldsState {
  maxSizeInMegabytes: string
  defaultMessageTimeToLive: string
  lockDuration: string
  requiresDuplicateDetection: boolean
  duplicateDetectionHistoryTimeWindow: string
  requiresSession: boolean
  deadLetteringOnMessageExpiration: boolean
  maxDeliveryCount: string
}

export const emptyQueueFields: QueueFieldsState = {
  maxSizeInMegabytes: '',
  defaultMessageTimeToLive: '',
  lockDuration: '',
  requiresDuplicateDetection: false,
  duplicateDetectionHistoryTimeWindow: '',
  requiresSession: false,
  deadLetteringOnMessageExpiration: false,
  maxDeliveryCount: ''
}

export function queueFieldsFromDescription(queue: QueueDescription): QueueFieldsState {
  return {
    maxSizeInMegabytes: String(queue.maxSizeInMegabytes),
    defaultMessageTimeToLive: queue.defaultMessageTimeToLive,
    lockDuration: queue.lockDuration,
    requiresDuplicateDetection: queue.requiresDuplicateDetection,
    duplicateDetectionHistoryTimeWindow: queue.duplicateDetectionHistoryTimeWindow,
    requiresSession: queue.requiresSession,
    deadLetteringOnMessageExpiration: queue.deadLetteringOnMessageExpiration,
    maxDeliveryCount: String(queue.maxDeliveryCount)
  }
}

export function toCreateQueueInput(name: string, s: QueueFieldsState): CreateQueueInput {
  return {
    name,
    maxSizeInMegabytes: optionalNumber(s.maxSizeInMegabytes),
    defaultMessageTimeToLive: optionalText(s.defaultMessageTimeToLive),
    lockDuration: optionalText(s.lockDuration),
    requiresDuplicateDetection: s.requiresDuplicateDetection || undefined,
    duplicateDetectionHistoryTimeWindow: optionalText(s.duplicateDetectionHistoryTimeWindow),
    requiresSession: s.requiresSession || undefined,
    deadLetteringOnMessageExpiration: s.deadLetteringOnMessageExpiration || undefined,
    maxDeliveryCount: optionalNumber(s.maxDeliveryCount)
  }
}

export function toUpdateQueueInput(s: QueueFieldsState): UpdateQueueInput {
  return {
    maxSizeInMegabytes: optionalNumber(s.maxSizeInMegabytes),
    defaultMessageTimeToLive: optionalText(s.defaultMessageTimeToLive),
    lockDuration: optionalText(s.lockDuration),
    duplicateDetectionHistoryTimeWindow: optionalText(s.duplicateDetectionHistoryTimeWindow),
    deadLetteringOnMessageExpiration: s.deadLetteringOnMessageExpiration,
    maxDeliveryCount: optionalNumber(s.maxDeliveryCount)
  }
}

export function QueueFields({
  idPrefix,
  mode,
  state,
  onChange
}: {
  idPrefix: string
  mode: Mode
  state: QueueFieldsState
  onChange: (next: QueueFieldsState) => void
}): React.JSX.Element {
  const set = <K extends keyof QueueFieldsState>(key: K, value: QueueFieldsState[K]): void =>
    onChange({ ...state, [key]: value })
  return (
    <div className="space-y-3">
      <NumberField
        id={`${idPrefix}-max-size`}
        label="Max size (MB)"
        value={state.maxSizeInMegabytes}
        onChange={(v) => set('maxSizeInMegabytes', v)}
        min={1}
      />
      <TextField
        id={`${idPrefix}-ttl`}
        label="Default message TTL (ISO 8601, e.g. P14D)"
        value={state.defaultMessageTimeToLive}
        onChange={(v) => set('defaultMessageTimeToLive', v)}
        placeholder="P14D"
      />
      <TextField
        id={`${idPrefix}-lock`}
        label="Lock duration (ISO 8601, e.g. PT30S)"
        value={state.lockDuration}
        onChange={(v) => set('lockDuration', v)}
        placeholder="PT30S"
      />
      <TextField
        id={`${idPrefix}-dup-window`}
        label="Duplicate detection window (ISO 8601)"
        value={state.duplicateDetectionHistoryTimeWindow}
        onChange={(v) => set('duplicateDetectionHistoryTimeWindow', v)}
        placeholder="PT10M"
      />
      <NumberField
        id={`${idPrefix}-max-delivery`}
        label="Max delivery count"
        value={state.maxDeliveryCount}
        onChange={(v) => set('maxDeliveryCount', v)}
        min={1}
      />
      <CheckboxField
        id={`${idPrefix}-dead-letter-expiry`}
        label="Dead-letter on message expiration"
        checked={state.deadLetteringOnMessageExpiration}
        onChange={(v) => set('deadLetteringOnMessageExpiration', v)}
      />
      {mode === 'create' && (
        <>
          <CheckboxField
            id={`${idPrefix}-dup-detection`}
            label="Requires duplicate detection (immutable)"
            checked={state.requiresDuplicateDetection}
            onChange={(v) => set('requiresDuplicateDetection', v)}
          />
          <CheckboxField
            id={`${idPrefix}-session`}
            label="Requires session (immutable)"
            checked={state.requiresSession}
            onChange={(v) => set('requiresSession', v)}
          />
        </>
      )}
    </div>
  )
}

// ---- Topic ----------------------------------------------------------------

export interface TopicFieldsState {
  maxSizeInMegabytes: string
  defaultMessageTimeToLive: string
  requiresDuplicateDetection: boolean
  duplicateDetectionHistoryTimeWindow: string
}

export const emptyTopicFields: TopicFieldsState = {
  maxSizeInMegabytes: '',
  defaultMessageTimeToLive: '',
  requiresDuplicateDetection: false,
  duplicateDetectionHistoryTimeWindow: ''
}

export function topicFieldsFromDescription(topic: TopicDescription): TopicFieldsState {
  return {
    maxSizeInMegabytes: String(topic.maxSizeInMegabytes),
    defaultMessageTimeToLive: topic.defaultMessageTimeToLive,
    requiresDuplicateDetection: topic.requiresDuplicateDetection,
    duplicateDetectionHistoryTimeWindow: topic.duplicateDetectionHistoryTimeWindow
  }
}

export function toCreateTopicInput(name: string, s: TopicFieldsState): CreateTopicInput {
  return {
    name,
    maxSizeInMegabytes: optionalNumber(s.maxSizeInMegabytes),
    defaultMessageTimeToLive: optionalText(s.defaultMessageTimeToLive),
    requiresDuplicateDetection: s.requiresDuplicateDetection || undefined,
    duplicateDetectionHistoryTimeWindow: optionalText(s.duplicateDetectionHistoryTimeWindow)
  }
}

export function toUpdateTopicInput(s: TopicFieldsState): UpdateTopicInput {
  return {
    maxSizeInMegabytes: optionalNumber(s.maxSizeInMegabytes),
    defaultMessageTimeToLive: optionalText(s.defaultMessageTimeToLive),
    duplicateDetectionHistoryTimeWindow: optionalText(s.duplicateDetectionHistoryTimeWindow)
  }
}

export function TopicFields({
  idPrefix,
  mode,
  state,
  onChange
}: {
  idPrefix: string
  mode: Mode
  state: TopicFieldsState
  onChange: (next: TopicFieldsState) => void
}): React.JSX.Element {
  const set = <K extends keyof TopicFieldsState>(key: K, value: TopicFieldsState[K]): void =>
    onChange({ ...state, [key]: value })
  return (
    <div className="space-y-3">
      <NumberField
        id={`${idPrefix}-max-size`}
        label="Max size (MB)"
        value={state.maxSizeInMegabytes}
        onChange={(v) => set('maxSizeInMegabytes', v)}
        min={1}
      />
      <TextField
        id={`${idPrefix}-ttl`}
        label="Default message TTL (ISO 8601, e.g. P14D)"
        value={state.defaultMessageTimeToLive}
        onChange={(v) => set('defaultMessageTimeToLive', v)}
        placeholder="P14D"
      />
      <TextField
        id={`${idPrefix}-dup-window`}
        label="Duplicate detection window (ISO 8601)"
        value={state.duplicateDetectionHistoryTimeWindow}
        onChange={(v) => set('duplicateDetectionHistoryTimeWindow', v)}
        placeholder="PT10M"
      />
      {mode === 'create' && (
        <CheckboxField
          id={`${idPrefix}-dup-detection`}
          label="Requires duplicate detection (immutable)"
          checked={state.requiresDuplicateDetection}
          onChange={(v) => set('requiresDuplicateDetection', v)}
        />
      )}
    </div>
  )
}

// ---- Subscription ---------------------------------------------------------

export interface SubscriptionFieldsState {
  lockDuration: string
  defaultMessageTimeToLive: string
  requiresSession: boolean
  deadLetteringOnMessageExpiration: boolean
  maxDeliveryCount: string
}

export const emptySubscriptionFields: SubscriptionFieldsState = {
  lockDuration: '',
  defaultMessageTimeToLive: '',
  requiresSession: false,
  deadLetteringOnMessageExpiration: false,
  maxDeliveryCount: ''
}

export function subscriptionFieldsFromDescription(
  subscription: SubscriptionDescription
): SubscriptionFieldsState {
  return {
    lockDuration: subscription.lockDuration,
    defaultMessageTimeToLive: subscription.defaultMessageTimeToLive,
    requiresSession: subscription.requiresSession,
    deadLetteringOnMessageExpiration: subscription.deadLetteringOnMessageExpiration,
    maxDeliveryCount: String(subscription.maxDeliveryCount)
  }
}

export function toCreateSubscriptionInput(
  topicName: string,
  subscriptionName: string,
  s: SubscriptionFieldsState
): CreateSubscriptionInput {
  return {
    topicName,
    subscriptionName,
    lockDuration: optionalText(s.lockDuration),
    defaultMessageTimeToLive: optionalText(s.defaultMessageTimeToLive),
    requiresSession: s.requiresSession || undefined,
    deadLetteringOnMessageExpiration: s.deadLetteringOnMessageExpiration || undefined,
    maxDeliveryCount: optionalNumber(s.maxDeliveryCount)
  }
}

export function toUpdateSubscriptionInput(s: SubscriptionFieldsState): UpdateSubscriptionInput {
  return {
    lockDuration: optionalText(s.lockDuration),
    defaultMessageTimeToLive: optionalText(s.defaultMessageTimeToLive),
    deadLetteringOnMessageExpiration: s.deadLetteringOnMessageExpiration,
    maxDeliveryCount: optionalNumber(s.maxDeliveryCount)
  }
}

export function SubscriptionFields({
  idPrefix,
  mode,
  state,
  onChange
}: {
  idPrefix: string
  mode: Mode
  state: SubscriptionFieldsState
  onChange: (next: SubscriptionFieldsState) => void
}): React.JSX.Element {
  const set = <K extends keyof SubscriptionFieldsState>(
    key: K,
    value: SubscriptionFieldsState[K]
  ): void => onChange({ ...state, [key]: value })
  return (
    <div className="space-y-3">
      <TextField
        id={`${idPrefix}-lock`}
        label="Lock duration (ISO 8601, e.g. PT30S)"
        value={state.lockDuration}
        onChange={(v) => set('lockDuration', v)}
        placeholder="PT30S"
      />
      <TextField
        id={`${idPrefix}-ttl`}
        label="Default message TTL (ISO 8601, e.g. P14D)"
        value={state.defaultMessageTimeToLive}
        onChange={(v) => set('defaultMessageTimeToLive', v)}
        placeholder="P14D"
      />
      <NumberField
        id={`${idPrefix}-max-delivery`}
        label="Max delivery count"
        value={state.maxDeliveryCount}
        onChange={(v) => set('maxDeliveryCount', v)}
        min={1}
      />
      <CheckboxField
        id={`${idPrefix}-dead-letter-expiry`}
        label="Dead-letter on message expiration"
        checked={state.deadLetteringOnMessageExpiration}
        onChange={(v) => set('deadLetteringOnMessageExpiration', v)}
      />
      {mode === 'create' && (
        <CheckboxField
          id={`${idPrefix}-session`}
          label="Requires session (immutable)"
          checked={state.requiresSession}
          onChange={(v) => set('requiresSession', v)}
        />
      )}
    </div>
  )
}
