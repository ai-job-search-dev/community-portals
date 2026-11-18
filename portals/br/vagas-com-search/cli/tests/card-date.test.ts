import { describe, expect, test } from "bun:test";
import { parseCardDate } from "../src/helpers";

describe("parseCardDate", () => {
  const now = new Date(2026, 10, 18, 15, 30); // 18/11/2026, local time

  test("keeps an absolute DD/MM/YYYY date", () => {
    expect(parseCardDate("04/11/2026", now)).toBe("04/11/2026");
  });

  test("converts the relative dates recent cards show", () => {
    expect(parseCardDate("Hoje", now)).toBe("18/11/2026");
    expect(parseCardDate("Há 5 horas", now)).toBe("18/11/2026");
    expect(parseCardDate("Ontem", now)).toBe("17/11/2026");
    expect(parseCardDate("Há 1 dia", now)).toBe("17/11/2026");
    expect(parseCardDate("Há 2 dias", now)).toBe("16/11/2026");
    expect(parseCardDate("Há 20 dias", now)).toBe("29/10/2026");
  });

  test("returns null for anything it cannot read", () => {
    expect(parseCardDate("", now)).toBeNull();
    expect(parseCardDate("recentemente", now)).toBeNull();
  });
});
