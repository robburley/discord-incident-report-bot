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
  ended_at integer
);

CREATE INDEX incident_sessions_active_lookup_idx
ON incident_sessions (guild_id, status);

CREATE INDEX incident_sessions_latest_closed_lookup_idx
ON incident_sessions (guild_id, status, ended_at);

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

  it("allows only one active session per guild", async () => {
    const session = await repository.createSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "user-1"
    });

    await expect(
      repository.createSession({
        guildId: "guild-1",
        channelId: "channel-2",
        startedByUserId: "user-2"
      })
    ).rejects.toBeInstanceOf(RepositoryConflictError);

    await expect(repository.getActiveSession("guild-1")).resolves.toEqual(session);
  });

  it("allows simultaneous active sessions in different guilds", async () => {
    const guildA = await repository.createSession({
      guildId: "guild-a",
      channelId: "shared-channel",
      startedByUserId: "same-user"
    });
    const guildB = await repository.createSession({
      guildId: "guild-b",
      channelId: "shared-channel",
      startedByUserId: "same-user"
    });

    await expect(repository.getActiveSession("guild-a")).resolves.toEqual(guildA);
    await expect(repository.getActiveSession("guild-b")).resolves.toEqual(guildB);
  });

  it("closes sessions and returns the latest closed session for a guild", async () => {
    const first = await repository.createSession({
      guildId: "guild-1",
      channelId: "channel-1",
      startedByUserId: "user-1"
    });

    await repository.closeSession({
      sessionId: first.id,
      endedByUserId: "manager-1"
    });

    const second = await repository.createSession({
      guildId: "guild-1",
      channelId: "channel-2",
      startedByUserId: "user-2"
    });

    const closedSecond = await repository.closeSession({
      sessionId: second.id,
      endedByUserId: "manager-2"
    });

    await expect(
      repository.getLatestClosedSessionForGuild("guild-1")
    ).resolves.toEqual(closedSecond);
  });

  it("returns the latest closed session only for the requested guild", async () => {
    const guildAOld = await repository.createSession({
      guildId: "guild-a",
      channelId: "channel-a-old",
      startedByUserId: "manager-a"
    });
    await repository.closeSession({
      sessionId: guildAOld.id,
      endedByUserId: "manager-a"
    });
    const guildB = await repository.createSession({
      guildId: "guild-b",
      channelId: "channel-b",
      startedByUserId: "manager-b"
    });
    const closedGuildB = await repository.closeSession({
      sessionId: guildB.id,
      endedByUserId: "manager-b"
    });
    const guildANew = await repository.createSession({
      guildId: "guild-a",
      channelId: "channel-a-new",
      startedByUserId: "manager-a"
    });
    const closedGuildANew = await repository.closeSession({
      sessionId: guildANew.id,
      endedByUserId: "manager-a"
    });

    await expect(
      repository.getLatestClosedSessionForGuild("guild-a")
    ).resolves.toEqual(closedGuildANew);
    await expect(
      repository.getLatestClosedSessionForGuild("guild-b")
    ).resolves.toEqual(closedGuildB);
  });

  it("sorts reports by race, lap, turn, then creation time", async () => {
    const session = await repository.createSession({
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
    const guildA = await repository.createSession({
      guildId: "guild-a",
      channelId: "shared-channel",
      startedByUserId: "same-user"
    });
    const guildB = await repository.createSession({
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
    const session = await repository.createSession({
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

  it("makes duplicate modal interaction IDs idempotent", async () => {
    const session = await repository.createSession({
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
    const session = await repository.createSession({
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
