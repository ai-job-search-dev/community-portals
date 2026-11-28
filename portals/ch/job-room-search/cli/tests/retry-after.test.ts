import { describe, expect, test } from "bun:test";
import { parseRetryAfter } from "../src/helpers";

describe("parseRetryAfter", () => {
  const NOW = Date.parse("2026-11-11T12:00:00Z");

  test("reads a delay given in seconds", () => {
    expect(parseRetryAfter("5", NOW)).toBe(5000);
  });

  test("reads a delay given as an HTTP date", () => {
    expect(parseRetryAfter("Wed, 11 Nov 2026 12:00:10 GMT", NOW)).toBe(10000);
  });

  test("treats a date in the past as no wait", () => {
    expect(parseRetryAfter("Wed, 11 Nov 2026 11:59:00 GMT", NOW)).toBe(0);
  });

  test("caps an excessive delay so the CLI cannot be stalled", () => {
    expect(parseRetryAfter("86400", NOW)).toBe(30000);
    expect(parseRetryAfter("Thu, 12 Nov 2026 12:00:00 GMT", NOW)).toBe(30000);
  });

  test("falls back to the backoff schedule when absent or unparseable", () => {
    expect(parseRetryAfter(null, NOW)).toBeNull();
    expect(parseRetryAfter("", NOW)).toBeNull();
    expect(parseRetryAfter("soon", NOW)).toBeNull();
  });
});
