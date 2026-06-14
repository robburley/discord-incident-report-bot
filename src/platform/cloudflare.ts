import {
  handleDiscordInteraction,
  type InteractionHandlerDependencies
} from "../discord/interactions";
import { FetchDiscordRestClient } from "../discord/rest";
import { jsonResponse } from "../discord/responses";
import {
  DISCORD_SIGNATURE_HEADER,
  DISCORD_TIMESTAMP_HEADER,
  verifyDiscordRequestSignature
} from "../discord/signature";
import { createD1IncidentRepository } from "../db/drizzle-repository";
import { assertRequiredEnv, type Env } from "./env";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx?: ExecutionContext
  ): Promise<Response> {
    try {
      assertRequiredEnv(env);
    } catch (error) {
      console.error({
        event: "missing_environment_binding",
        message: error instanceof Error ? error.message : "Unknown environment error"
      });

      return jsonResponse(
        { error: "Worker environment is not configured." },
        { status: 500 }
      );
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, { status: 405 });
    }

    const rawBody = await request.text();
  
    const isValidSignature = await verifyDiscordRequestSignature({
      rawBody,
      signature: request.headers.get(DISCORD_SIGNATURE_HEADER),
      timestamp: request.headers.get(DISCORD_TIMESTAMP_HEADER),
      publicKey: env.DISCORD_PUBLIC_KEY
    });

    if (!isValidSignature) {
      return jsonResponse({ error: "Invalid request signature." }, { status: 401 });
    }

    let interaction: unknown;

    try {
      interaction = JSON.parse(rawBody) as unknown;
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, { status: 400 });
    }

    const dependencies: InteractionHandlerDependencies = {
      ...(env.INCIDENT_DB
        ? { repository: createD1IncidentRepository(env.INCIDENT_DB) }
        : {}),
      ...(env.DISCORD_BOT_TOKEN
        ? { restClient: new FetchDiscordRestClient(env.DISCORD_BOT_TOKEN) }
        : {}),
      ...(ctx
        ? {
            waitUntil: (promise: Promise<unknown>) => ctx.waitUntil(promise)
          }
        : {})
    };

    const result = await handleDiscordInteraction(interaction, dependencies);
    return jsonResponse(result.body as Record<string, unknown>, {
      status: result.status
    });
  }
};
