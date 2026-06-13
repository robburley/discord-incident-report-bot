import { PermissionFlagsBits } from "discord-api-types/v10";
import { beforeEach, describe, expect, it } from "vitest";

import { handleDiscordInteraction } from "../../src/discord/interactions";
import {
  CAR_NUMBER_INPUT_ID,
  INCIDENT_REPORT_MODAL_CUSTOM_ID,
  LAP_NUMBER_INPUT_ID,
  RACE_NUMBER_INPUT_ID,
  TURN_NUMBER_INPUT_ID
} from "../../src/discord/modals";
import { DISCORD_EPHEMERAL_MESSAGE_FLAG } from "../../src/discord/responses";
import { RepositoryConflictError } from "../../src/db/repository";
import type {
  CloseSessionInput,
  CreateSessionInput,
  DuplicateReportInput,
  GuildConfig,
  IncidentReport,
  IncidentRepository,
  IncidentSession,
  InsertReportInput,
  InsertReportResult,
  UpsertGuildConfigInput
} from "../../src/db/repository";

describe("Discord interaction handlers", () => {
  let repository: MemoryIncidentRepository;
  let restClient: MemoryDiscordRestClient;
  let waitUntilPromises: Promise<unknown>[];

  beforeEach(() => {
    repository = new MemoryIncidentRepository();
    restClient = new MemoryDiscordRestClient();
    waitUntilPromises = [];
  });

  it("handles /incident-config role when the member has Manage Guild", async () => {
    const result = await handleDiscordInteraction(configRoleInteraction(), {
      repository
    });

    expect(result.body).toEqual({
      type: 4,
      data: {
        content: "Incident manager role configured.",
        flags: DISCORD_EPHEMERAL_MESSAGE_FLAG
      }
    });
    await expect(repository.getGuildConfig("guild-1")).resolves.toMatchObject({
      managerRoleId: "manager-role"
    });
  });

  it("rejects /incident-config role without Manage Guild", async () => {
    const result = await handleDiscordInteraction(
      configRoleInteraction({ permissions: "0" }),
      { repository }
    );

    expect(result.body).toMatchObject({
      data: {
        content:
          "You need Discord Manage Server permission to configure incidents."
      }
    });
  });

  it("starts a session and schedules a public channel message", async () => {
    await seedConfig(repository);

    const result = await handleDiscordInteraction(sessionInteraction("start"), {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });
    await flushWaitUntil();

    expect(result.body).toEqual({
      type: 4,
      data: {
        content: "Incident session started.",
        flags: DISCORD_EPHEMERAL_MESSAGE_FLAG
      }
    });
    expect(restClient.messages).toEqual([
      {
        channelId: "channel-1",
        content: "Incident reporting session started in <#channel-1>."
      }
    ]);
  });

  it("returns the incident report modal for /incident in the active channel", async () => {
    await seedConfig(repository);
    await seedActiveSession(repository);

    const result = await handleDiscordInteraction(baseCommand("incident"), {
      repository
    });

    expect(result.body).toMatchObject({
      type: 9,
      data: {
        custom_id: INCIDENT_REPORT_MODAL_CUSTOM_ID,
        title: "Report incident"
      }
    });
    expect(JSON.stringify(result.body)).toContain("Race number");
    expect(JSON.stringify(result.body)).toContain("Turn / corner number");
  });

  it("stores incident modal submissions", async () => {
    await seedConfig(repository);
    await seedActiveSession(repository);

    const result = await handleDiscordInteraction(modalSubmitInteraction(), {
      repository
    });

    expect(result.body).toMatchObject({
      data: {
        content: "Incident report submitted."
      }
    });
    expect(repository.reports).toMatchObject([
      {
        guildId: "guild-1",
        submittedByUserId: "user-1",
        discordInteractionId: "modal-interaction-1",
        raceNumber: 1,
        lapNumber: 2,
        turnNumber: 3,
        carNumber: "07"
      }
    ]);
  });

  it("defers /incident-session end and posts final summary messages", async () => {
    await seedConfig(repository);
    const session = await seedActiveSession(repository);
    await repository.insertReport(reportInput(session, "report-interaction-1"));

    const result = await handleDiscordInteraction(sessionInteraction("end"), {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });

    expect(result.body).toEqual({
      type: 5,
      data: {
        flags: DISCORD_EPHEMERAL_MESSAGE_FLAG
      }
    });

    await flushWaitUntil();

    expect(restClient.messages).toEqual([
      {
        channelId: "channel-1",
        content:
          "Incident session closed for channel channel-1.\n\nRace 1\nLap 2\nTurn 3: car 07 reported by user-1"
      }
    ]);
  });

  it("defers /incident-session summary and reposts the latest closed summary", async () => {
    await seedConfig(repository);
    const session = await seedActiveSession(repository);
    await repository.insertReport(reportInput(session, "report-interaction-1"));
    await repository.closeSession({
      sessionId: session.id,
      endedByUserId: "manager-1"
    });

    const result = await handleDiscordInteraction(sessionInteraction("summary"), {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });

    expect(result.body).toMatchObject({ type: 5 });

    await flushWaitUntil();

    expect(restClient.messages[0]).toMatchObject({
      channelId: "channel-1"
    });
    expect(restClient.messages[0]?.content).toContain("car 07");
  });

  function captureWaitUntil(promise: Promise<unknown>): void {
    waitUntilPromises.push(promise);
  }

  async function flushWaitUntil(): Promise<void> {
    await Promise.all(waitUntilPromises);
  }
});

