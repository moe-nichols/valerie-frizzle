import { describe, expect, test } from 'vitest'
import { buildDeadLetterQueuePath } from '../../src/shared/domain'

describe("buildDeadLetterQueuePath", () => {
  test("appends the $DeadLetterQueue sub-queue suffix", () => {
    expect(buildDeadLetterQueuePath("orders")).toBe("orders/$DeadLetterQueue");
  });

  test("works with queue names containing hyphens and numbers", () => {
    expect(buildDeadLetterQueuePath("m8-verify-queue-12345")).toBe(
      "m8-verify-queue-12345/$DeadLetterQueue"
    );
  });
});
