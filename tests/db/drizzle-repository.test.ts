import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DrizzleIncidentRepository
} from "../../src/db/drizzle-repository";
import { RepositoryConflictError } from "../../src/db/repository";
import * as schema from "../../src/db/schema";

const createTablesSql = `
CREATE TABLE guild_configs (
  guild_id text PRIMARY KEY NOT NULL,
  manager_role_id text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE incident_sessions (
  id text PRIMARY KEY NOT NULL,
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  started_by_user_id text NOT NULL,
  ended_by_user_id text,
  status text NOT NULL,
  started_at integer NOT NULL,
  ended_at integer,
  stewarding_started_by_user_id text,
  stewarding_completed_by_user_id text,
  last_reopened_by_user_id text,
  stewarding_started_at integer,
  stewarding_completed_at integer,
  last_reopened_at integer
);

CREATE INDEX incident_sessions_reporting_lookup_idx
ON incident_sessions (guild_id, status);

CREATE INDEX incident_sessions_stewarding_lookup_idx
ON incident_sessions (guild_id, channel_id, status);

CREATE INDEX incident_sessions_latest_awaiting_stewards_lookup_idx
ON incident_sessions (guild_id, status, ended_at);

CREATE UNIQUE INDEX incident_sessions_one_open_session_per_guild_unique
ON incident_sessions (guild_id)
WHERE status <> 'decided';

CREATE TABLE incident_reports (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL,
  guild_id text NOT NULL,
  submitted_by_user_id text NOT NULL,
  discord_interaction_id text NOT NULL,
  race_number integer NOT NULL,
  lap_number integer NOT NULL,
  turn_number integer NOT NULL,
  car_number text NOT NULL,
  note text,
  created_at integer NOT NULL
);

CREATE UNIQUE INDEX incident_reports_discord_interaction_id_unique
ON incident_reports (discord_interaction_id);

CREATE INDEX incident_reports_ordered_lookup_idx
ON incident_reports (
  session_id,
  race_number,
  lap_number,
  turn_number,
  created_at
);

CREATE INDEX incident_reports_duplicate_lookup_idx
ON incident_reports (
  session_id,
  submitted_by_user_id,
  race_number,
  lap_number,
  turn_number,
  car_number
);

CREATE TABLE penalty_presets (
  id text PRIMARY KEY NOT NULL,
  guild_id text NOT NULL,
  name text NOT NULL,
  outcome text NOT NULL,
  delta integer,
  is_active integer NOT NULL,
  created_by_user_id text NOT NULL,
  deactivated_by_user_id text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  deactivated_at integer
);

CREATE INDEX penalty_presets_active_lookup_idx
ON penalty_presets (guild_id, is_active, name);

CREATE UNIQUE INDEX penalty_presets_active_name_unique
ON penalty_presets (guild_id, name)
WHERE is_active = 1;

CREATE TABLE penalties (
  id text PRIMARY KEY NOT NULL,
  incident_session_id text NOT NULL,
  incident_report_id text NOT NULL,
  affected_user_id text NOT NULL,
  penalty_preset_id text NOT NULL,
  outcome text NOT NULL,
  delta integer,
  note text,
  created_by_user_id text NOT NULL,
  updated_by_user_id text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE INDEX penalties_session_lookup_idx
ON penalties (incident_session_id);

CREATE INDEX penalties_incident_lookup_idx
ON penalties (incident_session_id, incident_report_id);

CREATE UNIQUE INDEX penalties_session_report_affected_user_unique
ON penalties (incident_session_id, incident_report_id, affected_user_id);
`;