function baseCommand(name: string) {
  return {
    type: 2,
    guild_id: "guild-1",
    channel_id: "channel-1",
    member: {
      user: { id: "user-1" },
      roles: ["manager-role"],
      permissions: PermissionFlagsBits.ManageGuild.toString()
    },
    data: { name }
  };
}

function configRoleInteraction(input: { readonly permissions?: string } = {}) {
  return {
    ...baseCommand("incident-config"),
    member: {
      user: { id: "user-1" },
      roles: [],
      permissions: input.permissions ?? PermissionFlagsBits.ManageGuild.toString()
    },
    data: {
      name: "incident-config",
      options: [
        {
          name: "role",
          options: [{ name: "role", value: "manager-role" }]
        }
      ]
    }
  };
}

function sessionInteraction(subcommand: string) {
  return {
    ...baseCommand("incident-session"),
    member: {
      user: { id: "manager-1" },
      roles: ["manager-role"],
      permissions: "0"
    },
    data: {
      name: "incident-session",
      options: [{ name: subcommand }]
    }
  };
}

function modalSubmitInteraction() {
  return {
    type: 5,
    id: "modal-interaction-1",
    guild_id: "guild-1",
    channel_id: "channel-1",
    member: {
      user: { id: "user-1" },
      roles: []
    },
    data: {
      custom_id: INCIDENT_REPORT_MODAL_CUSTOM_ID,
      components: [
        modalRow(RACE_NUMBER_INPUT_ID, "1"),
        modalRow(LAP_NUMBER_INPUT_ID, "2"),
        modalRow(TURN_NUMBER_INPUT_ID, "3"),
        modalRow(CAR_NUMBER_INPUT_ID, "07")
      ]
    }
  };
}

function modalRow(customId: string, value: string) {
  return {
    components: [
      {
        custom_id: customId,
        value
      }
    ]
  };
}

async function seedConfig(repository: MemoryIncidentRepository): Promise<void> {
  await repository.upsertGuildConfig({
    guildId: "guild-1",
    managerRoleId: "manager-role"
  });
}

async function seedActiveSession(
  repository: MemoryIncidentRepository
): Promise<IncidentSession> {
  return repository.createSession({
    guildId: "guild-1",
    channelId: "channel-1",
    startedByUserId: "manager-1"
  });
}

function reportInput(
  session: IncidentSession,
  discordInteractionId: string
): InsertReportInput {
  return {
    sessionId: session.id,
    guildId: session.guildId,
    submittedByUserId: "user-1",
    discordInteractionId,
    raceNumber: 1,
    lapNumber: 2,
    turnNumber: 3,
    carNumber: "07"
  };
}

