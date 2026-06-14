import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../../src/platform/cloudflare";

interface SigningFixture {
  readonly publicKeyHex: string;
  readonly signBody: (body: string, timestamp?: string) => Headers;
}

describe("Cloudflare interaction entrypoint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies the raw request body before returning a ping response", async () => {
    const fixture = createSigningFixture();
    const body = JSON.stringify({ type: 1 });

    const response = await worker.fetch(
      new Request("https://example.com/", {
        method: "POST",
        body,
        headers: fixture.signBody(body)
      }),
      { DISCORD_PUBLIC_KEY: fixture.publicKeyHex }
    );

    await expectJsonResponse(response, 200, { type: 1 });
  });

  it("returns 401 when signature headers are missing", async () => {
    const fixture = createSigningFixture();
    const response = await worker.fetch(
      new Request("https://example.com/", {
        method: "POST",
        body: JSON.stringify({ type: 1 })
      }),
      { DISCORD_PUBLIC_KEY: fixture.publicKeyHex }
    );

    await expectJsonResponse(response, 401, {
      error: "Invalid request signature."
    });
  });

  it("rejects oversized request bodies before signature verification", async () => {
    const fixture = createSigningFixture();
    const body = "x".repeat(64 * 1024 + 1);

    const response = await worker.fetch(
      new Request("https://example.com/", {
        method: "POST",
        body,
        headers: fixture.signBody(body)
      }),
      { DISCORD_PUBLIC_KEY: fixture.publicKeyHex }
    );

    await expectJsonResponse(response, 413, {
      error: "Request body too large."
    });
  });

  it("returns 401 when the signature does not match the raw body", async () => {
    const fixture = createSigningFixture();
    const signedBody = JSON.stringify({ type: 1 });
    const sentBody = JSON.stringify({ type: 2 });

    const response = await worker.fetch(
      new Request("https://example.com/", {
        method: "POST",
        body: sentBody,
        headers: fixture.signBody(signedBody)
      }),
      { DISCORD_PUBLIC_KEY: fixture.publicKeyHex }
    );

    await expectJsonResponse(response, 401, {
      error: "Invalid request signature."
    });
  });

  it("returns 401 when the signed timestamp is stale", async () => {
    const fixture = createSigningFixture();
    const body = JSON.stringify({ type: 1 });

    const response = await worker.fetch(
      new Request("https://example.com/", {
        method: "POST",
        body,
        headers: fixture.signBody(body, timestampSecondsFromNow(-301))
      }),
      { DISCORD_PUBLIC_KEY: fixture.publicKeyHex }
    );

    await expectJsonResponse(response, 401, {
      error: "Invalid request signature."
    });
  });

  it("returns 401 when the signed timestamp is too far in the future", async () => {
    const fixture = createSigningFixture();
    const body = JSON.stringify({ type: 1 });

    const response = await worker.fetch(
      new Request("https://example.com/", {
        method: "POST",
        body,
        headers: fixture.signBody(body, timestampSecondsFromNow(301))
      }),
      { DISCORD_PUBLIC_KEY: fixture.publicKeyHex }
    );

    await expectJsonResponse(response, 401, {
      error: "Invalid request signature."
    });
  });

  it("returns 401 when the signed timestamp is malformed", async () => {
    const fixture = createSigningFixture();
    const body = JSON.stringify({ type: 1 });

    const response = await worker.fetch(
      new Request("https://example.com/", {
        method: "POST",
        body,
        headers: fixture.signBody(body, "not-a-timestamp")
      }),
      { DISCORD_PUBLIC_KEY: fixture.publicKeyHex }
    );

    await expectJsonResponse(response, 401, {
      error: "Invalid request signature."
    });
  });

  it("does not log raw bodies or signature header values", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fixture = createSigningFixture();
    const signedBody = JSON.stringify({ type: 1 });
    const sentBody = JSON.stringify({
      type: 1,
      token: "raw-body-token-that-must-not-be-logged"
    });
    const headers = fixture.signBody(signedBody);
    const signature = headers.get("X-Signature-Ed25519");

    await worker.fetch(
      new Request("https://example.com/", {
        method: "POST",
        body: sentBody,
        headers
      }),
      { DISCORD_PUBLIC_KEY: fixture.publicKeyHex }
    );

    const logged = JSON.stringify(logSpy.mock.calls);

    expect(logged).not.toContain(sentBody);
    expect(logged).not.toContain("raw-body-token-that-must-not-be-logged");
    expect(logged).not.toContain(signature);
  });

  it("returns 400 for signed malformed JSON", async () => {
    const fixture = createSigningFixture();
    const body = "{not-json";

    const response = await worker.fetch(
      new Request("https://example.com/", {
        method: "POST",
        body,
        headers: fixture.signBody(body)
      }),
      { DISCORD_PUBLIC_KEY: fixture.publicKeyHex }
    );

    await expectJsonResponse(response, 400, { error: "Invalid JSON body." });
  });
});

function createSigningFixture(): SigningFixture {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const publicKeyHex = Buffer.from(publicKeyDer).subarray(-32).toString("hex");

  return {
    publicKeyHex,
    signBody(body: string, timestamp = timestampSecondsFromNow(0)): Headers {
      const message = Buffer.concat([
        Buffer.from(timestamp, "utf8"),
        Buffer.from(body, "utf8")
      ]);
      const signature = sign(null, message, privateKey).toString("hex");

      return new Headers({
        "X-Signature-Ed25519": signature,
        "X-Signature-Timestamp": timestamp
      });
    }
  };
}

function timestampSecondsFromNow(deltaSeconds: number): string {
  return Math.floor(Date.now() / 1_000 + deltaSeconds).toString();
}

async function expectJsonResponse(
  response: Response,
  status: number,
  body: unknown
): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual(body);
}
