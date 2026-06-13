import { existsSync, readFileSync } from "node:fs";
import { Routes } from "discord-api-types/v10";

import { incidentCommands } from "../src/discord/commands.ts";

declare const process: {
  readonly env: RegisterCommandsEnv & Record<string, string | undefined>;
  exitCode?: number;
};

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

interface RegisterCommandsEnv {
  readonly DISCORD_APPLICATION_ID?: string;
  readonly DISCORD_BOT_TOKEN?: string;
  readonly DISCORD_TEST_GUILD_ID?: string;
}

type MutableRegisterCommandsEnv = {
  DISCORD_APPLICATION_ID?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_TEST_GUILD_ID?: string;
};

function loadDevVars(path = ".dev.vars"): RegisterCommandsEnv {
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

function getRequiredEnv(env: RegisterCommandsEnv): Required<RegisterCommandsEnv> {
  const missing = [
    "DISCORD_APPLICATION_ID",
    "DISCORD_BOT_TOKEN",
    "DISCORD_TEST_GUILD_ID"
  ].filter((name) => !env[name as keyof RegisterCommandsEnv]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    DISCORD_APPLICATION_ID: env.DISCORD_APPLICATION_ID,
    DISCORD_BOT_TOKEN: env.DISCORD_BOT_TOKEN,
    DISCORD_TEST_GUILD_ID: env.DISCORD_TEST_GUILD_ID
  } as Required<RegisterCommandsEnv>;
}

async function registerGuildCommands(env: RegisterCommandsEnv): Promise<void> {
  const {
    DISCORD_APPLICATION_ID,
    DISCORD_BOT_TOKEN,
    DISCORD_TEST_GUILD_ID
  } = getRequiredEnv(env);

  const route = Routes.applicationGuildCommands(
    DISCORD_APPLICATION_ID,
    DISCORD_TEST_GUILD_ID
  );

  const response = await fetch(`${DISCORD_API_BASE_URL}${route}`, {
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
      event: "discord_guild_commands_registered",
      guildId: DISCORD_TEST_GUILD_ID,
      commandCount: incidentCommands.length
    })
  );
}

try {
  await registerGuildCommands({
    ...loadDevVars(),
    ...process.env
  });
} catch (error) {
  console.error(
    JSON.stringify({
      event: "discord_guild_command_registration_failed",
      message: error instanceof Error ? error.message : "Unknown registration error"
    })
  );
  process.exitCode = 1;
}
