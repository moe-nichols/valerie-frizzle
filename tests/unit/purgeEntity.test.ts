import { describe, expect, test } from "vitest";
import type { ReceivedMessageDescription } from "@shared/domain";
import type { MessagingService } from "../../src/main/services/messagingService.ts";
import { purgeEntity, type PurgeProgress } from "../../src/main/services/purgeService.ts";

function msg(sequenceNumber: number): ReceivedMessageDescription {
  return { sequenceNumber, body: "" };
}

/** A MessagingService stand-in whose receiveMessages returns a scripted sequence of
 * batches, then empties out. */
function fakeMessaging(batchSizes: number[]): MessagingService {
  let call = 0;
  return {
    async receiveMessages(): Promise<ReceivedMessageDescription[]> {
      const size = batchSizes[call] ?? 0;
      call++;
      return Array.from({ length: size }, (_, i) => msg(i));
    },
  } as unknown as MessagingService;
}

/** A MessagingService that never runs dry — always returns a non-empty batch, forcing the
 * drain loop to hit its iteration cap. */
function bottomlessMessaging(): MessagingService {
  return {
    async receiveMessages(): Promise<ReceivedMessageDescription[]> {
      return [msg(0)];
    },
  } as unknown as MessagingService;
}

describe("purgeEntity", () => {
  test("reports done without stoppedAtCap when the entity drains (F6)", async () => {
    const events: PurgeProgress[] = [];
    // Two non-empty batches, then empties → two consecutive empties drain it.
    await purgeEntity(fakeMessaging([2, 3, 0, 0]), "q", (p) => events.push(p));

    const terminal = events.at(-1)!;
    expect(terminal.done).toBe(true);
    expect(terminal.stoppedAtCap).toBe(false);
    expect(terminal.deletedCount).toBe(5);
  });

  test("reports stoppedAtCap when the iteration cap is hit (F6)", async () => {
    const events: PurgeProgress[] = [];
    const total = await purgeEntity(bottomlessMessaging(), "q", (p) => events.push(p));

    const terminal = events.at(-1)!;
    expect(terminal.done).toBe(true);
    expect(terminal.stoppedAtCap).toBe(true);
    // Never drained, so the reported count is a floor (whatever the cap allowed).
    expect(terminal.deletedCount).toBe(total);
    expect(total).toBeGreaterThan(0);
  });
});
