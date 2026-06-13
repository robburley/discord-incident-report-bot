export interface Env {
  readonly DISCORD_PUBLIC_KEY?: string;
  readonly DISCORD_BOT_TOKEN?: string;
  readonly INCIDENT_DB?: D1Database;
}

export interface RequiredEnv extends Env {
  readonly DISCORD_PUBLIC_KEY: string;
}

export function assertRequiredEnv(env: Env): asserts env is RequiredEnv {
  const missing: string[] = [];

  if (!env.DISCORD_PUBLIC_KEY) {
    missing.push("DISCORD_PUBLIC_KEY");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment bindings: ${missing.join(", ")}`);
  }
}
