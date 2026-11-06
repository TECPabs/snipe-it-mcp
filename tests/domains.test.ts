import { describe, it, expect, vi } from "vitest";
import { getDomainHandler, getAllTools, DOMAINS } from "../src/domains/index.js";

// These tests call handlers with empty arguments; make sure nothing can reach a real instance.
delete process.env.SNIPEIT_URL;
delete process.env.SNIPEIT_API_TOKEN;
vi.stubGlobal(
  "fetch",
  vi.fn(async () => {
    throw new Error("network access is not allowed in tests");
  })
);

describe("domain routing", () => {
  it("routes tool names to their domain handler", async () => {
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(`snipeit_${domain}_list`);
      expect(handler, domain).not.toBeNull();
    }
  });

  it("returns null for unknown tools", async () => {
    expect(await getDomainHandler("snipeit_bogus_list")).toBeNull();
    expect(await getDomainHandler("something_else")).toBeNull();
  });

  it("exposes uniquely named tools that all match the snipeit_{domain}_{action} pattern", async () => {
    const tools = await getAllTools();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^snipeit_[a-z]+_[a-z_]+$/);
    }
  });

  it("every tool carries annotations with an explicit readOnlyHint", async () => {
    const tools = await getAllTools();
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBeTypeOf("boolean");
    }
  });

  it("every advertised tool is handled by its domain (no unknown-tool fallthrough)", async () => {
    const tools = await getAllTools();
    for (const tool of tools) {
      const handler = await getDomainHandler(tool.name);
      expect(handler, tool.name).not.toBeNull();
      // Calling with empty args must not hit the "Unknown tool" branch;
      // network/validation errors are fine and expected here.
      const result = await handler!.handleCall(tool.name, {});
      const text = result.content[0].text;
      expect(text).not.toMatch(/^Unknown/);
    }
  });
});