describe("DrizzleIncidentRepository", () => {
  let sqlite: Database.Database;
  let repository: DrizzleIncidentRepository;
  let now = 1_000;
  let idNumber = 1;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(createTablesSql);

    repository = new DrizzleIncidentRepository(
      drizzle(sqlite, { schema }),
      () => now++,
      () => `id-${idNumber++}`
    );
  });

  it("creates and updates guild config", async () => {
    const created = await repository.upsertGuildConfig({
      guildId: "guild-1",
      managerRoleId: "role-1"
    });

    const updated = await repository.upsertGuildConfig({
      guildId: "guild-1",
      managerRoleId: "role-2"
    });

    await expect(repository.getGuildConfig("guild-1")).resolves.toEqual(updated);
    expect(created).toMatchObject({
      guildId: "guild-1",
      managerRoleId: "role-1",
      createdAt: 1_000,
      updatedAt: 1_000
    });
    expect(updated).toMatchObject({
      guildId: "guild-1",
      managerRoleId: "role-2",
      createdAt: 1_000,
      updatedAt: 1_001
    });
  });

  it("keeps guild configs independent across two guilds", async () => {
    const guildA = await repository.upsertGuildConfig({
      guildId: "guild-a",
      managerRoleId: "role-a"
    });
    const guildB = await repository.upsertGuildConfig({
      guildId: "guild-b",
      managerRoleId: "role-b"
    });

    await expect(repository.getGuildConfig("guild-a")).resolves.toEqual(guildA);
    await expect(repository.getGuildConfig("guild-b")).resolves.toEqual(guildB);
  });

  it("allows only one reporting session per guild", async () => {
    const session = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "user-1"
    });

    await expect(
      repository.createReportingSession({
        guildId: "guild-1",
        channelId: "channel-2",
        startedByUserId: "user-2"
      })
    ).rejects.toBeInstanceOf(RepositoryConflictError);

    await expect(repository.getReportingSessionForGuild("guild-1")).resolves.toEqual(session);
    await expect(repository.getReportingSessionForGuild("guild-1")).resolves.toEqual(
      session
    );
  });

  it("allows simultaneous reporting sessions in different guilds", async () => {
    const guildA = await repository.createReportingSession({
      guildId: "guild-a",
      channelId: "shared-channel",
      startedByUserId: "same-user"
    });
    const guildB = await repository.createReportingSession({
      guildId: "guild-b",
      channelId: "shared-channel",
      startedByUserId: "same-user"
    });

    await expect(repository.getReportingSessionForGuild("guild-a")).resolves.toEqual(guildA);
    await expect(repository.getReportingSessionForGuild("guild-b")).resolves.toEqual(guildB);
  });

  it("blocks new reporting sessions until the latest session is decided", async () => {
    const first = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "user-1"
    });

    await repository.endReportingSession({
      sessionId: first.id,
      endedByUserId: "manager-1"
    });

    await expect(
      repository.createReportingSession({
        guildId: "guild-1",
        channelId: "channel-2",
        startedByUserId: "user-2"
      })
    ).rejects.toBeInstanceOf(RepositoryConflictError);

    const stewarding = await repository.startStewardingSession({
      sessionId: first.id,
      startedByUserId: "steward-1"
    });
    expect(stewarding).toMatchObject({ status: "stewarding" });

    await expect(
      repository.createReportingSession({
        guildId: "guild-1",
        channelId: "channel-3",
        startedByUserId: "user-3"
      })
    ).rejects.toBeInstanceOf(RepositoryConflictError);

    const decided = await repository.completeStewardingSession({
      sessionId: first.id,
      completedByUserId: "steward-2"
    });
    expect(decided).toMatchObject({ status: "decided" });

    await expect(
      repository.createReportingSession({
        guildId: "guild-1",
        channelId: "channel-4",
        startedByUserId: "user-4"
      })
    ).resolves.toMatchObject({ status: "reporting", channelId: "channel-4" });
  });

  it("enforces one non-decided session per guild at the database level", () => {
    const insert = sqlite.prepare(`
      INSERT INTO incident_sessions (
        id,
        guild_id,
        channel_id,
        started_by_user_id,
        status,
        started_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    insert.run("session-1", "guild-1", "channel-1", "manager-1", "reporting", 1);
    expect(() =>
      insert.run(
        "session-2",
        "guild-1",
        "channel-2",
        "manager-2",
        "awaiting_stewards",
        2
      )
    ).toThrow();
    expect(() =>
      insert.run("session-3", "guild-1", "channel-3", "manager-3", "decided", 3)
    ).not.toThrow();
  });

  it("ends reporting and returns the latest session awaiting stewards", async () => {
    const session = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "manager-1"
    });

    const awaitingStewards = await repository.endReportingSession({
      sessionId: session.id,
      endedByUserId: "manager-1"
    });

    await expect(
      repository.getLatestSessionAwaitingStewardsForGuild("guild-1")
    ).resolves.toEqual(awaitingStewards);
    await expect(repository.getLatestSessionAwaitingStewardsForGuild("guild-1")).resolves.toEqual(
      awaitingStewards
    );
    await expect(repository.getReportingSessionForGuild("guild-1")).resolves.toBeNull();
  });

  it("returns sessions awaiting stewards only for the requested guild", async () => {
    const guildA = await repository.createReportingSession({
      guildId: "guild-a",
      channelId: "channel-a",
      startedByUserId: "manager-a"
    });
    const awaitingGuildA = await repository.endReportingSession({
      sessionId: guildA.id,
      endedByUserId: "manager-a"
    });
    const guildB = await repository.createReportingSession({
      guildId: "guild-b",
      channelId: "channel-b",
      startedByUserId: "manager-b"
    });
    const closedGuildB = await repository.endReportingSession({
      sessionId: guildB.id,
      endedByUserId: "manager-b"
    });

    await expect(
      repository.getLatestSessionAwaitingStewardsForGuild("guild-a")
    ).resolves.toEqual(awaitingGuildA);
    await expect(
      repository.getLatestSessionAwaitingStewardsForGuild("guild-b")
    ).resolves.toEqual(closedGuildB);
  });

  it("starts, completes, and reopens stewarding sessions", async () => {
    const session = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "manager-1"
    });
    await repository.endReportingSession({
      sessionId: session.id,
      endedByUserId: "manager-1"
    });

    const stewarding = await repository.startStewardingSession({
      sessionId: session.id,
      startedByUserId: "steward-1"
    });
    expect(stewarding).toMatchObject({
      status: "stewarding",
      stewardingStartedByUserId: "steward-1"
    });
    await expect(repository.getStewardingSessionForGuild("guild-1")).resolves.toEqual(
      stewarding
    );
    await expect(
      repository.getStewardingSessionForChannel("guild-1", "channel-1")
    ).resolves.toEqual(stewarding);
    await expect(
      repository.getStewardingSessionForChannel("guild-1", "channel-other")
    ).resolves.toBeNull();

    const decided = await repository.completeStewardingSession({
      sessionId: session.id,
      completedByUserId: "steward-2"
    });
    expect(decided).toMatchObject({
      status: "decided",
      stewardingCompletedByUserId: "steward-2"
    });
    await expect(repository.getLatestDecidedSessionForGuild("guild-1")).resolves.toEqual(
      decided
    );

    const reopened = await repository.reopenDecidedSessionForStewarding({
      guildId: "guild-1",
      reopenedByUserId: "manager-2"
    });
    expect(reopened).toMatchObject({
      status: "reopened",
      session: {
        status: "stewarding",
        stewardingCompletedByUserId: null,
        stewardingCompletedAt: null,
        lastReopenedByUserId: "manager-2"
      }
    });
  });

  it("does not reopen an older decided session after a newer reporting session starts", async () => {
    const first = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "manager-1"
    });
    await repository.endReportingSession({
      sessionId: first.id,
      endedByUserId: "manager-1"
    });
    await repository.startStewardingSession({
      sessionId: first.id,
      startedByUserId: "steward-1"
    });
    await repository.completeStewardingSession({
      sessionId: first.id,
      completedByUserId: "steward-2"
    });

    const second = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-2",
      startedByUserId: "manager-2"
    });

    await expect(
      repository.reopenDecidedSessionForStewarding({
        guildId: "guild-1",
        reopenedByUserId: "manager-3"
      })
    ).resolves.toMatchObject({
      status: "no_decided_session",
      session: {
        id: second.id,
        status: "reporting"
      }
    });
  });

  it("does not reopen an older decided session while a newer session is stewarding", async () => {
    const first = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "manager-1"
    });
    await repository.endReportingSession({
      sessionId: first.id,
      endedByUserId: "manager-1"
    });
    await repository.startStewardingSession({
      sessionId: first.id,
      startedByUserId: "steward-1"
    });
    await repository.completeStewardingSession({
      sessionId: first.id,
      completedByUserId: "steward-2"
    });

    const second = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-2",
      startedByUserId: "manager-2"
    });
    await repository.endReportingSession({
      sessionId: second.id,
      endedByUserId: "manager-2"
    });
    const stewarding = await repository.startStewardingSession({
      sessionId: second.id,
      startedByUserId: "steward-3"
    });
    expect(stewarding).not.toBeNull();

    await expect(
      repository.reopenDecidedSessionForStewarding({
        guildId: "guild-1",
        reopenedByUserId: "manager-3"
      })
    ).resolves.toMatchObject({
      status: "already_stewarding",
      session: {
        id: stewarding!.id,
        status: "stewarding"
      }
    });
  });

  it("reopens latest stewarding sessions to reporting before penalties exist", async () => {
    const first = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "manager-1"
    });
    await repository.endReportingSession({
      sessionId: first.id,
      endedByUserId: "manager-1"
    });
    await repository.startStewardingSession({
      sessionId: first.id,
      startedByUserId: "steward-1"
    });
    await repository.insertReport(reportInput(first.id, "i-1", 1, 1, 1, "07"));

    const reopened = await repository.reopenStewardingSessionForReporting({
      guildId: "guild-1",
      reopenedByUserId: "manager-2"
    });

    expect(reopened).toMatchObject({
      status: "reopened",
      session: {
        status: "reporting",
        endedByUserId: null,
        endedAt: null,
        stewardingStartedByUserId: null,
        stewardingStartedAt: null,
        lastReopenedByUserId: "manager-2"
      }
    });
    await expect(repository.getOrderedReportsForSession(first.id)).resolves.toHaveLength(
      1
    );
  });

  it("does not reopen reporting when latest stewarding session has penalties", async () => {
    const session = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "manager-1"
    });
    const report = await repository.insertReport(
      reportInput(session.id, "i-1", 1, 1, 1, "07")
    );
    const preset = await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Warning",
      outcome: "Warning",
      delta: null,
      createdByUserId: "manager-1"
    });

    await repository.endReportingSession({
      sessionId: session.id,
      endedByUserId: "manager-1"
    });
    await repository.startStewardingSession({
      sessionId: session.id,
      startedByUserId: "steward-1"
    });
    await repository.upsertPenaltyForIncidentSession({
      incidentSessionId: session.id,
      incidentReportId: report.report.id,
      affectedUserId: "driver-1",
      penaltyPresetId: preset.id,
      outcome: preset.outcome,
      delta: preset.delta,
      note: null,
      createdByUserId: "manager-1",
      updatedByUserId: "manager-1"
    });

    await expect(
      repository.reopenStewardingSessionForReporting({
        guildId: "guild-1",
        reopenedByUserId: "manager-2"
      })
    ).resolves.toMatchObject({ status: "penalties_exist" });
  });

  it("sorts reports by race, lap, turn, then creation time", async () => {
    const session = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "manager-1"
    });

    await repository.insertReport(reportInput(session.id, "i-1", 2, 1, 1, "12"));
    await repository.insertReport(reportInput(session.id, "i-2", 1, 2, 1, "99"));
    await repository.insertReport(reportInput(session.id, "i-3", 1, 1, 3, "3"));
    await repository.insertReport(reportInput(session.id, "i-4", 1, 1, 2, "07"));

    const reports = await repository.getOrderedReportsForSession(session.id);

    expect(reports.map((report) => report.discordInteractionId)).toEqual([
      "i-4",
      "i-3",
      "i-2",
      "i-1"
    ]);
  });

  it("returns ordered reports for only the requested session", async () => {
    const guildA = await repository.createReportingSession({
      guildId: "guild-a",
      channelId: "shared-channel",
      startedByUserId: "same-user"
    });
    const guildB = await repository.createReportingSession({
      guildId: "guild-b",
      channelId: "shared-channel",
      startedByUserId: "same-user"
    });

    await repository.insertReport(
      reportInput(guildA.id, "guild-a-report", 1, 1, 1, "07", "guild-a")
    );
    await repository.insertReport(
      reportInput(guildB.id, "guild-b-report", 1, 1, 1, "99", "guild-b")
    );

    await expect(repository.getOrderedReportsForSession(guildA.id)).resolves.toEqual([
      expect.objectContaining({ discordInteractionId: "guild-a-report" })
    ]);
    await expect(repository.getOrderedReportsForSession(guildB.id)).resolves.toEqual([
      expect.objectContaining({ discordInteractionId: "guild-b-report" })
    ]);
  });

  it("preserves text formatting for car numbers", async () => {
    const session = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "manager-1"
    });

    const first = await repository.insertReport(
      reportInput(session.id, "i-1", 1, 1, 1, "07")
    );
    const second = await repository.insertReport(
      reportInput(session.id, "i-2", 1, 1, 2, "12A")
    );

    expect(first.report.carNumber).toBe("07");
    expect(second.report.carNumber).toBe("12A");
  });

  it("inserts and reads optional report notes", async () => {
    const session = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "manager-1"
    });

    const withNote = await repository.insertReport({
      ...reportInput(session.id, "i-1", 1, 1, 1, "07"),
      note: "Driver said the car rejoined unsafely"
    });
    const withoutNote = await repository.insertReport(
      reportInput(session.id, "i-2", 1, 1, 2, "12")
    );

    expect(withNote.report.note).toBe("Driver said the car rejoined unsafely");
    expect(withoutNote.report.note).toBeNull();
    await expect(repository.getReportByDiscordInteractionId("i-1")).resolves.toEqual(
      withNote.report
    );
    await expect(repository.getOrderedReportsForSession(session.id)).resolves.toEqual([
      withNote.report,
      withoutNote.report
    ]);
  });

  it("makes duplicate modal interaction IDs idempotent", async () => {
    const session = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "manager-1"
    });

    const input = reportInput(session.id, "interaction-1", 1, 1, 1, "07");
    const first = await repository.insertReport(input);
    const second = await repository.insertReport(input);

    await expect(repository.getOrderedReportsForSession(session.id)).resolves.toHaveLength(
      1
    );
    expect(first.status).toBe("inserted");
    expect(second).toEqual({
      status: "duplicate_interaction",
      report: first.report
    });
  });

  it("finds exact duplicate reports from the same user in the same session", async () => {
    const session = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "manager-1"
    });

    const inserted = await repository.insertReport(
      reportInput(session.id, "interaction-1", 1, 2, 3, "12A")
    );

    await expect(
      repository.findDuplicateReportForUser({
        sessionId: session.id,
        submittedByUserId: "user-1",
        raceNumber: 1,
        lapNumber: 2,
        turnNumber: 3,
        carNumber: "12A"
      })
    ).resolves.toEqual(inserted.report);
  });

  it("creates, lists, searches, and deactivates active penalty presets by guild", async () => {
    const stopGo = await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Stop Go",
      outcome: "10s stop-go",
      delta: 10,
      createdByUserId: "manager-1"
    });
    const warning = await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Warning",
      outcome: "Official warning",
      delta: null,
      createdByUserId: "manager-1"
    });
    await repository.createPenaltyPreset({
      guildId: "guild-2",
      name: "Stop Go",
      outcome: "Other guild outcome",
      delta: 20,
      createdByUserId: "manager-2"
    });

    await expect(repository.listPenaltyPresetsForGuild("guild-1")).resolves.toEqual([
      stopGo,
      warning
    ]);
    await expect(
      repository.searchPenaltyPresetsForGuild("guild-1", "Stop")
    ).resolves.toEqual([stopGo]);
    await expect(
      repository.getActivePenaltyPresetForGuild("guild-1", stopGo.id)
    ).resolves.toEqual(stopGo);
    await expect(
      repository.getActivePenaltyPresetForGuild("guild-1", "Warning")
    ).resolves.toEqual(warning);

    const deactivated = await repository.deactivatePenaltyPreset({
      presetId: stopGo.id,
      deactivatedByUserId: "manager-3"
    });
    expect(deactivated).toMatchObject({
      id: stopGo.id,
      isActive: false,
      deactivatedByUserId: "manager-3"
    });
    await expect(repository.listPenaltyPresetsForGuild("guild-1")).resolves.toEqual([
      warning
    ]);
    await expect(
      repository.getActivePenaltyPresetForGuild("guild-1", stopGo.id)
    ).resolves.toBeNull();
  });

  it("enforces unique active penalty preset names at the database level", async () => {
    const warning = await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Warning",
      outcome: "Official warning",
      delta: null,
      createdByUserId: "manager-1"
    });

    await expect(
      repository.createPenaltyPreset({
        guildId: "guild-1",
        name: "Warning",
        outcome: "Duplicate warning",
        delta: null,
        createdByUserId: "manager-2"
      })
    ).rejects.toThrow();

    const removed = await repository.deactivatePenaltyPreset({
      presetId: warning.id,
      deactivatedByUserId: "manager-1"
    });
    expect(removed).toMatchObject({ isActive: false });

    await expect(
      repository.createPenaltyPreset({
        guildId: "guild-1",
        name: "Warning",
        outcome: "Replacement warning",
        delta: null,
        createdByUserId: "manager-3"
      })
    ).resolves.toMatchObject({ name: "Warning", isActive: true });
  });

  it("limits penalty preset autocomplete search to 25 active guild presets", async () => {
    for (let index = 0; index < 30; index++) {
      await repository.createPenaltyPreset({
        guildId: "guild-1",
        name: `Penalty ${index.toString().padStart(2, "0")}`,
        outcome: `Outcome ${index}`,
        delta: index,
        createdByUserId: "manager-1"
      });
    }

    const results = await repository.searchPenaltyPresetsForGuild("guild-1", "");

    expect(results).toHaveLength(25);
    expect(results[0]?.name).toBe("Penalty 00");
    expect(results[24]?.name).toBe("Penalty 24");
  });

  it("resolves incident reports only inside the current stewarding session", async () => {
    const session = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "manager-1"
    });
    const report = await repository.insertReport(
      reportInput(session.id, "incident-public-id", 1, 1, 1, "07")
    );

    await expect(
      repository.getReportForStewardingSessionByDiscordInteractionId(
        session.id,
        "guild-1",
        "incident-public-id"
      )
    ).resolves.toBeNull();

    await repository.endReportingSession({
      sessionId: session.id,
      endedByUserId: "manager-1"
    });
    await repository.startStewardingSession({
      sessionId: session.id,
      startedByUserId: "steward-1"
    });

    await expect(
      repository.getReportForStewardingSessionByDiscordInteractionId(
        session.id,
        "guild-1",
        "incident-public-id"
      )
    ).resolves.toEqual(report.report);
    await expect(
      repository.getReportForStewardingSessionByDiscordInteractionId(
        session.id,
        "guild-2",
        "incident-public-id"
      )
    ).resolves.toBeNull();
  });

  it("inserts, updates, summarizes, and clears penalty decisions", async () => {
    const session = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "manager-1"
    });
    const report = await repository.insertReport(
      reportInput(session.id, "incident-1", 1, 1, 1, "07")
    );
    const otherReport = await repository.insertReport(
      reportInput(session.id, "incident-2", 1, 1, 2, "11")
    );
    const warning = await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Warning",
      outcome: "Official warning",
      delta: null,
      createdByUserId: "manager-1"
    });
    const timePenalty = await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Time",
      outcome: "5 second penalty",
      delta: 5,
      createdByUserId: "manager-1"
    });

    const inserted = await repository.upsertPenaltyForIncidentSession({
      incidentSessionId: session.id,
      incidentReportId: report.report.id,
      affectedUserId: "driver-1",
      penaltyPresetId: warning.id,
      outcome: warning.outcome,
      delta: warning.delta,
      note: "First decision",
      createdByUserId: "steward-1",
      updatedByUserId: "steward-1"
    });
    expect(inserted).toMatchObject({
      status: "inserted",
      penalty: {
        incidentReportId: report.report.id,
        affectedUserId: "driver-1",
        outcome: "Official warning"
      }
    });

    const updated = await repository.upsertPenaltyForIncidentSession({
      incidentSessionId: session.id,
      incidentReportId: report.report.id,
      affectedUserId: "driver-1",
      penaltyPresetId: timePenalty.id,
      outcome: timePenalty.outcome,
      delta: timePenalty.delta,
      note: "Corrected decision",
      createdByUserId: "steward-ignored",
      updatedByUserId: "steward-2"
    });
    expect(updated).toMatchObject({
      status: "updated",
      penalty: {
        id: inserted.penalty.id,
        outcome: "5 second penalty",
        delta: 5,
        note: "Corrected decision",
        createdByUserId: "steward-1",
        updatedByUserId: "steward-2"
      }
    });

    await repository.upsertPenaltyForIncidentSession({
      incidentSessionId: session.id,
      incidentReportId: report.report.id,
      affectedUserId: "driver-2",
      penaltyPresetId: warning.id,
      outcome: warning.outcome,
      delta: warning.delta,
      note: null,
      createdByUserId: "steward-1",
      updatedByUserId: "steward-1"
    });
    await repository.upsertPenaltyForIncidentSession({
      incidentSessionId: session.id,
      incidentReportId: otherReport.report.id,
      affectedUserId: "driver-3",
      penaltyPresetId: warning.id,
      outcome: "Historical warning",
      delta: warning.delta,
      note: null,
      createdByUserId: "steward-1",
      updatedByUserId: "steward-1"
    });
    await repository.deactivatePenaltyPreset({
      presetId: warning.id,
      deactivatedByUserId: "manager-1"
    });

    const summaryRows = await repository.getPenaltiesWithReportsForSession(session.id);
    expect(summaryRows.map((row) => row.penalty.outcome)).toEqual([
      "5 second penalty",
      "Official warning",
      "Historical warning"
    ]);
    expect(summaryRows[1]?.preset?.isActive).toBe(false);

    await expect(
      repository.clearPenaltiesForIncidentInSession({
        incidentSessionId: session.id,
        incidentReportId: report.report.id
      })
    ).resolves.toBe(2);
    await expect(repository.getPenaltiesWithReportsForSession(session.id)).resolves.toEqual([
      expect.objectContaining({
        penalty: expect.objectContaining({ incidentReportId: otherReport.report.id })
      })
    ]);
  });
});

function reportInput(
  sessionId: string,
  discordInteractionId: string,
  raceNumber: number,
  lapNumber: number,
  turnNumber: number,
  carNumber: string,
  guildId = "guild-1"
) {
  return {
    sessionId,
    guildId,
    submittedByUserId: "user-1",
    discordInteractionId,
    raceNumber,
    lapNumber,
    turnNumber,
    carNumber
  };
}
