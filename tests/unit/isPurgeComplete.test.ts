import { describe, expect, test } from 'vitest'
import { isPurgeComplete } from '../../src/main/services/purgeService'

describe("isPurgeComplete", () => {
  test("is not complete after zero or one empty batch", () => {
    expect(isPurgeComplete(0)).toBe(false);
    expect(isPurgeComplete(1)).toBe(false);
  });

  test("is complete after two consecutive empty batches", () => {
    expect(isPurgeComplete(2)).toBe(true);
  });

  test("stays complete for any count beyond the threshold", () => {
    expect(isPurgeComplete(3)).toBe(true);
    expect(isPurgeComplete(100)).toBe(true);
  });
});
