import { PermissionFlagsBits } from "discord-api-types/v10";
import { beforeEach, describe, expect, it } from "vitest";

import {
  handleDiscordInteraction,
  sendDiscordDirectMessages
} from "../../src/discord/interactions";
import { getStewardUserGuideMessages } from "../../src/core/help";
import {
  INCIDENT_REPORT_NOTE_LIMIT
} from "../../src/core/incidents";
import {
  CAR_NUMBER_INPUT_ID,
  INCIDENT_REPORT_MODAL_CUSTOM_ID,
  LAP_NUMBER_INPUT_ID,
  NOTE_INPUT_ID,
  RACE_NUMBER_INPUT_ID,
  TURN_NUMBER_INPUT_ID
} from "../../src/discord/modals";
import { DISCORD_EPHEMERAL_MESSAGE_FLAG } from "../../src/discord/responses";
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

let interactionIdNumber = 1;

describe("Discord interaction handlers", () => {
  let repository: MemoryIncidentRepository;
  let restClient: MemoryDiscordRestClient;
  let waitUntilPromises: Promise<unknown>[];

  beforeEach(() => {
    repository = new MemoryIncidentRepository();
    restClient = new MemoryDiscordRestClient();
    waitUntilPromises = [];
  });

  it("sends direct messages through a created DM channel", async () => {
    const delivered = await sendDiscordDirectMessages(
      { restClient },
      {
        recipientId: "user-1",
        messages: ["Guide chunk 1", "Guide chunk 2"]
      }
    );

    expect(delivered).toBe(true);
    expect(restClient.dmChannels).toEqual([
      {
        recipientId: "user-1"
      }
    ]);
    expect(restClient.messages).toEqual([
      {
        channelId: "dm-channel-1",
        content: "Guide chunk 1"
      },
      {
        channelId: "dm-channel-1",
        content: "Guide chunk 2"
      }
    ]);
  });

  it("reports direct message failure when DM channel creation fails", async () => {
    restClient.failDmChannelCreation = true;

    const delivered = await sendDiscordDirectMessages(
      { restClient },
      {
        recipientId: "user-1",
        messages: ["Guide chunk"]
      }
    );

    expect(delivered).toBe(false);
    expect(restClient.dmChannels).toEqual([]);
    expect(restClient.messages).toEqual([]);
  });

  it("reports direct message failure when DM message posting fails", async () => {
    restClient.failChannelMessages = true;

    const delivered = await sendDiscordDirectMessages(
      { restClient },
      {
        recipientId: "user-1",
        messages: ["Guide chunk"]
      }
    );

    expect(delivered).toBe(false);
    expect(restClient.dmChannels).toEqual([
      {
        recipientId: "user-1"
      }
    ]);
    expect(restClient.messages).toEqual([]);
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

  it("allows configured manager-role stewards to view /incident-config status", async () => {
    await seedConfig(repository);

    const result = await handleDiscordInteraction(
      configStatusInteraction({
        permissions: "0",
        roles: ["manager-role"]
      }),
      { repository }
    );

    expect(result.body).toMatchObject({
      data: {
        content: "Incident bot is configured. Manager role: <@&manager-role>."
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

  it("rejects /incident-config status without Manage Guild or manager role", async () => {
    await seedConfig(repository);

    const result = await handleDiscordInteraction(
      configStatusInteraction({
        permissions: "0",
        roles: ["driver-role"]
      }),
      { repository }
    );

    expect(result.body).toMatchObject({
      data: {
        content:
          "You need Discord Manage Server permission or the configured incident manager role to use this command."
      }
    });
  });

  it("DMs /incident-config help to users with Manage Guild", async () => {
    await seedConfig(repository);

    const result = await handleDiscordInteraction(configHelpInteraction(), {
      repository,
      restClient
    });

    expect(result.body).toEqual({
      type: 4,
      data: {
        content: "I sent you the steward guide by DM.",
        flags: DISCORD_EPHEMERAL_MESSAGE_FLAG
      }
    });
    expect(restClient.dmChannels).toEqual([{ recipientId: "user-1" }]);
    expect(restClient.messages).toEqual(
      getStewardUserGuideMessages().map((content) => ({
        channelId: "dm-channel-1",
        content
      }))
    );
  });

  it("DMs /incident-config help to configured manager-role stewards", async () => {
    await seedConfig(repository);

    const result = await handleDiscordInteraction(
      configHelpInteraction({
        permissions: "0",
        roles: ["manager-role"]
      }),
      {
        repository,
        restClient
      }
    );

    expect(result.body).toMatchObject({
      data: {
        content: "I sent you the steward guide by DM."
      }
    });
    expect(restClient.dmChannels).toEqual([{ recipientId: "user-1" }]);
    expect(restClient.messages).toHaveLength(getStewardUserGuideMessages().length);
  });

  it("rejects /incident-config help without Manage Guild or manager role", async () => {
    await seedConfig(repository);

    const result = await handleDiscordInteraction(
      configHelpInteraction({
        permissions: "0",
        roles: ["driver-role"]
      }),
      {
        repository,
        restClient
      }
    );

    expect(result.body).toMatchObject({
      data: {
        content:
          "You need Discord Manage Server permission or the configured incident manager role to use this command."
      }
    });
    expect(restClient.dmChannels).toEqual([]);
    expect(restClient.messages).toEqual([]);
  });

  it("returns setup guidance for /incident-config help when unconfigured and non-admin", async () => {
    const result = await handleDiscordInteraction(
      configHelpInteraction({
        permissions: "0",
        roles: []
      }),
      {
        repository,
        restClient
      }
    );

    expect(result.body).toMatchObject({
      data: {
        content:
          "This server is not configured yet. A server admin must run `/incident-config role role:<manager role>` before incident commands can be used."
      }
    });
    expect(restClient.dmChannels).toEqual([]);
    expect(restClient.messages).toEqual([]);
  });

  it("DMs /incident-config help to server managers when unconfigured", async () => {
    const result = await handleDiscordInteraction(configHelpInteraction(), {
      repository,
      restClient
    });

    expect(result.body).toMatchObject({
      data: {
        content: "I sent you the steward guide by DM."
      }
    });
    expect(restClient.dmChannels).toEqual([{ recipientId: "user-1" }]);
    expect(restClient.messages).toHaveLength(getStewardUserGuideMessages().length);
  });

  it("returns a DM failure message when /incident-config help cannot DM the user", async () => {
    await seedConfig(repository);
    restClient.failDmChannelCreation = true;

    const result = await handleDiscordInteraction(configHelpInteraction(), {
      repository,
      restClient
    });

    expect(result.body).toMatchObject({
      data: {
        content:
          "I could not DM you the steward guide. Check your Discord privacy settings and try again."
      }
    });
    expect(restClient.dmChannels).toEqual([]);
    expect(restClient.messages).toEqual([]);
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
        content:
          "Incident reporting session started in <#channel-1>. Racers can report incidents with /incident and fill out the form."
      }
    ]);
  });

  it("does not process duplicate state-changing session interactions twice", async () => {
    await seedConfig(repository);
    const interaction = sessionInteraction("start");

    const first = await handleDiscordInteraction(interaction, {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });
    const duplicate = await handleDiscordInteraction(interaction, {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });
    await flushWaitUntil();

    expect(first.body).toMatchObject({
      data: { content: "Incident session started." }
    });
    expect(duplicate.body).toMatchObject({
      data: { content: "This interaction was already processed." }
    });
    expect(repository.sessions).toHaveLength(1);
    expect(restClient.messages).toHaveLength(1);
  });

  it("allows server admins without the manager role to start a session", async () => {
    await seedConfig(repository);

    const result = await handleDiscordInteraction(
      sessionInteraction("start", {
        roles: ["driver-role"],
        permissions: PermissionFlagsBits.ManageGuild.toString()
      }),
      {
        repository,
        restClient,
        waitUntil: captureWaitUntil
      }
    );
    await flushWaitUntil();

    expect(result.body).toMatchObject({
      data: { content: "Incident session started." }
    });
    expect(repository.sessions[0]).toMatchObject({
      status: "reporting",
      startedByUserId: "manager-1"
    });
  });

  it("returns the incident report modal for /incident in the reporting channel", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository);

    const result = await handleDiscordInteraction(baseCommand("incident"), {
      repository
    });

    expect(result.body).toMatchObject({
      type: 9,
      data: {
        custom_id: INCIDENT_REPORT_MODAL_CUSTOM_ID,
        title: "Report incident",
        components: expect.arrayContaining([
          expect.objectContaining({
            components: [
              expect.objectContaining({
                custom_id: NOTE_INPUT_ID,
                label: "Note",
                max_length: INCIDENT_REPORT_NOTE_LIMIT,
                required: false
              })
            ]
          })
        ])
      }
    });
    expect(JSON.stringify(result.body)).toContain("Race number");
    expect(JSON.stringify(result.body)).toContain("Turn / corner number");
  });

  it("stores incident modal submissions", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository);

    const result = await handleDiscordInteraction(
      modalSubmitInteraction(),
      {
        repository,
        restClient
      }
    );

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
        carNumber: "07",
        note: null
      }
    ]);
    expect(restClient.messages).toEqual([
      {
        channelId: "channel-1",
        allowedMentions: {
          parse: [],
          users: ["user-1"],
          roles: [],
          repliedUser: false
        },
        content: [
          "An incident report has been submitted by <@user-1>.",
          "Details:",
          "Race Number: 1",
          "Lap Number: 2",
          "Turn / Corner Number: 3",
          "Car Number: 07"
        ].join("\n")
      }
    ]);
  });

  it("stores incident modal submissions with notes", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository);

    const result = await handleDiscordInteraction(
      modalSubmitInteraction({
        extraComponents: [modalRow(NOTE_INPUT_ID, " clipped `track limits` \n on exit ")]
      }),
      {
        repository,
        restClient
      }
    );

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
        carNumber: "07",
        note: "clipped 'track limits' on exit"
      }
    ]);
    expect(restClient.messages).toEqual([
      {
        channelId: "channel-1",
        allowedMentions: {
          parse: [],
          users: ["user-1"],
          roles: [],
          repliedUser: false
        },
        content: [
          "An incident report has been submitted by <@user-1>.",
          "Details:",
          "Race Number: 1",
          "Lap Number: 2",
          "Turn / Corner Number: 3",
          "Car Number: 07",
          "Note: clipped 'track limits' on exit"
        ].join("\n")
      }
    ]);
  });

  it("uses the server-side reporting session for modal submissions", async () => {
    await seedConfig(repository);
    const reportingSession = await seedReportingSession(repository);

    await handleDiscordInteraction(
      modalSubmitInteraction({
        extraComponents: [modalRow("session_id", "client-controlled-session-id")]
      }),
      { repository }
    );

    expect(repository.reports).toMatchObject([
      {
        sessionId: reportingSession.id,
        discordInteractionId: "modal-interaction-1"
      }
    ]);
  });

  it("defers /incident-session steward, posts the incident summary, and starts stewarding", async () => {
    await seedConfig(repository);
    const session = await seedReportingSession(repository);
    await repository.insertReport(reportInput(session, "report-interaction-1"));

    const result = await handleDiscordInteraction(sessionInteraction("steward"), {
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

    expect(repository.sessions[0]).toMatchObject({ status: "stewarding" });
    expect(restClient.messages).toEqual([
      {
        channelId: "channel-1",
        allowedMentions: {
          parse: [],
          users: ["user-1"],
          roles: [],
          repliedUser: false
        },
        content:
          "Incident reporting ended for <#channel-1>.\n\n`Race  Lap  Turn  Car  ID                    User`\n`1     2    3     07   report-interaction-1` <@user-1>"
      },
      {
        channelId: "channel-1",
        content:
          "Stewarding has started for the incident session in <#channel-1>."
      }
    ]);
    expect(restClient.edits).toEqual([
      {
        applicationId: "app-1",
        interactionToken: "token-steward",
        content:
          "Reporting closed, incident summary posted, and stewarding started."
      }
    ]);
  });

  it("does not schedule duplicate deferred state-changing interactions", async () => {
    await seedConfig(repository);
    const session = await seedReportingSession(repository);
    await repository.insertReport(reportInput(session, "report-interaction-1"));
    const interaction = sessionInteraction("steward");

    const first = await handleDiscordInteraction(interaction, {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });
    const duplicate = await handleDiscordInteraction(interaction, {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });
    await flushWaitUntil();

    expect(first.body).toMatchObject({ type: 5 });
    expect(duplicate.body).toMatchObject({
      data: { content: "This interaction was already processed." }
    });
    expect(repository.sessions[0]).toMatchObject({ status: "stewarding" });
    expect(restClient.messages).toHaveLength(2);
    expect(restClient.edits).toHaveLength(1);
  });

  it("defers /incident-session summary and reposts the latest incident report summary", async () => {
    await seedConfig(repository);
    const session = await seedReportingSession(repository);
    await repository.insertReport(reportInput(session, "report-interaction-1"));
    await repository.endReportingSession({
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
        content:
          "The previous incident session must be decided before starting a new one."
      }
    });
    expect(repository.sessions).toMatchObject([
      { guildId: "guild-a", channelId: "shared-channel", status: "reporting" },
      { guildId: "guild-b", channelId: "shared-channel", status: "reporting" }
    ]);
  });

  it("reposts the latest incident report summary for only the invoking guild", async () => {
    await seedConfig(repository, "guild-a", "manager-role-a");
    await seedConfig(repository, "guild-b", "manager-role-b");
    const guildASession = await seedReportingSession(
      repository,
      "guild-a",
      "shared-channel"
    );
    const guildBSession = await seedReportingSession(
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
    await repository.endReportingSession({
      sessionId: guildASession.id,
      endedByUserId: "manager-a"
    });
    await repository.endReportingSession({
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

  it("posts an empty-session summary when stewarding starts with no reports", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository);

    const result = await handleDiscordInteraction(sessionInteraction("steward"), {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });

    await flushWaitUntil();

    expect(result.body).toEqual({
      type: 5,
      data: {
        flags: DISCORD_EPHEMERAL_MESSAGE_FLAG
      }
    });
    expect(repository.sessions[0]).toMatchObject({ status: "stewarding" });
    expect(restClient.messages).toEqual([
      {
        channelId: "channel-1",
        content:
          "Incident reporting ended for <#channel-1>.\nNo incidents were reported."
      },
      {
        channelId: "channel-1",
        content:
          "Stewarding has started for the incident session in <#channel-1>."
      }
    ]);
  });

  it("posts multiple report rows when stewarding starts", async () => {
    await seedConfig(repository);
    const session = await seedReportingSession(repository);
    await repository.insertReport(reportInput(session, "report-interaction-2", "user-2"));
    await repository.insertReport(reportInput(session, "report-interaction-1", "user-1"));

    const result = await handleDiscordInteraction(sessionInteraction("steward"), {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });

    expect(result.body).toMatchObject({ type: 5 });

    await flushWaitUntil();

    expect(restClient.messages[0]?.content).toContain("report-interaction-2");
    expect(restClient.messages[0]?.content).toContain("report-interaction-1");
    expect(restClient.messages[1]).toEqual({
      channelId: "channel-1",
      content:
        "Stewarding has started for the incident session in <#channel-1>."
    });
    expect(restClient.edits).toEqual([
      {
        applicationId: "app-1",
        interactionToken: "token-steward",
        content:
          "Reporting closed, incident summary posted, and stewarding started."
      }
    ]);
  });

  it("reports stewarding transition posting failures in the deferred response", async () => {
    await seedConfig(repository);
    await seedReportingSession(repository);
    restClient.failChannelMessages = true;

    const result = await handleDiscordInteraction(sessionInteraction("steward"), {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });

    expect(result.body).toMatchObject({ type: 5 });

    await flushWaitUntil();

    expect(repository.sessions[0]).toMatchObject({ status: "stewarding" });
    expect(restClient.messages).toEqual([]);
    expect(restClient.edits).toEqual([
      {
        applicationId: "app-1",
        interactionToken: "token-steward",
        content:
          "Stewarding started, but I could not post the incident summary. Check the bot can view and send messages in this channel, then run /incident-session summary."
      }
    ]);
  });

  it("edits the deferred response when stewarding cannot start", async () => {
    await seedConfig(repository);

    const result = await handleDiscordInteraction(sessionInteraction("steward"), {
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

    expect(restClient.edits).toEqual([
      {
        applicationId: "app-1",
        interactionToken: "token-steward",
        content: "There is no reporting incident session to start stewarding."
      }
    ]);
  });

  it("records a penalty and posts the decision publicly", async () => {
    await seedConfig(repository);
    const session = await seedStewardingSession(repository);
    await repository.insertReport(reportInput(session, "incident-1"));
    const preset = await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Warning",
      outcome: "Formal `warning`\nwith note",
      delta: null,
      createdByUserId: "manager-1"
    });

    const result = await handleDiscordInteraction(
      sessionInteraction("penalty", {
        options: [
          { name: "incident-id", value: "incident-1" },
          { name: "affected-user", value: "driver-1" },
          { name: "penalty", value: preset.id },
          { name: "note", value: "Reviewed `onboard`\nwithout issue" }
        ]
      }),
      {
        repository,
        restClient,
        waitUntil: captureWaitUntil
      }
    );

    await flushWaitUntil();

    const expected =
      "Penalty recorded for <@driver-1> on incident incident-1: Formal 'warning' with note. Note: Reviewed 'onboard' without issue";
    expect(result.body).toMatchObject({ data: { content: expected } });
    expect(repository.penalties).toMatchObject([
      {
        affectedUserId: "driver-1",
        outcome: "Formal 'warning' with note",
        note: "Reviewed 'onboard' without issue"
      }
    ]);
    expect(restClient.messages).toEqual([
      {
        channelId: "channel-1",
        allowedMentions: {
          parse: [],
          users: ["driver-1"],
          roles: [],
          repliedUser: false
        },
        content: expected
      }
    ]);
  });

  it("rejects penalty commands without an affected user", async () => {
    await seedConfig(repository);
    const session = await seedStewardingSession(repository);
    await repository.insertReport(reportInput(session, "incident-1"));
    const preset = await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Warning",
      outcome: "Formal warning",
      delta: null,
      createdByUserId: "manager-1"
    });

    const result = await handleDiscordInteraction(
      sessionInteraction("penalty", {
        options: [
          { name: "incident-id", value: "incident-1" },
          { name: "penalty", value: preset.id }
        ]
      }),
      { repository }
    );

    expect(result.body).toMatchObject({
      data: {
        content: "Choose an affected user before assigning a penalty."
      }
    });
  });

  it("clears penalties for an incident and reports the removal count", async () => {
    await seedConfig(repository);
    const session = await seedStewardingSession(repository);
    const report = await repository.insertReport(reportInput(session, "incident-1"));
    const preset = await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Penalty",
      outcome: "5 seconds",
      delta: 5,
      createdByUserId: "manager-1"
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

    const result = await handleDiscordInteraction(
      sessionInteraction("penalty-clear", {
        options: [{ name: "incident-id", value: "incident-1" }]
      }),
      {
        repository,
        restClient,
        waitUntil: captureWaitUntil
      }
    );

    await flushWaitUntil();

    expect(result.body).toMatchObject({
      data: {
        content: "Cleared 1 penalty decision(s) for incident incident-1."
      }
    });
    expect(repository.penalties).toEqual([]);
    expect(restClient.messages).toEqual([
      {
        channelId: "channel-1",
        content: "Penalty decisions were cleared for incident incident-1."
      }
    ]);
  });

  it("defers stewarding completion and posts the decision summary", async () => {
    await seedConfig(repository);
    const session = await seedStewardingSession(repository);
    const report = await repository.insertReport(reportInput(session, "incident-1"));
    const preset = await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Penalty",
      outcome: "5 seconds",
      delta: 5,
      createdByUserId: "manager-1"
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

    const result = await handleDiscordInteraction(sessionInteraction("complete"), {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });

    expect(result.body).toMatchObject({ type: 5 });

    await flushWaitUntil();

    expect(repository.sessions[0]).toMatchObject({ status: "decided" });
    expect(restClient.messages[0]?.content).toContain("Stewarding decisions");
    expect(restClient.messages[0]?.content).toContain("5 seconds");
    expect(restClient.edits).toContainEqual({
      applicationId: "app-1",
      interactionToken: "token-complete",
      content: "Stewarding completed and decision summary posted."
    });
  });

  it("reports stewarding completion posting failures in the deferred response", async () => {
    await seedConfig(repository);
    await seedStewardingSession(repository);
    restClient.failChannelMessages = true;

    const result = await handleDiscordInteraction(sessionInteraction("complete"), {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });

    expect(result.body).toMatchObject({ type: 5 });

    await flushWaitUntil();

    expect(restClient.edits).toEqual([
      {
        applicationId: "app-1",
        interactionToken: "token-complete",
        content:
          "Stewarding completed, but I could not post the decision summary. Check the bot can view and send messages in this channel, then run /incident-session decisions."
      }
    ]);
  });

  it("reopens reporting and stewarding through session commands", async () => {
    await seedConfig(repository);
    const reporting = await seedStewardingSession(repository);

    const reopenedReporting = await handleDiscordInteraction(
      sessionInteraction("reopen-reporting"),
      {
        repository,
        restClient,
        waitUntil: captureWaitUntil
      }
    );

    await flushWaitUntil();

    expect(reopenedReporting.body).toMatchObject({
      data: { content: "Incident session reopened for reporting." }
    });
    expect(repository.sessions[0]).toMatchObject({ status: "reporting" });

    await repository.endReportingSession({
      sessionId: reporting.id,
      endedByUserId: "manager-1"
    });
    await repository.startStewardingSession({
      sessionId: reporting.id,
      startedByUserId: "manager-1"
    });
    await repository.completeStewardingSession({
      sessionId: reporting.id,
      completedByUserId: "manager-1"
    });

    const reopenedStewarding = await handleDiscordInteraction(
      sessionInteraction("reopen-stewarding"),
      {
        repository,
        restClient,
        waitUntil: captureWaitUntil
      }
    );

    await flushWaitUntil();

    expect(reopenedStewarding.body).toMatchObject({
      data: { content: "Stewarding reopened for the latest decided session." }
    });
    expect(repository.sessions[0]).toMatchObject({ status: "stewarding" });
  });

  it("rejects reopen-stewarding after a newer reporting session has started", async () => {
    await seedConfig(repository);
    const first = await seedStewardingSession(repository);
    await repository.completeStewardingSession({
      sessionId: first.id,
      completedByUserId: "manager-1"
    });
    await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-2",
      startedByUserId: "manager-1"
    });

    const reopened = await handleDiscordInteraction(
      sessionInteraction("reopen-stewarding"),
      {
        repository,
        restClient,
        waitUntil: captureWaitUntil
      }
    );

    await flushWaitUntil();

    expect(reopened.body).toMatchObject({
      data: {
        content: "No latest decided incident session is available to reopen."
      }
    });
    expect(repository.sessions.map((session) => session.status)).toEqual([
      "decided",
      "reporting"
    ]);
  });

  it("rejects reopen-stewarding while another session is already stewarding", async () => {
    await seedConfig(repository);
    const first = await seedStewardingSession(repository);
    await repository.completeStewardingSession({
      sessionId: first.id,
      completedByUserId: "manager-1"
    });
    const second = await repository.createReportingSession({
      guildId: "guild-1",
      channelId: "channel-2",
      startedByUserId: "manager-1"
    });
    await repository.endReportingSession({
      sessionId: second.id,
      endedByUserId: "manager-1"
    });
    await repository.startStewardingSession({
      sessionId: second.id,
      startedByUserId: "manager-1"
    });

    const reopened = await handleDiscordInteraction(
      sessionInteraction("reopen-stewarding"),
      {
        repository,
        restClient,
        waitUntil: captureWaitUntil
      }
    );

    await flushWaitUntil();

    expect(reopened.body).toMatchObject({
      data: {
        content: "An incident session is already being stewarded for this server."
      }
    });
    expect(repository.sessions.map((session) => session.status)).toEqual([
      "decided",
      "stewarding"
    ]);
  });

  it("rejects reopen-reporting after penalty decisions exist", async () => {
    await seedConfig(repository);
    const session = await seedStewardingSession(repository);
    const report = await repository.insertReport(reportInput(session, "incident-1"));
    const preset = await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Warning",
      outcome: "Warning",
      delta: null,
      createdByUserId: "manager-1"
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

    const result = await handleDiscordInteraction(
      sessionInteraction("reopen-reporting"),
      {
        repository,
        restClient,
        waitUntil: captureWaitUntil
      }
    );

    await flushWaitUntil();

    expect(result.body).toMatchObject({
      data: {
        content:
          "Reporting cannot be reopened after penalty decisions have been recorded."
      }
    });
    expect(repository.sessions[0]).toMatchObject({ status: "stewarding" });
  });

  it("defers decision summary reposts for the latest decided session", async () => {
    await seedConfig(repository);
    const session = await seedStewardingSession(repository);
    const report = await repository.insertReport(reportInput(session, "incident-1"));
    const preset = await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Penalty",
      outcome: "5 seconds",
      delta: 5,
      createdByUserId: "manager-1"
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
    await repository.completeStewardingSession({
      sessionId: session.id,
      completedByUserId: "manager-1"
    });

    const result = await handleDiscordInteraction(sessionInteraction("decisions"), {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });

    expect(result.body).toMatchObject({ type: 5 });

    await flushWaitUntil();

    expect(restClient.messages[0]?.content).toContain("Stewarding decisions");
    expect(restClient.edits).toEqual([
      {
        applicationId: "app-1",
        interactionToken: "token-decisions",
        content: "Latest stewarding decisions reposted."
      }
    ]);
  });

  it("edits deferred decision reposts when no decided session exists", async () => {
    await seedConfig(repository);

    const result = await handleDiscordInteraction(sessionInteraction("decisions"), {
      repository,
      restClient,
      waitUntil: captureWaitUntil
    });

    expect(result.body).toMatchObject({ type: 5 });

    await flushWaitUntil();

    expect(restClient.edits).toEqual([
      {
        applicationId: "app-1",
        interactionToken: "token-decisions",
        content: "No decided incident session is available yet."
      }
    ]);
  });

  it("adds, lists, and removes penalty presets through config commands", async () => {
    await seedConfig(repository);

    const added = await handleDiscordInteraction(
      configPenaltyAddInteraction("Warning", "Formal warning"),
      { repository }
    );
    const listed = await handleDiscordInteraction(configPenaltiesInteraction(), {
      repository
    });
    const removed = await handleDiscordInteraction(
      configPenaltyRemoveInteraction("preset-1"),
      { repository }
    );

    expect(added.body).toMatchObject({
      data: { content: "Penalty preset added: Warning." }
    });
    expect(listed.body).toMatchObject({
      data: { content: "Configured penalty presets:\n- Warning" }
    });
    expect(removed.body).toMatchObject({
      data: { content: "Penalty preset removed: Warning." }
    });
    expect(repository.penaltyPresets[0]).toMatchObject({ isActive: false });
  });

  it("allows configured manager-role stewards to manage penalty presets", async () => {
    await seedConfig(repository);

    const added = await handleDiscordInteraction(
      configPenaltyAddInteraction("Warning", "Formal warning", {
        permissions: "0",
        roles: ["manager-role"]
      }),
      { repository }
    );

    expect(added.body).toMatchObject({
      data: { content: "Penalty preset added: Warning." }
    });
  });

  it("rejects penalty preset commands without Manage Guild or manager role", async () => {
    await seedConfig(repository);

    const added = await handleDiscordInteraction(
      configPenaltyAddInteraction("Warning", "Formal warning", {
        permissions: "0",
        roles: ["driver-role"]
      }),
      { repository }
    );

    expect(added.body).toMatchObject({
      data: { content: "Only incident managers can use this command." }
    });
    expect(repository.penaltyPresets).toHaveLength(0);
  });

  it("truncates long penalty preset lists inside Discord's message limit", async () => {
    await seedConfig(repository);

    for (let index = 0; index < 40; index++) {
      await repository.createPenaltyPreset({
        guildId: "guild-1",
        name: `Penalty ${index.toString().padStart(2, "0")} ${"x".repeat(80)}`,
        outcome: `Long outcome ${index} ${"y".repeat(180)}`,
        delta: null,
        createdByUserId: "manager-1"
      });
    }

    const listed = await handleDiscordInteraction(configPenaltiesInteraction(), {
      repository
    });

    expect("data" in listed.body).toBe(true);
    const content = "data" in listed.body ? listed.body.data.content ?? "" : "";

    expect(content.length).toBeLessThanOrEqual(2_000);
    expect(content).toContain("- Penalty 00");
    expect(content).not.toContain("Long outcome");
    expect(content).toMatch(/\.\.\. and \d+ other results$/);
  });

  it("returns active guild-scoped penalty preset autocomplete choices", async () => {
    await seedConfig(repository);
    await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Warning",
      outcome: "Formal warning",
      delta: null,
      createdByUserId: "manager-1"
    });
    await repository.createPenaltyPreset({
      guildId: "guild-2",
      name: "Wrong guild",
      outcome: "Hidden",
      delta: null,
      createdByUserId: "manager-1"
    });

    const result = await handleDiscordInteraction(
      autocompleteInteraction("incident-session", "penalty", "penalty", "War"),
      { repository }
    );

    expect(result.body).toEqual({
      type: 8,
      data: {
        choices: [{ name: "Warning", value: "preset-1" }]
      }
    });
  });

  it("returns no autocomplete choices for unsupported contexts", async () => {
    await seedConfig(repository);
    await repository.createPenaltyPreset({
      guildId: "guild-1",
      name: "Warning",
      outcome: "Formal warning",
      delta: null,
      createdByUserId: "manager-1"
    });

    const result = await handleDiscordInteraction(
      autocompleteInteraction("incident-session", "complete", "penalty", "War"),
      { repository }
    );

    expect(result.body).toEqual({
      type: 8,
      data: { choices: [] }
    });
  });

  it("keeps an unconfigured guild blocked while another guild is configured", async () => {
    await seedConfig(repository, "guild-a", "manager-role");
    await seedReportingSession(repository, "guild-a", "channel-a");

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
    readonly interactionId?: string;
  } = {}
) {
  return {
    id: input.interactionId ?? `interaction-${interactionIdNumber++}`,
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

function configStatusInteraction(
  input: {
    readonly permissions?: string;
    readonly roles?: readonly string[];
  } = {}
) {
  return {
    ...baseCommand("incident-config"),
    member: {
      user: { id: "user-1" },
      roles: input.roles ?? [],
      permissions: input.permissions ?? PermissionFlagsBits.ManageGuild.toString()
    },
    data: {
      name: "incident-config",
      options: [{ name: "status" }]
    }
  };
}

function configHelpInteraction(
  input: {
    readonly permissions?: string;
    readonly roles?: readonly string[];
  } = {}
) {
  return {
    ...baseCommand("incident-config"),
    member: {
      user: { id: "user-1" },
      roles: input.roles ?? [],
      permissions: input.permissions ?? PermissionFlagsBits.ManageGuild.toString()
    },
    data: {
      name: "incident-config",
      options: [{ name: "help" }]
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
    readonly permissions?: string;
    readonly options?: readonly { readonly name: string; readonly value: unknown }[];
    readonly interactionId?: string;
  } = {}
) {
  return {
    ...baseCommand("incident-session", input),
    application_id: "app-1",
    token: input.guildId ? `token-${subcommand}-${input.guildId}` : `token-${subcommand}`,
    member: {
      user: { id: input.userId ?? "manager-1" },
      roles: input.roles ?? ["manager-role"],
      permissions: input.permissions ?? "0"
    },
    data: {
      name: "incident-session",
      options: [{ name: subcommand, options: input.options }]
    }
  };
}

function configPenaltyAddInteraction(
  name: string,
  outcome: string,
  deltaOrInput?:
    | number
    | {
        readonly permissions?: string;
        readonly roles?: readonly string[];
      },
  input: {
    readonly permissions?: string;
    readonly roles?: readonly string[];
  } = {}
) {
  const delta = typeof deltaOrInput === "number" ? deltaOrInput : undefined;
  const permissionsInput =
    typeof deltaOrInput === "object" && deltaOrInput !== null
      ? deltaOrInput
      : input;

  return {
    ...baseCommand("incident-config"),
    member: {
      user: { id: "manager-1" },
      roles: permissionsInput.roles ?? ["manager-role"],
      permissions:
        permissionsInput.permissions ?? PermissionFlagsBits.ManageGuild.toString()
    },
    data: {
      name: "incident-config",
      options: [
        {
          name: "penalty-add",
          options: [
            { name: "name", value: name },
            { name: "outcome", value: outcome },
            ...(typeof delta === "number" ? [{ name: "delta", value: delta }] : [])
          ]
        }
      ]
    }
  };
}

function configPenaltyRemoveInteraction(penalty: string) {
  return {
    ...baseCommand("incident-config"),
    member: {
      user: { id: "manager-1" },
      roles: ["manager-role"],
      permissions: PermissionFlagsBits.ManageGuild.toString()
    },
    data: {
      name: "incident-config",
      options: [
        {
          name: "penalty-remove",
          options: [{ name: "penalty", value: penalty }]
        }
      ]
    }
  };
}

function configPenaltiesInteraction() {
  return {
    ...baseCommand("incident-config"),
    member: {
      user: { id: "manager-1" },
      roles: ["manager-role"],
      permissions: PermissionFlagsBits.ManageGuild.toString()
    },
    data: {
      name: "incident-config",
      options: [{ name: "penalties" }]
    }
  };
}

function autocompleteInteraction(
  commandName: string,
  subcommandName: string,
  focusedOptionName: string,
  focusedValue: string
) {
  return {
    type: 4,
    guild_id: "guild-1",
    channel_id: "channel-1",
    member: {
      user: { id: "manager-1" },
      roles: ["manager-role"],
      permissions: PermissionFlagsBits.ManageGuild.toString()
    },
    data: {
      name: commandName,
      options: [
        {
          name: subcommandName,
          options: [
            {
              name: focusedOptionName,
              value: focusedValue,
              focused: true
            }
          ]
        }
      ]
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

async function seedReportingSession(
  repository: MemoryIncidentRepository,
  guildId = "guild-1",
  channelId = "channel-1"
): Promise<IncidentSession> {
  return repository.createReportingSession({
    guildId,
    channelId,
    startedByUserId: "manager-1"
  });
}

async function seedStewardingSession(
  repository: MemoryIncidentRepository,
  guildId = "guild-1",
  channelId = "channel-1"
): Promise<IncidentSession> {
  const session = await seedReportingSession(repository, guildId, channelId);
  await repository.endReportingSession({
    sessionId: session.id,
    endedByUserId: "manager-1"
  });
  const stewarding = await repository.startStewardingSession({
    sessionId: session.id,
    startedByUserId: "manager-1"
  });

  if (!stewarding) {
    throw new Error("Unable to seed stewarding session.");
  }

  return stewarding;
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
  readonly dmChannels: { readonly recipientId: string }[] = [];
  readonly messages: { readonly channelId: string; readonly content: string }[] = [];
  readonly edits: {
    readonly applicationId: string;
    readonly interactionToken: string;
    readonly content: string;
  }[] = [];
  failDmChannelCreation = false;
  failChannelMessages = false;

  async createDmChannel(input: {
    readonly recipientId: string;
  }): Promise<{
    readonly channelId: string;
  }> {
    if (this.failDmChannelCreation) {
      throw new Error("DM channel creation failed.");
    }

    this.dmChannels.push(input);
    return { channelId: "dm-channel-1" };
  }

  async createChannelMessage(input: {
    readonly channelId: string;
    readonly content: string;
  }): Promise<void> {
    if (this.failChannelMessages) {
      throw new Error("Message post failed.");
    }

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
