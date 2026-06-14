import { beforeEach, describe, expect, it } from "vitest";

import { hasIncidentManagerPermission } from "../../src/core/authorization";
import {
  configureGuildManagerRole,
  getGuildConfigStatus
} from "../../src/core/config";
import {
  createIncidentReport,
  INCIDENT_REPORT_NOTE_LIMIT,
  validateIncidentReportFields
} from "../../src/core/incidents";
import {
  addPenaltyPreset,
  applyPenalty,
  clearPenaltyForIncident,
  completeStewarding,
  getLatestDecisionSummary,
  getLatestIncidentSessionSummary,
  listPenaltyPresets,
  removePenaltyPreset,
  reopenReporting,
  reopenStewarding,
  searchPenaltyPresets,
  startIncidentSession,
  startStewarding
} from "../../src/core/sessions";
import {
  DISCORD_MESSAGE_LIMIT,
  formatSplitSessionSummary,
  formatSessionSummary,
  splitDiscordMessage
} from "../../src/core/summary";
import { RepositoryConflictError } from "../../src/db/repository";
import type {
  EndReportingSessionInput,
  ClearPenaltiesForIncidentInput,
  CompleteStewardingSessionInput,
  CreatePenaltyPresetInput,
  CreateReportingSessionInput,
  DeactivatePenaltyPresetInput,
  DuplicateReportInput,
  GuildConfig,
  IncidentReport,
  IncidentRepository,
  IncidentSession,
  InsertReportInput,
  InsertReportResult,
  InsertProcessedDiscordInteractionInput,
  InsertProcessedDiscordInteractionResult,
  Penalty,
  PenaltyDecisionSummaryRow,
  PenaltyPreset,
  ReopenDecidedSessionForStewardingInput,
  ReopenDecidedSessionForStewardingResult,
  ReopenStewardingSessionForReportingInput,
  ReopenStewardingSessionForReportingResult,
  StartStewardingSessionInput,
  UpsertPenaltyInput,
  UpsertPenaltyResult,
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

  it("reports guild configuration status", async () => {
    const unconfigured = await getGuildConfigStatus({
      repository,
      guildId: "guild-1"
    });
    await seedConfig(repository);
    const configured = await getGuildConfigStatus({
      repository,
      guildId: "guild-1"
    });

    expect(unconfigured).toMatchObject({
      status: "not_configured",
      message:
        "No incident manager role is configured. This server is not configured yet. A server admin must run `/incident-config role role:<manager role>` before incident commands can be used."
    });
    expect(configured).toMatchObject({
      status: "configured",
      message: "Incident bot is configured. Manager role: <@&manager-role>.",
      config: {
        managerRoleId: "manager-role"
      }
    });
  });

  it("keeps manager role configuration independent across two guilds", async () => {
    await configureGuildManagerRole({
      repository,
      guildId: "guild-a",
      managerRoleId: "manager-role-a"
    });
    await configureGuildManagerRole({
      repository,
      guildId: "guild-b",
      managerRoleId: "manager-role-b"
    });

    await expect(repository.getGuildConfig("guild-a")).resolves.toMatchObject({
      managerRoleId: "manager-role-a"
    });
    await expect(repository.getGuildConfig("guild-b")).resolves.toMatchObject({
      managerRoleId: "manager-role-b"
    });
  });

  it("authorizes members by configured manager role", () => {
    expect(
      hasIncidentManagerPermission({
        managerRoleId: "manager-role",
        memberRoleIds: ["driver-role", "manager-role"]
      })
    ).toBe(true);

    expect(
      hasIncidentManagerPermission({
        managerRoleId: "manager-role",
        memberRoleIds: ["driver-role"],
        canManageGuild: true
      })
    ).toBe(true);

    expect(
      hasIncidentManagerPermission({
        managerRoleId: "manager-role",
        memberRoleIds: ["driver-role"]
      })
    ).toBe(false);
  });

  it("starts and prevents a second reporting session", async () => {
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
    expect(duplicate.status).toBe("previous_session_not_decided");
  });

  it("scopes reporting session checks by guild", async () => {
    await seedConfig(repository, "guild-a", "manager-role-a");
    await seedConfig(repository, "guild-b", "manager-role-b");

    const first = await startIncidentSession({
      repository,
      guildId: "guild-a",
      channelId: "shared-channel",
      userId: "same-user",
      memberRoleIds: ["manager-role-a"]
    });
    const second = await startIncidentSession({
      repository,
      guildId: "guild-b",
      channelId: "shared-channel",
      userId: "same-user",
      memberRoleIds: ["manager-role-b"]
    });
    const duplicate = await startIncidentSession({
      repository,
      guildId: "guild-a",
      channelId: "other-channel",
      userId: "same-user",
      memberRoleIds: ["manager-role-a"]
    });

    expect(first.status).toBe("started");
    expect(second.status).toBe("started");
    expect(duplicate.status).toBe("previous_session_not_decided");
    await expect(repository.getReportingSessionForGuild("guild-a")).resolves.toMatchObject({
      guildId: "guild-a",
      channelId: "shared-channel"
    });
    await expect(repository.getReportingSessionForGuild("guild-b")).resolves.toMatchObject({
      guildId: "guild-b",
      channelId: "shared-channel"
    });
  });

  it("does not start sessions or stewarding without the manager role", async () => {
    await seedConfig(repository);

    const start = await startIncidentSession({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
      memberRoleIds: ["driver-role"]
    });
    const stewarding = await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "user-1",
      memberRoleIds: []
    });

    expect(start.status).toBe("unauthorized");
    expect(stewarding.status).toBe("unauthorized");
  });

  it("allows server admins to perform manager session actions", async () => {
    await seedConfig(repository);

    const start = await startIncidentSession({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "admin-1",
      memberRoleIds: ["driver-role"],
      canManageGuild: true
    });

    expect(start.status).toBe("started");
  });

  it("starts stewarding from reporting and produces an empty public summary", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository);

    const result = await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    expect(result.status).toBe("started");
    expect(result.status === "started" ? result.session.status : "").toBe(
      "stewarding"
    );
    expect(result.status === "started" ? result.summaryMessages[0] : "").toContain(
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
        carNumber: "07_A",
        note: null
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

  it("validates and normalizes optional incident report notes", () => {
    expect(
      validateIncidentReportFields({
        raceNumber: "1",
        lapNumber: "2",
        turnNumber: "3",
        carNumber: "07",
        note: " avoid line breaks \n and `ticks` "
      })
    ).toEqual({
      status: "valid",
      value: {
        raceNumber: 1,
        lapNumber: 2,
        turnNumber: 3,
        carNumber: "07",
        note: "avoid line breaks and 'ticks'"
      }
    });

    expect(
      validateIncidentReportFields({
        raceNumber: "1",
        lapNumber: "2",
        turnNumber: "3",
        carNumber: "07",
        note: " \n\t "
      })
    ).toEqual({
      status: "valid",
      value: {
        raceNumber: 1,
        lapNumber: 2,
        turnNumber: 3,
        carNumber: "07",
        note: null
      }
    });

    expect(
      validateIncidentReportFields({
        raceNumber: "1",
        lapNumber: "2",
        turnNumber: "3",
        carNumber: "07",
        note: "please review @everyone <@1234567890> <@&9876543210>"
      })
    ).toEqual({
      status: "valid",
      value: {
        raceNumber: 1,
        lapNumber: 2,
        turnNumber: 3,
        carNumber: "07",
        note: "please review @\u200beveryone <@\u200b1234567890> <@\u200b&9876543210>"
      }
    });

    expect(
      validateIncidentReportFields({
        raceNumber: "1",
        lapNumber: "2",
        turnNumber: "3",
        carNumber: "07",
        note: "a".repeat(INCIDENT_REPORT_NOTE_LIMIT + 1)
      })
    ).toEqual({
      status: "invalid",
      message: `Report note must be ${INCIDENT_REPORT_NOTE_LIMIT} characters or fewer.`
    });
  });

  it("creates incident reports only for a reporting session channel", async () => {
    await seedConfig(repository);
    const session = await seedReportingSession(repository);

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
    const session = await seedReportingSession(repository);
    await repository.endReportingSession({
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

    expect(result.status).toBe("no_reporting_session");
  });

  it("keeps duplicate modal interaction IDs idempotent", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository);

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

  it("stores a normalized incident report note", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository);

    const created = await createIncidentReport({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      submittedByUserId: "user-1",
      discordInteractionId: "interaction-1",
      raceNumber: "1",
      lapNumber: "2",
      turnNumber: "3",
      carNumber: "07",
      note: " clipped `track limits` \n on exit "
    });

    expect(created.status).toBe("created");
    expect(created.status === "created" ? created.report.note : "").toBe(
      "clipped 'track limits' on exit"
    );
    expect(repository.reports[0]?.note).toBe("clipped 'track limits' on exit");
  });

  it("rejects exact duplicate reports from the same user", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository);

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

  it("ignores incident report notes when checking duplicates", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository);

    await createIncidentReport({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      submittedByUserId: "user-1",
      discordInteractionId: "interaction-1",
      raceNumber: "1",
      lapNumber: "2",
      turnNumber: "3",
      carNumber: "07",
      note: "first note"
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
      carNumber: "07",
      note: "different note"
    });

    expect(duplicate.status).toBe("duplicate_report");
    expect(repository.reports).toHaveLength(1);
  });

  it("formats sorted summaries and splits messages under the Discord limit", async () => {
    await seedConfig(repository);
    const session = await seedReportingSession(repository);

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

  it("formats incident summary notes after user mentions and outside table code", async () => {
    await seedConfig(repository);
    const session = await seedReportingSession(repository);

    await repository.insertReport(
      reportInput(session, "interaction-1", 1, 1, 1, "07", "driver note")
    );
    await repository.insertReport(reportInput(session, "interaction-2", 1, 1, 2, "12"));

    const reports = await repository.getOrderedReportsForSession(session.id);
    const summary = formatSessionSummary({ session, reports });

    expect(summary).toContain(
      "`1     1    1     07   interaction-1` <@user-1> driver note"
    );
    expect(summary).toContain("`1     1    2     12   interaction-2` <@user-1>");
    expect(summary).not.toContain("interaction-1  driver note`");
  });

  it("includes incident summary notes when summary messages are split", async () => {
    await seedConfig(repository);
    const session = await seedReportingSession(repository);
    const note = "n".repeat(INCIDENT_REPORT_NOTE_LIMIT);

    for (let index = 0; index < 10; index += 1) {
      await repository.insertReport(
        reportInput(session, `interaction-${index + 1}`, 1, 1, index + 1, "07", note)
      );
    }

    const reports = await repository.getOrderedReportsForSession(session.id);
    const messages = formatSplitSessionSummary({ session, reports });

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.length <= DISCORD_MESSAGE_LIMIT)).toBe(
      true
    );
    expect(messages.join("\n")).toContain(`<@user-1> ${note}`);
  });

  it("rebuilds the latest incident report summary", async () => {
    await seedConfig(repository);
    const first = await seedReportingSession(repository, "channel-1");
    await repository.endReportingSession({
      sessionId: first.id,
      endedByUserId: "manager-1"
    });
    await repository.startStewardingSession({
      sessionId: first.id,
      startedByUserId: "manager-1"
    });
    await repository.completeStewardingSession({
      sessionId: first.id,
      completedByUserId: "manager-1"
    });
    const second = await seedReportingSession(repository, "channel-2");
    await repository.insertReport(reportInput(second, "interaction-1", 1, 1, 1, "07"));
    await repository.endReportingSession({
      sessionId: second.id,
      endedByUserId: "manager-1"
    });

    const result = await getLatestIncidentSessionSummary({
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

  it("rebuilds summaries from only the invoking guild's latest incident report session", async () => {
    await seedConfig(repository, "guild-a", "manager-role-a");
    await seedConfig(repository, "guild-b", "manager-role-b");
    const guildAOld = await seedReportingSession(repository, "channel-a-old", "guild-a");
    await repository.insertReport(
      reportInput(guildAOld, "guild-a-old-report", 1, 1, 1, "11")
    );
    await repository.endReportingSession({
      sessionId: guildAOld.id,
      endedByUserId: "manager-a"
    });
    await repository.startStewardingSession({
      sessionId: guildAOld.id,
      startedByUserId: "manager-a"
    });
    await repository.completeStewardingSession({
      sessionId: guildAOld.id,
      completedByUserId: "manager-a"
    });
    const guildBSession = await seedReportingSession(repository, "channel-b", "guild-b");
    await repository.insertReport(
      reportInput(guildBSession, "guild-b-report", 2, 1, 1, "22")
    );
    await repository.endReportingSession({
      sessionId: guildBSession.id,
      endedByUserId: "manager-b"
    });
    const guildANew = await seedReportingSession(repository, "channel-a-new", "guild-a");
    await repository.insertReport(
      reportInput(guildANew, "guild-a-new-report", 3, 1, 1, "33")
    );
    await repository.endReportingSession({
      sessionId: guildANew.id,
      endedByUserId: "manager-a"
    });

    const guildAResult = await getLatestIncidentSessionSummary({
      repository,
      guildId: "guild-a",
      userId: "manager-a",
      memberRoleIds: ["manager-role-a"]
    });
    const guildBResult = await getLatestIncidentSessionSummary({
      repository,
      guildId: "guild-b",
      userId: "manager-b",
      memberRoleIds: ["manager-role-b"]
    });

    expect(guildAResult.status).toBe("found");
    expect(guildAResult.status === "found" ? guildAResult.session.id : "").toBe(
      guildANew.id
    );
    expect(
      guildAResult.status === "found" ? guildAResult.summaryMessages[0] : ""
    ).toContain("guild-a-new-report");
    expect(
      guildAResult.status === "found" ? guildAResult.summaryMessages[0] : ""
    ).not.toContain("guild-b-report");
    expect(guildBResult.status).toBe("found");
    expect(guildBResult.status === "found" ? guildBResult.session.id : "").toBe(
      guildBSession.id
    );
    expect(
      guildBResult.status === "found" ? guildBResult.summaryMessages[0] : ""
    ).toContain("guild-b-report");
    expect(
      guildBResult.status === "found" ? guildBResult.summaryMessages[0] : ""
    ).not.toContain("guild-a-new-report");
  });

  it("keeps reports from one guild out of another guild's summary", async () => {
    await seedConfig(repository, "guild-a", "manager-role");
    await seedConfig(repository, "guild-b", "manager-role");
    const guildASession = await seedReportingSession(
      repository,
      "shared-channel",
      "guild-a"
    );
    const guildBSession = await seedReportingSession(
      repository,
      "shared-channel",
      "guild-b"
    );

    await createIncidentReport({
      repository,
      guildId: "guild-a",
      channelId: "shared-channel",
      submittedByUserId: "same-user",
      discordInteractionId: "guild-a-interaction",
      raceNumber: "1",
      lapNumber: "1",
      turnNumber: "1",
      carNumber: "07"
    });
    await createIncidentReport({
      repository,
      guildId: "guild-b",
      channelId: "shared-channel",
      submittedByUserId: "same-user",
      discordInteractionId: "guild-b-interaction",
      raceNumber: "2",
      lapNumber: "1",
      turnNumber: "1",
      carNumber: "99"
    });
    await repository.endReportingSession({
      sessionId: guildASession.id,
      endedByUserId: "manager-a"
    });
    await repository.endReportingSession({
      sessionId: guildBSession.id,
      endedByUserId: "manager-b"
    });

    const guildAResult = await getLatestIncidentSessionSummary({
      repository,
      guildId: "guild-a",
      userId: "manager-a",
      memberRoleIds: ["manager-role"]
    });

    expect(guildAResult.status).toBe("found");
    expect(
      guildAResult.status === "found" ? guildAResult.summaryMessages[0] : ""
    ).toContain("guild-a-interaction");
    expect(
      guildAResult.status === "found" ? guildAResult.summaryMessages[0] : ""
    ).not.toContain("guild-b-interaction");
  });

  it("moves sessions through reporting, stewarding, decided, and reopen transitions", async () => {
    await seedConfig(repository);
    const started = await startIncidentSession({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    expect(started.status).toBe("started");

    const stewarding = await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    expect(stewarding.status).toBe("started");
    expect(stewarding.status === "started" ? stewarding.session.status : "").toBe(
      "stewarding"
    );

    const duplicate = await startIncidentSession({
      repository,
      guildId: "guild-1",
      channelId: "channel-2",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    expect(duplicate.status).toBe("previous_session_not_decided");

    const completed = await completeStewarding({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    expect(completed.status).toBe("completed");
    expect(completed.status === "completed" ? completed.session.status : "").toBe(
      "decided"
    );
    expect(
      completed.status === "completed" ? completed.summaryMessages[0] : ""
    ).toContain("No penalties were assigned.");

    const reopenedStewarding = await reopenStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    expect(reopenedStewarding.status).toBe("reopened");
    expect(
      reopenedStewarding.status === "reopened"
        ? reopenedStewarding.session.status
        : ""
    ).toBe("stewarding");
  });

  it("reopens stewarding when the latest session is decided", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository);
    await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    await completeStewarding({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    const reopened = await reopenStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-2",
      memberRoleIds: ["manager-role"]
    });

    expect(reopened.status).toBe("reopened");
    expect(reopened.status === "reopened" ? reopened.session : null).toMatchObject({
      status: "stewarding",
      stewardingCompletedByUserId: null,
      stewardingCompletedAt: null,
      lastReopenedByUserId: "manager-2"
    });
  });

  it("does not reopen stewarding after a newer reporting session has started", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository, "channel-1");
    await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    await completeStewarding({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    await startIncidentSession({
      repository,
      guildId: "guild-1",
      channelId: "channel-2",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    const reopened = await reopenStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-2",
      memberRoleIds: ["manager-role"]
    });

    expect(reopened.status).toBe("no_decided_session");
    expect("message" in reopened ? reopened.message : "").toBe(
      "No latest decided incident session is available to reopen."
    );
    expect(repository.sessions.map((session) => session.status)).toEqual([
      "decided",
      "reporting"
    ]);
  });

  it("does not reopen stewarding when another session is already stewarding", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository, "channel-1");
    await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    await completeStewarding({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    await startIncidentSession({
      repository,
      guildId: "guild-1",
      channelId: "channel-2",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    const reopened = await reopenStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-2",
      memberRoleIds: ["manager-role"]
    });

    expect(reopened.status).toBe("already_stewarding");
    expect("message" in reopened ? reopened.message : "").toBe(
      "An incident session is already being stewarded for this server."
    );
    expect(repository.sessions.map((session) => session.status)).toEqual([
      "decided",
      "stewarding"
    ]);
  });

  it("reopens reporting from stewarding before penalties and preserves reports", async () => {
    await seedConfig(repository);
    const session = await seedReportingSession(repository);
    await repository.insertReport(reportInput(session, "incident-1", 1, 1, 1, "07"));
    const started = await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    const reopened = await reopenReporting({
      repository,
      guildId: "guild-1",
      userId: "manager-2",
      memberRoleIds: ["manager-role"]
    });
    const reports = await repository.getOrderedReportsForSession(session.id);

    expect(started.status).toBe("started");
    expect(reopened.status).toBe("reopened");
    expect(reopened.status === "reopened" ? reopened.session : null).toMatchObject({
      status: "reporting",
      endedByUserId: null,
      endedAt: null,
      stewardingStartedByUserId: null,
      stewardingStartedAt: null,
      lastReopenedByUserId: "manager-2"
    });
    expect(reports.map((report) => report.discordInteractionId)).toEqual([
      "incident-1"
    ]);
  });

  it("does not reopen reporting from stewarding after a penalty exists", async () => {
    await seedConfig(repository);
    const session = await seedReportingSession(repository);
    await repository.insertReport(reportInput(session, "incident-1", 1, 1, 1, "07"));
    await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    const preset = await addPenaltyPreset({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      name: "Warning",
      outcome: "Warning",
      delta: null
    });
    await applyPenalty({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      incidentId: "incident-1",
      affectedUserId: "driver-1",
      penaltyPreset: preset.status === "added" ? preset.preset.id : "missing"
    });

    const reopened = await reopenReporting({
      repository,
      guildId: "guild-1",
      userId: "manager-2",
      memberRoleIds: ["manager-role"]
    });

    expect(reopened.status).toBe("penalties_exist");
    expect("message" in reopened ? reopened.message : "").toBe(
      "Reporting cannot be reopened after penalty decisions have been recorded."
    );
    expect(repository.sessions[0]).toMatchObject({ status: "stewarding" });
  });

  it("does not reopen reporting from decided sessions", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository);
    await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    await completeStewarding({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    const reopened = await reopenReporting({
      repository,
      guildId: "guild-1",
      userId: "manager-2",
      memberRoleIds: ["manager-role"]
    });

    expect(reopened.status).toBe("no_stewarding_session");
    expect("message" in reopened ? reopened.message : "").toBe(
      "There is no latest stewarding incident session available to reopen for reporting."
    );
  });

  it("starts stewarding only for reporting sessions and rejects concurrent stewarding", async () => {
    await seedConfig(repository);

    const noReporting = await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    await seedReportingSession(repository, "channel-1");

    const first = await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    const second = await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    expect(noReporting.status).toBe("no_reporting_session");
    expect(first.status).toBe("started");
    expect(second.status).toBe("already_stewarding");
  });

  it("configures, lists, searches, and removes penalty presets", async () => {
    await seedConfig(repository);

    const invalidName = await addPenaltyPreset({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      name: " ",
      outcome: "Warning"
    });
    const warning = await addPenaltyPreset({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      name: " Warning ",
      outcome: " Warning `outcome`\nwith spacing ",
      delta: 0
    });
    const invalidOutcome = await addPenaltyPreset({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      name: "Too Long",
      outcome: "x".repeat(201)
    });
    const duplicate = await addPenaltyPreset({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      name: "Warning",
      outcome: "Another warning"
    });
    await addPenaltyPreset({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      name: "Drive Through",
      outcome: "Drive-through penalty",
      delta: 1
    });

    const listed = await listPenaltyPresets({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    const searched = await searchPenaltyPresets({
      repository,
      guildId: "guild-1",
      query: "war"
    });
    const removed = await removePenaltyPreset({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      penaltyPreset: warning.status === "added" ? warning.preset.id : "missing"
    });
    const searchedAfterRemove = await searchPenaltyPresets({
      repository,
      guildId: "guild-1",
      query: "war"
    });

    expect(invalidName.status).toBe("invalid_name");
    expect(warning.status).toBe("added");
    expect(warning.status === "added" ? warning.preset.name : "").toBe("Warning");
    expect(warning.status === "added" ? warning.preset.outcome : "").toBe(
      "Warning 'outcome' with spacing"
    );
    expect(invalidOutcome.status).toBe("invalid_outcome");
    expect(duplicate.status).toBe("duplicate_preset");
    expect(listed.status).toBe("found");
    expect(listed.status === "found" ? listed.presets : []).toHaveLength(2);
    expect(searched.status).toBe("found");
    expect(searched.status === "found" ? searched.presets : []).toHaveLength(1);
    expect(removed.status).toBe("removed");
    expect(searchedAfterRemove.status).toBe("found");
    expect(
      searchedAfterRemove.status === "found" ? searchedAfterRemove.presets : []
    ).toHaveLength(0);
  });

  it("records, updates, and clears penalties for stewarding incidents", async () => {
    await seedConfig(repository);
    const session = await seedReportingSession(repository);
    await repository.insertReport(reportInput(session, "incident-1", 1, 2, 3, "07"));
    await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    const warning = await addPenaltyPreset({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      name: "Warning",
      outcome: "Warning",
      delta: 0
    });
    const points = await addPenaltyPreset({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      name: "Points",
      outcome: "5 points",
      delta: 5
    });

    const missingUser = await applyPenalty({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      incidentId: "incident-1",
      affectedUserId: " ",
      penaltyPreset: "Warning"
    });
    const wrongChannel = await applyPenalty({
      repository,
      guildId: "guild-1",
      channelId: "channel-2",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      incidentId: "incident-1",
      affectedUserId: "driver-1",
      penaltyPreset: "Warning"
    });
    const recorded = await applyPenalty({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      incidentId: "incident-1",
      affectedUserId: "driver-1",
      penaltyPreset: warning.status === "added" ? warning.preset.id : "missing",
      note: " avoid line breaks \n please "
    });
    const updated = await applyPenalty({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      incidentId: "incident-1",
      affectedUserId: "driver-1",
      penaltyPreset: points.status === "added" ? points.preset.id : "missing"
    });
    const secondDriver = await applyPenalty({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      incidentId: "incident-1",
      affectedUserId: "driver-2",
      penaltyPreset: "Points"
    });

    expect(repository.penalties).toHaveLength(2);

    const cleared = await clearPenaltyForIncident({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      incidentId: "incident-1"
    });
    const clearedAgain = await clearPenaltyForIncident({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      incidentId: "incident-1"
    });

    expect(missingUser.status).toBe("missing_affected_user");
    expect(wrongChannel.status).toBe("no_stewarding_session");
    expect(recorded.status).toBe("recorded");
    expect(recorded.status === "recorded" ? recorded.note : "").toBe(
      "avoid line breaks please"
    );
    expect(updated.status).toBe("updated");
    expect(updated.status === "updated" ? updated.outcome : "").toBe("5 points");
    expect(secondDriver.status).toBe("recorded");
    expect(cleared.status).toBe("cleared");
    expect(cleared.status === "cleared" ? cleared.clearedCount : 0).toBe(2);
    expect(clearedAgain.status).toBe("none_found");
  });

  it("builds stewarding decision summaries from denormalized outcomes", async () => {
    await seedConfig(repository);
    const session = await seedReportingSession(repository);
    await repository.insertReport(reportInput(session, "incident-1", 1, 1, 1, "07"));
    await startStewarding({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    const preset = await addPenaltyPreset({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      name: "Unsafe",
      outcome: "Unsafe `rejoin`\nplus warning @here <@1234567890>",
      delta: 1
    });
    await applyPenalty({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      incidentId: "incident-1",
      affectedUserId: "driver-1",
      penaltyPreset: preset.status === "added" ? preset.preset.id : "missing"
    });
    await removePenaltyPreset({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"],
      penaltyPreset: preset.status === "added" ? preset.preset.id : "missing"
    });

    const completed = await completeStewarding({
      repository,
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });
    const decisionSummary = await getLatestDecisionSummary({
      repository,
      guildId: "guild-1",
      userId: "manager-1",
      memberRoleIds: ["manager-role"]
    });

    expect(completed.status).toBe("completed");
    expect(decisionSummary.status).toBe("found");
    expect(
      decisionSummary.status === "found" ? decisionSummary.summaryMessages[0] : ""
    ).toContain("Unsafe 'rejoin' plus warning @\u200bhere <@\u200b1234567890>");
    expect(
      decisionSummary.status === "found" ? decisionSummary.summaryMessages[0] : ""
    ).toContain("<@driver-1>");
  });

  it("leaves an unconfigured guild blocked while another guild is configured", async () => {
    await seedConfig(repository, "guild-a", "manager-role");

    const configured = await startIncidentSession({
      repository,
      guildId: "guild-a",
      channelId: "channel-a",
      userId: "manager-a",
      memberRoleIds: ["manager-role"]
    });
    const unconfiguredStart = await startIncidentSession({
      repository,
      guildId: "guild-b",
      channelId: "channel-b",
      userId: "manager-b",
      memberRoleIds: ["manager-role"]
    });
    const unconfiguredReport = await createIncidentReport({
      repository,
      guildId: "guild-b",
      channelId: "channel-b",
      submittedByUserId: "same-user",
      discordInteractionId: "guild-b-interaction",
      raceNumber: "1",
      lapNumber: "1",
      turnNumber: "1",
      carNumber: "07"
    });

    expect(configured.status).toBe("started");
    expect(unconfiguredStart.status).toBe("guild_not_configured");
    expect(unconfiguredReport.status).toBe("guild_not_configured");
  });
});

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

async function seedReportingSession(
  repository: MemoryIncidentRepository,
  channelId = "channel-1",
  guildId = "guild-1"
): Promise<IncidentSession> {
  return repository.createReportingSession({
    guildId,
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
  carNumber: string,
  note?: string | null
): InsertReportInput {
  const input: InsertReportInput = {
    sessionId: session.id,
    guildId: session.guildId,
    submittedByUserId: "user-1",
    discordInteractionId,
    raceNumber,
    lapNumber,
    turnNumber,
    carNumber
  };

  return note === undefined ? input : { ...input, note };
}

class MemoryIncidentRepository implements IncidentRepository {
  readonly configs = new Map<string, GuildConfig>();
  readonly sessions: IncidentSession[] = [];
  readonly reports: IncidentReport[] = [];
  readonly penaltyPresets: PenaltyPreset[] = [];
  readonly penalties: Penalty[] = [];
  readonly processedInteractions = new Set<string>();
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

  async getReportingSessionForGuild(
    guildId: string
  ): Promise<IncidentSession | null> {
    return (
      this.sessions.find(
        (session) => session.guildId === guildId && session.status === "reporting"
      ) ?? null
    );
  }

  async createReportingSession(input: CreateReportingSessionInput): Promise<IncidentSession> {
    const latest = this.getLatestSessionForGuild(input.guildId);

    if (latest && latest.status !== "decided") {
      throw new RepositoryConflictError("Latest session is not decided.");
    }

    const session: IncidentSession = {
      id: `session-${this.idNumber++}`,
      guildId: input.guildId,
      channelId: input.channelId,
      startedByUserId: input.startedByUserId,
      endedByUserId: null,
      status: "reporting",
      startedAt: this.now++,
      endedAt: null,
      stewardingStartedByUserId: null,
      stewardingCompletedByUserId: null,
      lastReopenedByUserId: null,
      stewardingStartedAt: null,
      stewardingCompletedAt: null,
      lastReopenedAt: null
    };

    this.sessions.push(session);
    return session;
  }

  async endReportingSession(
    input: EndReportingSessionInput
  ): Promise<IncidentSession | null> {
    const index = this.sessions.findIndex(
      (session) => session.id === input.sessionId && session.status === "reporting"
    );

    if (index === -1) {
      return null;
    }

    const existing = this.sessions[index]!;

    if (!existing) {
      return null;
    }

    const awaitingStewards: IncidentSession = {
      ...existing,
      endedByUserId: input.endedByUserId,
      status: "awaiting_stewards",
      endedAt: this.now++
    };

    this.sessions[index] = awaitingStewards;
    return awaitingStewards;
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
      note: input.note ?? null,
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

  async insertProcessedDiscordInteraction(
    input: InsertProcessedDiscordInteractionInput
  ): Promise<InsertProcessedDiscordInteractionResult> {
    if (this.processedInteractions.has(input.interactionId)) {
      return { status: "duplicate" };
    }

    this.processedInteractions.add(input.interactionId);
    return { status: "inserted" };
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

  async getLatestSessionAwaitingStewardsForGuild(
    guildId: string
  ): Promise<IncidentSession | null> {
    return (
      this.sessions
        .filter(
          (session) =>
            session.guildId === guildId && session.status === "awaiting_stewards"
        )
        .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0))[0] ??
      null
    );
  }

  async getStewardingSessionForGuild(
    guildId: string
  ): Promise<IncidentSession | null> {
    return (
      this.sessions.find(
        (session) => session.guildId === guildId && session.status === "stewarding"
      ) ?? null
    );
  }

  async getStewardingSessionForChannel(
    guildId: string,
    channelId: string
  ): Promise<IncidentSession | null> {
    return (
      this.sessions.find(
        (session) =>
          session.guildId === guildId &&
          session.channelId === channelId &&
          session.status === "stewarding"
      ) ?? null
    );
  }

  async startStewardingSession(
    input: StartStewardingSessionInput
  ): Promise<IncidentSession | null> {
    return this.updateSession(input.sessionId, "awaiting_stewards", {
      status: "stewarding",
      stewardingStartedByUserId: input.startedByUserId,
      stewardingStartedAt: this.now++
    });
  }

  async completeStewardingSession(
    input: CompleteStewardingSessionInput
  ): Promise<IncidentSession | null> {
    return this.updateSession(input.sessionId, "stewarding", {
      status: "decided",
      stewardingCompletedByUserId: input.completedByUserId,
      stewardingCompletedAt: this.now++
    });
  }

  async reopenStewardingSessionForReporting(
    input: ReopenStewardingSessionForReportingInput
  ): Promise<ReopenStewardingSessionForReportingResult> {
    const latest = this.getLatestSessionForGuild(input.guildId);

    if (!latest || latest.status !== "stewarding") {
      return { status: "no_stewarding_session", session: latest ?? undefined };
    }

    if (this.penalties.some((penalty) => penalty.incidentSessionId === latest.id)) {
      return { status: "penalties_exist", session: latest };
    }

    const session = await this.updateSession(latest.id, "stewarding", {
      endedByUserId: null,
      endedAt: null,
      status: "reporting",
      stewardingStartedByUserId: null,
      stewardingStartedAt: null,
      lastReopenedByUserId: input.reopenedByUserId,
      lastReopenedAt: this.now++
    });

    return session
      ? { status: "reopened", session }
      : { status: "no_stewarding_session" };
  }

  async reopenDecidedSessionForStewarding(
    input: ReopenDecidedSessionForStewardingInput
  ): Promise<ReopenDecidedSessionForStewardingResult> {
    const stewarding = await this.getStewardingSessionForGuild(input.guildId);

    if (stewarding) {
      return { status: "already_stewarding", session: stewarding };
    }

    const latest = this.getLatestSessionForGuild(input.guildId);

    if (!latest || latest.status !== "decided") {
      return { status: "no_decided_session", session: latest ?? undefined };
    }

    const session = await this.updateSession(latest.id, "decided", {
      status: "stewarding",
      stewardingCompletedByUserId: null,
      stewardingCompletedAt: null,
      lastReopenedByUserId: input.reopenedByUserId,
      lastReopenedAt: this.now++
    });

    return session
      ? { status: "reopened", session }
      : { status: "no_decided_session" };
  }

  async getLatestIncidentSummarySessionForGuild(
    guildId: string
  ): Promise<IncidentSession | null> {
    return (
      this.sessions
        .filter((session) => session.guildId === guildId && session.status !== "reporting")
        .sort((left, right) => right.startedAt - left.startedAt)[0] ?? null
    );
  }

  async getLatestDecidedSessionForGuild(
    guildId: string
  ): Promise<IncidentSession | null> {
    return (
      this.sessions
        .filter((session) => session.guildId === guildId && session.status === "decided")
        .sort(
          (left, right) =>
            (right.stewardingCompletedAt ?? 0) - (left.stewardingCompletedAt ?? 0)
        )[0] ?? null
    );
  }

  async createPenaltyPreset(
    input: CreatePenaltyPresetInput
  ): Promise<PenaltyPreset> {
    const timestamp = this.now++;
    const preset: PenaltyPreset = {
      id: `preset-${this.idNumber++}`,
      guildId: input.guildId,
      name: input.name,
      outcome: input.outcome,
      delta: input.delta,
      isActive: true,
      createdByUserId: input.createdByUserId,
      deactivatedByUserId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deactivatedAt: null
    };

    this.penaltyPresets.push(preset);
    return preset;
  }

  async listPenaltyPresetsForGuild(guildId: string): Promise<PenaltyPreset[]> {
    return this.penaltyPresets
      .filter((preset) => preset.guildId === guildId && preset.isActive)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async searchPenaltyPresetsForGuild(
    guildId: string,
    query: string
  ): Promise<PenaltyPreset[]> {
    const normalized = query.trim().toLocaleLowerCase();

    return (await this.listPenaltyPresetsForGuild(guildId))
      .filter((preset) => preset.name.toLocaleLowerCase().includes(normalized))
      .slice(0, 25);
  }

  async getActivePenaltyPresetForGuild(
    guildId: string,
    presetIdOrName: string
  ): Promise<PenaltyPreset | null> {
    return (
      this.penaltyPresets.find(
        (preset) =>
          preset.guildId === guildId &&
          preset.isActive &&
          (preset.id === presetIdOrName || preset.name === presetIdOrName)
      ) ?? null
    );
  }

  async deactivatePenaltyPreset(
    input: DeactivatePenaltyPresetInput
  ): Promise<PenaltyPreset | null> {
    const index = this.penaltyPresets.findIndex(
      (preset) => preset.id === input.presetId && preset.isActive
    );

    if (index === -1) {
      return null;
    }

    const existing = this.penaltyPresets[index]!;
    const timestamp = this.now++;
    const deactivated = {
      ...existing,
      isActive: false,
      deactivatedByUserId: input.deactivatedByUserId,
      updatedAt: timestamp,
      deactivatedAt: timestamp
    };

    this.penaltyPresets[index] = deactivated;
    return deactivated;
  }

  async upsertPenaltyForIncidentSession(
    input: UpsertPenaltyInput
  ): Promise<UpsertPenaltyResult> {
    const existingIndex = this.penalties.findIndex(
      (penalty) =>
        penalty.incidentSessionId === input.incidentSessionId &&
        penalty.incidentReportId === input.incidentReportId &&
        penalty.affectedUserId === input.affectedUserId
    );
    const timestamp = this.now++;

    if (existingIndex !== -1) {
      const existing = this.penalties[existingIndex]!;
      const penalty = {
        ...existing,
        penaltyPresetId: input.penaltyPresetId,
        outcome: input.outcome,
        delta: input.delta,
        note: input.note,
        updatedByUserId: input.updatedByUserId,
        updatedAt: timestamp
      };

      this.penalties[existingIndex] = penalty;
      return { status: "updated", penalty };
    }

    const penalty: Penalty = {
      id: `penalty-${this.idNumber++}`,
      incidentSessionId: input.incidentSessionId,
      incidentReportId: input.incidentReportId,
      affectedUserId: input.affectedUserId,
      penaltyPresetId: input.penaltyPresetId,
      outcome: input.outcome,
      delta: input.delta,
      note: input.note,
      createdByUserId: input.createdByUserId,
      updatedByUserId: input.updatedByUserId,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.penalties.push(penalty);
    return { status: "inserted", penalty };
  }

  async clearPenaltiesForIncidentInSession(
    input: ClearPenaltiesForIncidentInput
  ): Promise<number> {
    const before = this.penalties.length;
    const remaining = this.penalties.filter(
      (penalty) =>
        penalty.incidentSessionId !== input.incidentSessionId ||
        penalty.incidentReportId !== input.incidentReportId
    );

    this.penalties.splice(0, this.penalties.length, ...remaining);
    return before - remaining.length;
  }

  async getPenaltiesWithReportsForSession(
    sessionId: string
  ): Promise<PenaltyDecisionSummaryRow[]> {
    return this.penalties
      .filter((penalty) => penalty.incidentSessionId === sessionId)
      .map((penalty) => ({
        penalty,
        report: this.reports.find((report) => report.id === penalty.incidentReportId)!,
        preset:
          this.penaltyPresets.find(
            (preset) => preset.id === penalty.penaltyPresetId
          ) ?? null
      }))
      .filter((row) => row.report)
      .sort(
        (left, right) =>
          left.report.raceNumber - right.report.raceNumber ||
          left.report.lapNumber - right.report.lapNumber ||
          left.report.turnNumber - right.report.turnNumber ||
          left.report.createdAt - right.report.createdAt ||
          left.penalty.createdAt - right.penalty.createdAt
      );
  }

  async getReportForStewardingSessionByDiscordInteractionId(
    incidentSessionId: string,
    guildId: string,
    discordInteractionId: string
  ): Promise<IncidentReport | null> {
    const session = this.sessions.find(
      (candidate) =>
        candidate.id === incidentSessionId &&
        candidate.guildId === guildId &&
        candidate.status === "stewarding"
    );

    if (!session) {
      return null;
    }

    return (
      this.reports.find(
        (report) =>
          report.sessionId === incidentSessionId &&
          report.guildId === guildId &&
          report.discordInteractionId === discordInteractionId
      ) ?? null
    );
  }

  private getLatestSessionForGuild(guildId: string): IncidentSession | null {
    return (
      this.sessions
        .filter((session) => session.guildId === guildId)
        .sort((left, right) => right.startedAt - left.startedAt)[0] ?? null
    );
  }

  private updateSession(
    sessionId: string,
    expectedStatus: IncidentSession["status"],
    updates: Partial<IncidentSession>
  ): IncidentSession | null {
    const index = this.sessions.findIndex(
      (session) => session.id === sessionId && session.status === expectedStatus
    );

    if (index === -1) {
      return null;
    }

    const updated = {
      ...this.sessions[index]!,
      ...updates
    };

    this.sessions[index] = updated;
    return updated;
  }
}
