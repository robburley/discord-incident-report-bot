import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Routes } from "discord-api-types/v10";

import { incidentCommands } from "../src/discord/commands.ts";

declare const process: {
  readonly env: RegisterCommandsEnv & Record<string, string | undefined>;
  readonly argv: readonly string[];
  exitCode?: number;
};

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const REGISTRATION_SCOPES = ["guild", "global"] as const;

interface RegisterCommandsEnv {
  readonly DISCORD_APPLICATION_ID?: string;
  readonly DISCORD_BOT_TOKEN?: string;
  readonly DISCORD_TEST_GUILD_ID?: string;
}

type RegistrationScope = (typeof REGISTRATION_SCOPES)[number];

type MutableRegisterCommandsEnv = {
  DISCORD_APPLICATION_ID?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_TEST_GUILD_ID?: string;
};

interface RegisterCommandsOptions {
  readonly env: RegisterCommandsEnv;
  readonly scope: RegistrationScope;
  readonly fetchImpl?: typeof fetch;
}

export function loadDevVars(path = ".dev.vars"): RegisterCommandsEnv {
  if (!existsSync(path)) {
    return {};
  }

  const parsed: Record<string, string> = {};
  const file = readFileSync(path, "utf8");

  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    parsed[key] = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }

  const env: MutableRegisterCommandsEnv = {};

  if (parsed.DISCORD_APPLICATION_ID) {
    env.DISCORD_APPLICATION_ID = parsed.DISCORD_APPLICATION_ID;
  }

  if (parsed.DISCORD_BOT_TOKEN) {
    env.DISCORD_BOT_TOKEN = parsed.DISCORD_BOT_TOKEN;
  }

  if (parsed.DISCORD_TEST_GUILD_ID) {
    env.DISCORD_TEST_GUILD_ID = parsed.DISCORD_TEST_GUILD_ID;
  }

  return env;
}

export function parseRegistrationScope(args: readonly string[]): RegistrationScope | "help" {
  if (args.includes("--help") || args.includes("-h")) {
    return "help";
  }

  const scopeFlagIndex = args.indexOf("--scope");
  const rawScope =
    scopeFlagIndex >= 0
      ? args[scopeFlagIndex + 1]
      : args
          .find((arg) => arg.startsWith("--scope="))
          ?.slice("--scope=".length);

  if (!rawScope) {
    throw new Error("Missing command registration scope. Use --scope guild or --scope global.");
  }

  if (!REGISTRATION_SCOPES.includes(rawScope as RegistrationScope)) {
    throw new Error(`Unsupported command registration scope: ${rawScope}`);
  }

  return rawScope as RegistrationScope;
}

export function getRegistrationUsage(): string {
  return [
    "Choose an explicit Discord command registration scope:",
    "",
    "  npm run register:commands:guild",
    "  npm run register:commands:global",
    "",
    "Guild registration updates the configured DISCORD_TEST_GUILD_ID quickly for development.",
    "Global registration updates production commands and can take time to appear in Discord clients."
  ].join("\n");
}

function getRequiredEnv(
  env: RegisterCommandsEnv,
  scope: RegistrationScope
): RegisterCommandsEnv & Required<Pick<RegisterCommandsEnv, "DISCORD_APPLICATION_ID" | "DISCORD_BOT_TOKEN">> {
  const requiredNames: Array<keyof RegisterCommandsEnv> = [
    "DISCORD_APPLICATION_ID",
    "DISCORD_BOT_TOKEN"
  ];

  if (scope === "guild") {
    requiredNames.push("DISCORD_TEST_GUILD_ID");
  }

  const missing = requiredNames.filter((name) => !env[name]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    DISCORD_APPLICATION_ID: env.DISCORD_APPLICATION_ID,
    DISCORD_BOT_TOKEN: env.DISCORD_BOT_TOKEN,
    DISCORD_TEST_GUILD_ID: env.DISCORD_TEST_GUILD_ID
  } as RegisterCommandsEnv &
    Required<Pick<RegisterCommandsEnv, "DISCORD_APPLICATION_ID" | "DISCORD_BOT_TOKEN">>;
}

export async function registerCommands({
  env,
  scope,
  fetchImpl = fetch
}: RegisterCommandsOptions): Promise<void> {
  const requiredEnv = getRequiredEnv(env, scope);
  const { DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN } = requiredEnv;

  const route =
    scope === "guild"
      ? Routes.applicationGuildCommands(
          DISCORD_APPLICATION_ID,
          requiredEnv.DISCORD_TEST_GUILD_ID as string
        )
      : Routes.applicationCommands(DISCORD_APPLICATION_ID);

  const response = await fetchImpl(`${DISCORD_API_BASE_URL}${route}`, {
    method: "PUT",
    headers: {
      authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(incidentCommands)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Discord command registration failed (${response.status} ${response.statusText}): ${errorBody}`
    );
  }

  console.log(
    JSON.stringify({
      event:
        scope === "guild"
          ? "discord_guild_commands_registered"
          : "discord_global_commands_registered",
      commandScope: scope,
      ...(scope === "guild" ? { guildId: requiredEnv.DISCORD_TEST_GUILD_ID } : {}),
      commandCount: incidentCommands.length
    })
  );
}

async function main(): Promise<void> {
  let commandScope: RegistrationScope | "unknown" = "unknown";

  try {
    const parsedScope = parseRegistrationScope(process.argv.slice(2));

    if (parsedScope === "help") {
      console.log(getRegistrationUsage());
      return;
    }

    commandScope = parsedScope;

    await registerCommands({
      env: {
        ...loadDevVars(),
        ...process.env
      },
      scope: commandScope
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "discord_command_registration_failed",
        commandScope,
        commandCount: incidentCommands.length,
        message: error instanceof Error ? error.message : "Unknown registration error"
      })
    );
    process.exitCode = 1;
  }
}

const entrypointPath = process.argv[1];

if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  await main();
}
