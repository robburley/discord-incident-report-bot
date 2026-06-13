import { describe, expect, it } from "vitest";

import { handleInteractionShell } from "../../src/core/interaction-handler";

describe("handleInteractionShell", () => {
  it("accepts object-shaped interaction payloads", () => {
    const result = handleInteractionShell({ interaction: { type: 1 } });

    expect(result).toEqual({
      status: 200,
      body: { ok: true }
    });
  });

  it("rejects non-object interaction payloads", () => {
    const result = handleInteractionShell({ interaction: null });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "Invalid interaction payload." });
  });
});
