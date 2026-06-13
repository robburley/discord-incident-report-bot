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

  it("returns configured status for /incident-config status", async () => {
    await seedConfig(repository);

    const result = await handleDiscordInteraction(configStatusInteraction(), {
      repository
    });

    expect(result.body).toEqual({
      type: 4,
      data: {
        content: "Incident bot is configured. Manager role: <@&manager-role>.",
        flags: DISCORD_EPHEMERAL_MESSAGE_FLAG
      }
    });
  });

  it("returns setup guidance for /incident-config status when unconfigured", async () => {
    const result = await handleDiscordInteraction(configStatusInteraction(), {
      repository
    });

    expect(result.body).toMatchObject({
      data: {
        content:
          "No incident manager role is configured. This server is not configured yet. A server admin must run `/incident-config role role:<manager role>` before incident commands can be used."
      }
    });
  });

  it("rejects /incident-config status without Manage Guild", async () => {
    const result = await handleDiscordInteraction(
      configStatusInteraction({ permissions: "0" }),
      { repository }
    );

    expect(result.body).toMatchObject({
      data: {
        content:
          "You need Discord Manage Server permission to configure incidents."
      }
    });
  });

  it("returns setup guidance for incident commands in unconfigured servers", async () => {
    const result = await handleDiscordInteraction(baseCommand("incident"), {
      repository
    });

    expect(result.body).toMatchObject({
      data: {
        content:
          "This server is not configured yet. A server admin must run `/incident-config role role:<manager role>` before incident commands can be used."
      }
    });
  });

  it("returns setup guidance for session commands in unconfigured servers", async () => {
    const result = await handleDiscordInteraction(sessionInteraction("start"), {
      repository
    });

    expect(result.body).toMatchObject({
      data: {
        content:
          "This server is not configured yet. A server admin must run `/incident-config role role:<manager role>` before incident commands can be used."
      }
    });
  });

  it("edits deferred session commands with setup guidance when unconfigured", async () => {
    const result = await handleDiscordInteraction(sessionInteraction("summary"), {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });

    expect(result.body).toMatchObject({ type: 5 });

    await flushWaitUntil();

    expect(restClient.edits).toEqual([
      {
        applicationId: "app-1",
        interactionToken: "token-summary",
        content:
          "This server is not configured yet. A server admin must run `/incident-config role role:<manager role>` before incident commands can be used."
      }
    ]);
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

  it("uses the server-side active session for modal submissions", async () => {
    await seedConfig(repository);
    const activeSession = await seedActiveSession(repository);

    await handleDiscordInteraction(
      modalSubmitInteraction({
        extraComponents: [modalRow("session_id", "client-controlled-session-id")]
      }),
      { repository }
    );

    expect(repository.reports).toMatchObject([
      {
        sessionId: activeSession.id,
        discordInteractionId: "modal-interaction-1"
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
          "Incident session closed for <#channel-1>.\n\n`Race  Lap  Turn  Car  ID                    User`\n`1     2    3     07   report-interaction-1` <@user-1>"
      }
    ]);
    expect(restClient.edits).toEqual([
      {
        applicationId: "app-1",
        interactionToken: "token-end",
        content: "Incident session ended and summary posted."
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
    expect(restClient.messages[0]?.content).toContain(
      "`1     2    3     07   report-interaction-1` <@user-1>"
    );
    expect(restClient.edits).toEqual([
      {
        applicationId: "app-1",
        interactionToken: "token-summary",
        content: "Latest incident session summary reposted."
      }
    ]);
  });

  it("handles session commands independently across two guilds", async () => {
    await seedConfig(repository, "guild-a", "manager-role-a");
    await seedConfig(repository, "guild-b", "manager-role-b");

    const guildAStart = await handleDiscordInteraction(
      sessionInteraction("start", {
        guildId: "guild-a",
        channelId: "shared-channel",
        userId: "same-user",
        roles: ["manager-role-a"]
      }),
      {
        repository,
        restClient,
        waitUntil: captureWaitUntil
      }
    );
    const guildBStart = await handleDiscordInteraction(
      sessionInteraction("start", {
        guildId: "guild-b",
        channelId: "shared-channel",
        userId: "same-user",
        roles: ["manager-role-b"]
      }),
      {
        repository,
        restClient,
        waitUntil: captureWaitUntil
      }
    );
    const guildADuplicate = await handleDiscordInteraction(
      sessionInteraction("start", {
        guildId: "guild-a",
        channelId: "other-channel",
        userId: "same-user",
        roles: ["manager-role-a"]
      }),
      { repository }
    );

    await flushWaitUntil();

    expect(guildAStart.body).toMatchObject({
      data: { content: "Incident session started." }
    });
    expect(guildBStart.body).toMatchObject({
      data: { content: "Incident session started." }
    });
    expect(guildADuplicate.body).toMatchObject({
      data: {
        content: "An incident session is already active for this server."
      }
    });
    expect(repository.sessions).toMatchObject([
      { guildId: "guild-a", channelId: "shared-channel", status: "active" },
      { guildId: "guild-b", channelId: "shared-channel", status: "active" }
    ]);
  });

  it("reposts the latest closed summary for only the invoking guild", async () => {
    await seedConfig(repository, "guild-a", "manager-role-a");
    await seedConfig(repository, "guild-b", "manager-role-b");
    const guildASession = await seedActiveSession(
      repository,
      "guild-a",
      "shared-channel"
    );
    const guildBSession = await seedActiveSession(
      repository,
      "guild-b",
      "shared-channel"
    );
    await repository.insertReport(
      reportInput(guildASession, "guild-a-report", "same-user")
    );
    await repository.insertReport(
      reportInput(guildBSession, "guild-b-report", "same-user")
    );
    await repository.closeSession({
      sessionId: guildASession.id,
      endedByUserId: "manager-a"
    });
    await repository.closeSession({
      sessionId: guildBSession.id,
      endedByUserId: "manager-b"
    });

    const result = await handleDiscordInteraction(
      sessionInteraction("summary", {
        guildId: "guild-a",
        channelId: "shared-channel",
        userId: "manager-a",
        roles: ["manager-role-a"]
      }),
      {
        repository,
        restClient,
        waitUntil: captureWaitUntil
      }
    );

    expect(result.body).toMatchObject({ type: 5 });

    await flushWaitUntil();

    expect(restClient.messages).toHaveLength(1);
    expect(restClient.messages[0]).toMatchObject({
      channelId: "shared-channel"
    });
    expect(restClient.messages[0]?.content).toContain("guild-a-report");
    expect(restClient.messages[0]?.content).not.toContain("guild-b-report");
    expect(restClient.edits).toEqual([
      {
        applicationId: "app-1",
        interactionToken: "token-summary-guild-a",
        content: "Latest incident session summary reposted."
      }
    ]);
  });

  it("keeps an unconfigured guild blocked while another guild is configured", async () => {
    await seedConfig(repository, "guild-a", "manager-role");
    await seedActiveSession(repository, "guild-a", "channel-a");

    const configured = await handleDiscordInteraction(
      baseCommand("incident", {
        guildId: "guild-a",
        channelId: "channel-a",
        roles: ["manager-role"]
      }),
      { repository }
    );
    const unconfigured = await handleDiscordInteraction(
      baseCommand("incident", {
        guildId: "guild-b",
        channelId: "channel-b",
        roles: ["manager-role"]
      }),
      { repository }
    );

    expect(configured.body).toMatchObject({
      type: 9,
      data: { custom_id: INCIDENT_REPORT_MODAL_CUSTOM_ID }
    });
    expect(unconfigured.body).toMatchObject({
      data: {
        content:
          "This server is not configured yet. A server admin must run `/incident-config role role:<manager role>` before incident commands can be used."
      }
    });
  });

  function captureWaitUntil(promise: Promise<unknown>): void {
    waitUntilPromises.push(promise);
  }

  async function flushWaitUntil(): Promise<void> {
    await Promise.all(waitUntilPromises);
  }
});

function baseCommand(
  name: string,
  input: {
    readonly guildId?: string;
    readonly channelId?: string;
    readonly userId?: string;
    readonly roles?: readonly string[];
  } = {}
) {
  return {
    type: 2,
    guild_id: input.guildId ?? "guild-1",
    channel_id: input.channelId ?? "channel-1",
    member: {
      user: { id: input.userId ?? "user-1" },
      roles: input.roles ?? ["manager-role"],
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

function configStatusInteraction(input: { readonly permissions?: string } = {}) {
  return {
    ...baseCommand("incident-config"),
    member: {
      user: { id: "user-1" },
      roles: [],
      permissions: input.permissions ?? PermissionFlagsBits.ManageGuild.toString()
    },
    data: {
      name: "incident-config",
      options: [{ name: "status" }]
    }
  };
}

function sessionInteraction(
  subcommand: string,
  input: {
    readonly guildId?: string;
    readonly channelId?: string;
    readonly userId?: string;
    readonly roles?: readonly string[];
  } = {}
) {
  return {
    ...baseCommand("incident-session", input),
    application_id: "app-1",
    token: input.guildId ? `token-${subcommand}-${input.guildId}` : `token-${subcommand}`,
    member: {
      user: { id: input.userId ?? "manager-1" },
      roles: input.roles ?? ["manager-role"],
      permissions: "0"
    },
    data: {
      name: "incident-session",
      options: [{ name: subcommand }]
    }
  };
}

function modalSubmitInteraction(
  input: {
    readonly extraComponents?: readonly ReturnType<typeof modalRow>[];
  } = {}
) {
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
        modalRow(CAR_NUMBER_INPUT_ID, "07"),
        ...(input.extraComponents ?? [])
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

async function seedConfig(
  repository: MemoryIncidentRepository,
  guildId = "guild-1",
  managerRoleId = "manager-role"
): Promise<void> {
  await repository.upsertGuildConfig({
    guildId,
    managerRoleId
  });
}

async function seedActiveSession(
  repository: MemoryIncidentRepository,
  guildId = "guild-1",
  channelId = "channel-1"
): Promise<IncidentSession> {
  return repository.createSession({
    guildId,
    channelId,
    startedByUserId: "manager-1"
  });
}

function reportInput(
  session: IncidentSession,
  discordInteractionId: string,
  submittedByUserId = "user-1"
): InsertReportInput {
  return {
    sessionId: session.id,
    guildId: session.guildId,
    submittedByUserId,
    discordInteractionId,
    raceNumber: 1,
    lapNumber: 2,
    turnNumber: 3,
    carNumber: "07"
  };
}

class MemoryDiscordRestClient {
  readonly messages: { readonly channelId: string; readonly content: string }[] = [];
  readonly edits: {
    readonly applicationId: string;
    readonly interactionToken: string;
    readonly content: string;
  }[] = [];

  async createChannelMessage(input: {
    readonly channelId: string;
    readonly content: string;
  }): Promise<void> {
    this.messages.push(input);
  }

  async editOriginalInteractionResponse(input: {
    readonly applicationId: string;
    readonly interactionToken: string;
    readonly content: string;
  }): Promise<void> {
    this.edits.push(input);
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
