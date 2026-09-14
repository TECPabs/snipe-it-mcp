import { describe, it, expect } from "vitest";
import { compact, idOf, ok } from "../src/utils/types.js";

describe("compact", () => {
  it("drops null and empty-string fields", () => {
    expect(compact({ a: 1, b: null, c: "", d: "keep" })).toEqual({ a: 1, d: "keep" });
  });

  it("drops available_actions", () => {
    expect(compact({ id: 1, available_actions: { checkout: true } })).toEqual({ id: 1 });
  });

  it("collapses {datetime, formatted} and {date, formatted} objects", () => {
    expect(
      compact({
        created_at: { datetime: "2026-01-01 10:00:00", formatted: "Jan 1 2026" },
        purchase_date: { date: "2025-06-01", formatted: "Jun 1 2025" },
      })
    ).toEqual({ created_at: "2026-01-01 10:00:00", purchase_date: "2025-06-01" });
  });

  it("does not collapse objects that merely contain a datetime key among others", () => {
    const input = { datetime: "x", formatted: "y", extra: 1 };
    expect(compact(input)).toEqual(input);
  });

  it("flattens custom_fields to {name: value} and drops empties", () => {
    expect(
      compact({
        custom_fields: {
          "MAC Address": { field: "_snipeit_mac_1", value: "aa:bb", field_format: "MAC" },
          IMEI: { field: "_snipeit_imei_2", value: "", field_format: "ANY" },
        },
      })
    ).toEqual({ custom_fields: { "MAC Address": "aa:bb" } });
  });

  it("omits custom_fields entirely when all values are empty", () => {
    expect(
      compact({ id: 5, custom_fields: { A: { value: null }, B: { value: "" } } })
    ).toEqual({ id: 5 });
  });

  it("recurses into arrays (list rows)", () => {
    expect(compact({ rows: [{ id: 1, notes: null }, { id: 2 }] })).toEqual({
      rows: [{ id: 1 }, { id: 2 }],
    });
  });

  it("passes primitives through", () => {
    expect(compact("text")).toBe("text");
    expect(compact(42)).toBe(42);
    expect(compact(false)).toBe(false);
  });
});

describe("idOf", () => {
  it("accepts positive integers", () => {
    expect(idOf({ id: 7 })).toBe(7);
  });

  it("coerces numeric strings", () => {
    expect(idOf({ id: "12" })).toBe(12);
  });

  it("rejects non-numeric, negative, and path-like values", () => {
    expect(() => idOf({ id: "1/../../users" })).toThrow(/Invalid id/);
    expect(() => idOf({ id: -3 })).toThrow(/Invalid id/);
    expect(() => idOf({ id: 1.5 })).toThrow(/Invalid id/);
    expect(() => idOf({})).toThrow(/Invalid id/);
  });

  it("supports custom keys", () => {
    expect(idOf({ location_id: 4 }, "location_id")).toBe(4);
  });
});

describe("ok", () => {
  it("serializes compacted data", () => {
    const result = ok({ id: 1, notes: null });
    expect(JSON.parse(result.content[0].text)).toEqual({ id: 1 });
    expect(result.isError).toBeUndefined();
  });
});
