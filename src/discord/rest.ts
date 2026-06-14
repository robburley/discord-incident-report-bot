export interface DiscordRestClient {
  createDmChannel(input: {
    readonly recipientId: string;
  }): Promise<{
    readonly channelId: string;
  }>;
  createChannelMessage(input: {
    readonly channelId: string;
    readonly content: string;
    readonly allowedMentions?: DiscordAllowedMentions;
  }): Promise<void>;
  editOriginalInteractionResponse(input: {
    readonly applicationId: string;
    readonly interactionToken: string;
    readonly content: string;
  }): Promise<void>;
}

export interface DiscordAllowedMentions {
  readonly parse?: readonly ("roles" | "users" | "everyone")[];
  readonly users?: readonly string[];
  readonly roles?: readonly string[];
  readonly repliedUser?: boolean;
}

export class FetchDiscordRestClient implements DiscordRestClient {
  private static readonly maxRateLimitRetries = 2;
  private static readonly maxRateLimitDelayMilliseconds = 5_000;

  constructor(
    private readonly botToken: string
  ) {}

  async createDmChannel(input: {
    readonly recipientId: string;
  }): Promise<{
    readonly channelId: string;
  }> {
    const response = await this.fetchDiscord(
      new URL("https://discord.com/api/v10/users/@me/channels"),
      {
        method: "POST",
        headers: {
          authorization: `Bot ${this.botToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          recipient_id: input.recipientId
        })
      },
      "dm_channel_create"
    );

    if (!response.ok) {
      throw new Error(
        `Discord REST DM channel creation failed with ${await formatDiscordError(
          response,
          [this.botToken]
        )}`
      );
    }

    const body = await response.json();

    if (!isDmChannelResponse(body)) {
      throw new Error("Discord REST DM channel creation returned a malformed response.");
    }

    return { channelId: body.id };
  }

  async createChannelMessage(input: {
    readonly channelId: string;
    readonly content: string;
    readonly allowedMentions?: DiscordAllowedMentions;
  }): Promise<void> {
    const response = await this.fetchDiscord(
      new URL(`https://discord.com/api/v10/channels/${input.channelId}/messages`),
      {
        method: "POST",
        headers: {
          authorization: `Bot ${this.botToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          content: input.content,
          allowed_mentions: toDiscordAllowedMentionsPayload(input.allowedMentions)
        })
      },
      "message_create"
    );


    if (!response.ok) {
      throw new Error(
        `Discord REST message post failed with ${await formatDiscordError(
          response,
          [this.botToken, input.content]
        )}`
      );
    }

    console.log({
      event: "discord_rest_message_posted",
      channelId: input.channelId,
      contentLength: input.content.length
    });
  }

  async editOriginalInteractionResponse(input: {
    readonly applicationId: string;
    readonly interactionToken: string;
    readonly content: string;
  }): Promise<void> {
    const response = await this.fetchDiscord(
      new URL(`https://discord.com/api/v10/webhooks/${input.applicationId}/${input.interactionToken}/messages/@original`),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          content: input.content
        })
      },
      "interaction_response_edit"
    );


    if (!response.ok) {
      throw new Error(
        `Discord REST interaction response edit failed with ${await formatDiscordError(
          response,
          [input.interactionToken, input.content]
        )}`
      );
    }

    console.log({
      event: "discord_rest_interaction_response_edited",
      applicationId: input.applicationId,
      contentLength: input.content.length
    });
  }

  private async fetchDiscord(
    url: URL,
    init: RequestInit,
    operation: string
  ): Promise<Response> {
    let response: Response;

    for (
      let attempt = 0;
      attempt <= FetchDiscordRestClient.maxRateLimitRetries;
      attempt++
    ) {
      response = await fetch(url, init);

      if (response.status !== 429) {
        return response;
      }

      const retryAfterMilliseconds = await getDiscordRetryAfterMilliseconds(
        response
      );

      console.warn({
        event: "discord_rest_rate_limited",
        operation,
        attempt,
        retryAfterMilliseconds
      });

      if (
        attempt === FetchDiscordRestClient.maxRateLimitRetries ||
        retryAfterMilliseconds >
          FetchDiscordRestClient.maxRateLimitDelayMilliseconds
      ) {
        return response;
      }

      await sleep(retryAfterMilliseconds);
    }

    throw new Error("Discord REST request failed before receiving a response.");
  }
}

function toDiscordAllowedMentionsPayload(
  allowedMentions: DiscordAllowedMentions = {}
) {
  return {
    parse: allowedMentions.parse ?? [],
    users: allowedMentions.users ?? [],
    roles: allowedMentions.roles ?? [],
    replied_user: allowedMentions.repliedUser ?? false
  };
}

async function formatDiscordError(
  response: Response,
  sensitiveValues: readonly string[] = []
): Promise<string> {
  const body = await response.text();
  const sanitizedBody = sanitizeDiscordErrorBody(body, sensitiveValues);

  return sanitizedBody ? `${response.status}: ${sanitizedBody}` : `${response.status}`;
}

function sanitizeDiscordErrorBody(
  body: string,
  sensitiveValues: readonly string[]
): string {
  return sensitiveValues
    .filter((value) => value.length > 0)
    .reduce(
      (sanitized, value) => sanitized.replaceAll(value, "[redacted]"),
      body
    )
    .replace(/Bot\s+[A-Za-z0-9._-]+/gi, "Bot [redacted]")
    .replace(
      /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g,
      "[redacted-token]"
    )
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

async function getDiscordRetryAfterMilliseconds(
  response: Response
): Promise<number> {
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterHeaderSeconds = retryAfterHeader
    ? Number.parseFloat(retryAfterHeader)
    : Number.NaN;

  if (Number.isFinite(retryAfterHeaderSeconds) && retryAfterHeaderSeconds >= 0) {
    return Math.ceil(retryAfterHeaderSeconds * 1_000);
  }

  try {
    const body = await response.clone().json();
    const retryAfter = isDiscordRateLimitBody(body) ? body.retry_after : null;

    if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) {
      return Math.ceil(Math.max(0, retryAfter) * 1_000);
    }
  } catch {
    // Fall back to a short delay when Discord returns a malformed 429 body.
  }

  return 1_000;
}

function isDiscordRateLimitBody(
  body: unknown
): body is { readonly retry_after: number } {
  return (
    body !== null &&
    typeof body === "object" &&
    "retry_after" in body &&
    typeof body.retry_after === "number"
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isDmChannelResponse(body: unknown): body is { readonly id: string } {
  return (
    body !== null &&
    typeof body === "object" &&
    "id" in body &&
    typeof body.id === "string" &&
    body.id !== ""
  );
}