class MemoryDiscordRestClient {
  readonly messages: { readonly channelId: string; readonly content: string }[] = [];

  async createChannelMessage(input: {
    readonly channelId: string;
    readonly content: string;
  }): Promise<void> {
    this.messages.push(input);
  }
}

class MemoryIncidentRepository implements IncidentRepository {
  readonly configs = new Map<string, GuildConfig>();
  readonly sessions: IncidentSession[] = [];
  readonly reports: IncidentReport[] = [];
  private now = 1_000;
  private idNumber = 1;

  async upsertGuildConfig(input: UpsertGuildConfigInput): Promise<GuildConfig> {
    const existing = this.configs.get(input.guildId);
    const timestamp = this.now++;
    const config = {
      guildId: input.guildId,
      managerRoleId: input.managerRoleId,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    this.configs.set(input.guildId, config);
    return config;
  }

  async getGuildConfig(guildId: string): Promise<GuildConfig | null> {
    return this.configs.get(guildId) ?? null;
  }

  async getActiveSession(guildId: string): Promise<IncidentSession | null> {
    return (
      this.sessions.find(
        (session) => session.guildId === guildId && session.status === "active"
      ) ?? null
    );
  }

  async createSession(input: CreateSessionInput): Promise<IncidentSession> {
    const active = await this.getActiveSession(input.guildId);

    if (active) {
      throw new RepositoryConflictError("Active session exists.");
    }

    const session: IncidentSession = {
      id: `session-${this.idNumber++}`,
      guildId: input.guildId,
      channelId: input.channelId,
      startedByUserId: input.startedByUserId,
      endedByUserId: null,
      status: "active",
      startedAt: this.now++,
      endedAt: null
    };

    this.sessions.push(session);
    return session;
  }

  async closeSession(input: CloseSessionInput): Promise<IncidentSession | null> {
    const index = this.sessions.findIndex(
      (session) => session.id === input.sessionId && session.status === "active"
    );

    if (index === -1) {
      return null;
    }

    const existing = this.sessions[index];

    if (!existing) {
      return null;
    }

    const closed: IncidentSession = {
      ...existing,
      endedByUserId: input.endedByUserId,
      status: "closed",
      endedAt: this.now++
    };

    this.sessions[index] = closed;
    return closed;
  }

  async insertReport(input: InsertReportInput): Promise<InsertReportResult> {
    const existing = await this.getReportByDiscordInteractionId(
      input.discordInteractionId
    );

    if (existing) {
      return {
        status: "duplicate_interaction",
        report: existing
      };
    }

    const report: IncidentReport = {
      id: `report-${this.idNumber++}`,
      ...input,
      createdAt: this.now++
    };

    this.reports.push(report);
    return {
      status: "inserted",
      report
    };
  }

  async getReportByDiscordInteractionId(
    discordInteractionId: string
  ): Promise<IncidentReport | null> {
    return (
      this.reports.find(
        (report) => report.discordInteractionId === discordInteractionId
      ) ?? null
    );
  }

  async findDuplicateReportForUser(
    input: DuplicateReportInput
  ): Promise<IncidentReport | null> {
    return (
      this.reports.find(
        (report) =>
          report.sessionId === input.sessionId &&
          report.submittedByUserId === input.submittedByUserId &&
          report.raceNumber === input.raceNumber &&
          report.lapNumber === input.lapNumber &&
          report.turnNumber === input.turnNumber &&
          report.carNumber === input.carNumber
      ) ?? null
    );
  }

  async getOrderedReportsForSession(sessionId: string): Promise<IncidentReport[]> {
    return this.reports
      .filter((report) => report.sessionId === sessionId)
      .sort(
        (left, right) =>
          left.raceNumber - right.raceNumber ||
          left.lapNumber - right.lapNumber ||
          left.turnNumber - right.turnNumber ||
          left.createdAt - right.createdAt
      );
  }

  async getLatestClosedSessionForGuild(
    guildId: string
  ): Promise<IncidentSession | null> {
    return (
      this.sessions
        .filter(
          (session) => session.guildId === guildId && session.status === "closed"
        )
        .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0))[0] ??
      null
    );
  }
}
