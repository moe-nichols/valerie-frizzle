import type { MessageEnvelope, ReceivedMessageDescription } from '@shared/domain'
import type { MessagingService } from './messagingService'

/**
 * The SDK has no native "move a DLQ message back to its origin" operation, so this
 * clones the message's resend-worthy properties into a fresh envelope. DLQ-only fields
 * (deadLetterReason/deadLetterErrorDescription, deliveryCount) are dropped simply by not
 * being part of MessageEnvelope's shape — nothing extra to strip. `bodyMode` is set to
 * 'text' since it only drives the composer's Monaco syntax highlighting and has no effect
 * on the actual wire body (see MessagingService.sendMessage, which never reads it).
 * Regenerating the MessageId (default on, exposed as a UI checkbox) avoids a silent drop
 * if duplicate detection is enabled on the destination — reusing the original id would
 * look like a dupe of whatever's already there. Passing `messageId: undefined` is enough
 * to trigger that: MessagingService.sendMessage already auto-generates one when blank.
 */
export function buildResubmitEnvelope(
  message: ReceivedMessageDescription,
  regenerateMessageId: boolean
): MessageEnvelope {
  return {
    body: message.body,
    bodyMode: 'text',
    contentType: message.contentType,
    subject: message.subject,
    correlationId: message.correlationId,
    messageId: regenerateMessageId ? undefined : message.messageId,
    replyTo: message.replyTo,
    applicationProperties: message.applicationProperties
  }
}

/**
 * Sends the resubmit envelope to the destination first, and only completes the DLQ
 * original — via its existing PeekLock handle — after the send succeeds. Never the other
 * way around: completing first and then failing to send would silently lose the message,
 * since it'd already be gone from the DLQ with nowhere else to find it.
 *
 * That ordering makes resubmit at-least-once: if the send succeeds but the subsequent
 * complete fails (e.g. the DLQ PeekLock expired while the user was reading the message),
 * the copy has already landed at the destination while the original is still in the DLQ.
 * Blindly retrying would then double-deliver, so this surfaces a distinct error making the
 * partial success explicit rather than looking like a plain failure.
 */
export async function resubmitMessage(
  messagingService: MessagingService,
  handleId: string,
  message: ReceivedMessageDescription,
  destinationEntityPath: string,
  regenerateMessageId: boolean
): Promise<void> {
  const envelope = buildResubmitEnvelope(message, regenerateMessageId)
  await messagingService.sendMessage(destinationEntityPath, envelope)
  try {
    await messagingService.completeMessage(handleId)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Message was resubmitted to "${destinationEntityPath}", but the dead-lettered original ` +
        `could not be removed (its lock may have expired): ${detail}. Do NOT resubmit it again — ` +
        `that would create a duplicate. Re-receive the DLQ and complete the leftover copy instead.`
    )
  }
}
