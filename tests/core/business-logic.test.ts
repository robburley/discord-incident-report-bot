import { beforeEach, describe, expect, it } from "vitest";

import { hasManagerRole } from "../../src/core/authorization";
import { configureGuildManagerRole } from "../../src/core/config";
import {
  createIncidentReport,
  validateIncidentReportFields
} from "../../src/core/incidents";
import {
  endIncidentSession,
  getLatestClosedSessionSummary,
  startIncidentSession
} from "../../src/core/sessions";
import {
  formatSessionSummary,
  splitDiscordMessage
} from "../../src/core/summary";
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

describe("core business logic", () => {
  let repository: MemoryIncidentRepository;

  beforeEach(() => {
    repository = new MemoryIncidentRepository();
  });

  it("configures a guild manager role", async () => {
    const result = await configureGuildManagerRole({
      repository,
      guildId: "guild-1",
      managerRoleId: " role-1 "
    });

    expect(result.status).toBe("configured");
    await expect(repository.getGuildConfig("guild-1")).resolves.toMatchObject({
      managerRoleId: "role-1"
    });
  });

  it("authorizes members by configured manager role", () => {
    expect(
      hasManagerRole({
        managerRoleId: "manager-role",
        memberRoleIds: ["driver-role", "manager-role"]
      })
    ).toBe(true);

    expect(
      hasManagerRole({
        managerRoleId: "manager-role",
        memberRoleIds: ["driver-role"]
      })
    ).toBe(false);
  });

  it("starts and prevents a second active session", async () => {
    await seedConfig(repository);

    const started = await startIncidentSession({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    const duplicate = await startIncidentSession({
      repository,
      guildId: "guild-1",
      channelId: "channel-2",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    expect(started.status).toBe("started");
    expect(duplicate.status).toBe("active_session_exists");
  });

  it("does not start or end sessions without the manager role", async () => {
    await seedConfig(repository);

    const start = await startIncidentSession({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
      memberRoleIds: ["driver-role"]
    });
    const end = await endIncidentSession({
      repository,
      guildId: "guild-1",
      userId: "user-1",
      memberRoleIds: []
    });

    expect(start.status).toBe("unauthorized");
    expect(end.status).toBe("unauthorized");
  });

  it("ends a session and produces an empty public summary", async () => {
    await seedConfig(repository);
    await seedActiveSession(repository);

    const result = await endIncidentSession({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    expect(result.status).toBe("ended");
    expect(result.status === "ended" ? result.summaryMessages[0] : "").toContain(
      "No incidents were reported."
    );
  });

  it("validates incident report numbers and car numbers", () => {
    expect(
      validateIncidentReportFields({
        raceNumber: "1",
        lapNumber: "2",
        turnNumber: "3",
        carNumber: "07_A"
      })
    ).toEqual({
      status: "valid",
      value: {
        raceNumber: 1,
        lapNumber: 2,
        turnNumber: 3,
        carNumber: "07_A"
      }
    });

    expect(
      validateIncidentReportFields({
        raceNumber: "0",
        lapNumber: "2",
        turnNumber: "3",
        carNumber: "07"
      }).status
    ).toBe("invalid");
    expect(
      validateIncidentReportFields({
        raceNumber: "1",
        lapNumber: "2",
        turnNumber: "3",
        carNumber: "car 7"
      }).status
    ).toBe("invalid");
    expect(
      validateIncidentReportFields({
        raceNumber: "1",
        lapNumber: "2",
        turnNumber: "3",
        carNumber: "1234567890123"
      }).status
    ).toBe("invalid");
  });

  it("creates incident reports only for an active session channel", async () => {
    await seedConfig(repository);
    const session = await seedActiveSession(repository);

    const wrongChannel = await createIncidentReport({
      repository,
      guildId: "guild-1",
      channelId: "channel-2",
      submittedByUserId: "user-1",
      discordInteractionId: "interaction-1",
      raceNumber: "1",
      lapNumber: "2",
      turnNumber: "3",
      carNumber: "07"
    });
    const created = await createIncidentReport({
      repository,
      guildId: "guild-1",
      channelId: session.channelId,
      submittedByUserId: "user-1",
      discordInteractionId: "interaction-1",
      raceNumber: "1",
      lapNumber: "2",
      turnNumber: "3",
      carNumber: "07"
    });

    expect(wrongChannel.status).toBe("wrong_channel");
    expect(created.status).toBe("created");
  });

  it("rejects modal submissions after a session closes", async () => {
    await seedConfig(repository);
    const session = await seedActiveSession(repository);
    await repository.closeSession({
      sessionId: session.id,
      endedByUserId: "manager-1"
    });

    const result = await createIncidentReport({
      repository,
      guildId: "guild-1",
      channelId: session.channelId,
      submittedByUserId: "user-1",
      discordInteractionId: "interaction-1",
      raceNumber: "1",
      lapNumber: "2",
      turnNumber: "3",
      carNumber: "07"
    });

    expect(result.status).toBe("no_active_session");
  });

  it("keeps duplicate modal interaction IDs idempotent", async () => {
    await seedConfig(repository);
    await seedActiveSession(repository);

    const input = {
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      submittedByUserId: "user-1",
      discordInteractionId: "interaction-1",
      raceNumber: "1",
      lapNumber: "2",
      turnNumber: "3",
      carNumber: "07"
    } as const;
    const first = await createIncidentReport(input);
    const second = await createIncidentReport(input);

    expect(first.status).toBe("created");
    expect(second.status).toBe("duplicate_interaction");
    expect(repository.reports).toHaveLength(1);
  });

  it("rejects exact duplicate reports from the same user", async () => {
    await seedConfig(repository);
    await seedActiveSession(repository);

    await createIncidentReport({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      submittedByUserId: "user-1",
      discordInteractionId: "interaction-1",
      raceNumber: "1",
      lapNumber: "2",
      turnNumber: "3",
      carNumber: "07"
    });
    const duplicate = await createIncidentReport({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      submittedByUserId: "user-1",
      discordInteractionId: "interaction-2",
      raceNumber: "1",
      lapNumber: "2",
      turnNumber: "3",
      carNumber: "07"
    });

    expect(duplicate.status).toBe("duplicate_report");
    expect(repository.reports).toHaveLength(1);
  });

  it("formats sorted summaries and splits messages under the Discord limit", async () => {
    await seedConfig(repository);
    const session = await seedActiveSession(repository);

    await repository.insertReport(reportInput(session, "interaction-1", 2, 1, 1, "99"));
    await repository.insertReport(reportInput(session, "interaction-2", 1, 1, 3, "12A"));
    await repository.insertReport(reportInput(session, "interaction-3", 1, 1, 2, "07"));

    const reports = await repository.getOrderedReportsForSession(session.id);
    const summary = formatSessionSummary({ session, reports });

    expect(summary).toContain("`Race  Lap  Turn  Car  ID             User`");
    expect(
      summary.indexOf("`1     1    2     07   interaction-3` <@user-1>")
    ).toBeLessThan(
      summary.indexOf("`1     1    3     12A  interaction-2` <@user-1>")
    );
    expect(
      summary.indexOf("`1     1    3     12A  interaction-2` <@user-1>")
    ).toBeLessThan(
      summary.indexOf("`2     1    1     99   interaction-1` <@user-1>")
    );
    expect(splitDiscordMessage("aaaa\nbbbb\ncccc", 9)).toEqual([
      "aaaa\nbbbb",
      "cccc"
    ]);
  });

  it("rebuilds the latest closed session summary", async () => {
    await seedConfig(repository);
    const first = await seedActiveSession(repository, "channel-1");
    await repository.closeSession({
      sessionId: first.id,
      endedByUserId: "manager-1"
    });
    const second = await seedActiveSession(repository, "channel-2");
    await repository.insertReport(reportInput(second, "interaction-1", 1, 1, 1, "07"));
    await repository.closeSession({
      sessionId: second.id,
      endedByUserId: "manager-1"
    });

    const result = await getLatestClosedSessionSummary({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    expect(result.status).toBe("found");
    expect(result.status === "found" ? result.session.id : "").toBe(second.id);
    expect(result.status === "found" ? result.summaryMessages[0] : "").toContain(
      "`1     1    1     07   interaction-1` <@user-1>"
    );
  });
});

async function seedConfig(repository: MemoryIncidentRepository): Promise<void> {
  await repository.upsertGuildConfig({
    guildId: "guild-1",
    managerRoleId: "manager-role"
  });
}

async function seedActiveSession(
  repository: MemoryIncidentRepository,
  channelId = "channel-1"
): Promise<IncidentSession> {
  return repository.createSession({
    guildId: "guild-1",
    channelId,
    startedByUserId: "manager-1"
  });
}

function reportInput(
  session: IncidentSession,
  discordInteractionId: string,
  raceNumber: number,
  lapNumber: number,
  turnNumber: number,
  carNumber: string
): InsertReportInput {
  return {
    sessionId: session.id,
    guildId: session.guildId,
    submittedByUserId: "user-1",
    discordInteractionId,
    raceNumber,
    lapNumber,
    turnNumber,
    carNumber
  };
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
