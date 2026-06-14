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
  constructor(
    private readonly botToken: string
  ) {}

  async createDmChannel(input: {
    readonly recipientId: string;
  }): Promise<{
    readonly channelId: string;
  }> {
    const response = await fetch(
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
        }
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
    const response = await fetch(
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
        }
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
    const response = await fetch(
        new URL(`https://discord.com/api/v10/webhooks/${input.applicationId}/${input.interactionToken}/messages/@original`),
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            content: input.content
          })
        }
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

function isDmChannelResponse(body: unknown): body is { readonly id: string } {
  return (
    body !== null &&
    typeof body === "object" &&
    "id" in body &&
    typeof body.id === "string" &&
    body.id !== ""
  );
}
