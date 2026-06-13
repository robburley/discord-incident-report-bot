import { PermissionFlagsBits } from "discord-api-types/v10";

import {
  INCIDENT_SETUP_MESSAGE,
  configureGuildManagerRole,
  getGuildConfigStatus
} from "../core/config";
import { createIncidentReport } from "../core/incidents";
import {
  endIncidentSession,
  getLatestClosedSessionSummary,
  startIncidentSession
} from "../core/sessions";
import type { IncidentRepository } from "../db/repository";
import {
  INCIDENT_COMMAND_NAME,
  INCIDENT_CONFIG_COMMAND_NAME,
  INCIDENT_SESSION_COMMAND_NAME
} from "./commands";
import {
  CAR_NUMBER_INPUT_ID,
  INCIDENT_REPORT_MODAL_CUSTOM_ID,
  LAP_NUMBER_INPUT_ID,
  RACE_NUMBER_INPUT_ID,
  TURN_NUMBER_INPUT_ID,
  incidentReportModalResponse
} from "./modals";
import type { DiscordRestClient } from "./rest";
import {
  deferredEphemeralDiscordMessage,
  discordPongResponse,
  ephemeralDiscordMessage,
  type DiscordInteractionResponse
} from "./responses";

const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const INTERACTION_TYPE_MODAL_SUBMIT = 5;
const MANAGE_GUILD_PERMISSION = PermissionFlagsBits.ManageGuild;

export interface InteractionHandlerDependencies {
  readonly repository?: IncidentRepository;
  readonly restClient?: DiscordRestClient;
  readonly waitUntil?: (promise: Promise<unknown>) => void;
}

export interface InteractionHandlerResult {
  readonly status: number;
  readonly body: DiscordInteractionResponse | { readonly error: string };
}

interface DiscordApplicationCommandData {
  readonly name?: unknown;
  readonly options?: readonly DiscordCommandOption[];
}

interface DiscordCommandOption {
  readonly name?: unknown;
  readonly value?: unknown;
  readonly options?: readonly DiscordCommandOption[];
}

interface DiscordModalData {
  readonly custom_id?: unknown;
  readonly components?: readonly DiscordModalComponent[];
}

interface DiscordModalComponent {
  readonly custom_id?: unknown;
  readonly value?: unknown;
  readonly components?: readonly DiscordModalComponent[];
}

interface DiscordInteractionPayload {
  readonly id?: unknown;
  readonly application_id?: unknown;
  readonly token?: unknown;
  readonly type?: unknown;
  readonly guild_id?: unknown;
  readonly channel_id?: unknown;
  readonly member?: {
    readonly user?: {
      readonly id?: unknown;
    };
    readonly roles?: readonly unknown[];
    readonly permissions?: unknown;
  };
  readonly user?: {
    readonly id?: unknown;
  };
  readonly data?: DiscordApplicationCommandData | DiscordModalData;
}

export async function handleDiscordInteraction(
  interaction: unknown,
  dependencies: InteractionHandlerDependencies = {}
): Promise<InteractionHandlerResult> {
  logInteractionEvent("handle_interaction_start", interaction);
  if (!isInteractionPayload(interaction)) {
    return {
      status: 400,
      body: { error: "Invalid interaction payload." }
    };
  }

  if (interaction.type === INTERACTION_TYPE_PING) {
    return {
      status: 200,
      body: discordPongResponse()
    };
  }

  if (interaction.type === INTERACTION_TYPE_APPLICATION_COMMAND) {
    return handleApplicationCommand(interaction, dependencies);
  }

  if (interaction.type === INTERACTION_TYPE_MODAL_SUBMIT) {
    return handleModalSubmit(interaction, dependencies);
  }

  return {
    status: 200,
    body: ephemeralDiscordMessage("Unsupported Discord interaction type.")
  };
}

async function handleApplicationCommand(
  interaction: DiscordInteractionPayload,
  dependencies: InteractionHandlerDependencies
): Promise<InteractionHandlerResult> {
  logInteractionEvent("handle_application_command_start", interaction);
  const context = getGuildCommandContext(interaction);

  if (context.status === "invalid") {
    return ok(ephemeralDiscordMessage(context.message));
  }

  if (!isApplicationCommandData(interaction.data)) {
    return ok(ephemeralDiscordMessage("Malformed Discord command payload."));
  }

  const commandName = interaction.data?.name;

  if (typeof commandName !== "string" || commandName === "") {
    return ok(ephemeralDiscordMessage("Malformed Discord command payload."));
  }

  if (commandName === INCIDENT_CONFIG_COMMAND_NAME) {
    return handleConfigCommand(interaction, context, dependencies);
  }

  if (commandName === INCIDENT_SESSION_COMMAND_NAME) {
    return handleSessionCommand(interaction, context, dependencies);
  }

  if (commandName === INCIDENT_COMMAND_NAME) {
    return handleIncidentCommand(context, dependencies);
  }

  return ok(ephemeralDiscordMessage(`Unsupported command: ${commandName}.`));
}

async function handleConfigCommand(
  interaction: DiscordInteractionPayload,
  context: GuildCommandContext,
  dependencies: InteractionHandlerDependencies
): Promise<InteractionHandlerResult> {
  console.log({ event: "handle_config_command_start", context });
  const repository = getRepository(dependencies);

  if (!repository) {
    return ok(ephemeralDiscordMessage("Incident storage is not configured."));
  }

  if (!hasManageGuildPermission(interaction.member?.permissions)) {
    return ok(
      ephemeralDiscordMessage(
        "You need Discord Manage Server permission to configure incidents."
      )
    );
  }

  const subcommand = getSubcommand(interaction.data);

  if (subcommand?.name === "status") {
    const result = await getGuildConfigStatus({
      repository,
      guildId: context.guildId
    });

    return ok(ephemeralDiscordMessage(result.message));
  }

  if (subcommand?.name !== "role") {
    return ok(ephemeralDiscordMessage("Unsupported incident config command."));
  }

  const managerRoleId = getOptionValue(subcommand, "role");

  if (typeof managerRoleId !== "string" || managerRoleId === "") {
    return ok(ephemeralDiscordMessage("Choose a role before configuring incidents."));
  }

  const result = await configureGuildManagerRole({
    repository,
    guildId: context.guildId,
    managerRoleId
  });

  if (result.status === "invalid_role") {
    return ok(ephemeralDiscordMessage(result.message));
  }

  return ok(ephemeralDiscordMessage("Incident manager role configured."));
}

async function handleSessionCommand(
  interaction: DiscordInteractionPayload,
  context: GuildCommandContext,
  dependencies: InteractionHandlerDependencies
): Promise<InteractionHandlerResult> {
  console.log({ event: "handle_session_command_start", context });
  const repository = getRepository(dependencies);

  if (!repository) {
    return ok(ephemeralDiscordMessage("Incident storage is not configured."));
  }

  const subcommand = getSubcommand(interaction.data);

  if (subcommand?.name === "start") {
    const result = await startIncidentSession({
      repository,
      guildId: context.guildId,
      channelId: context.channelId,
      userId: context.userId,
      memberRoleIds: context.memberRoleIds
    });

    if (result.status !== "started") {
      return ok(ephemeralDiscordMessage(result.message));
    }

    scheduleChannelPosts(dependencies, result.session.channelId, [
      `Incident reporting session started in <#${result.session.channelId}>.`
    ]);

    return ok(ephemeralDiscordMessage("Incident session started."));
  }

  if (subcommand?.name === "end") {
    const deferredContext = getDeferredInteractionContext(interaction);

    if (!deferredContext) {
      return ok(ephemeralDiscordMessage("Malformed Discord interaction token."));
    }

    scheduleSummaryAction(dependencies, async () => {
      const result = await endIncidentSession({
        repository,
        guildId: context.guildId,
        userId: context.userId,
        memberRoleIds: context.memberRoleIds
      });

      if (result.status !== "ended") {
        console.error({
          event: "incident_session_end_failed",
          guildId: context.guildId,
          channelId: context.channelId,
          status: result.status
        });
        await editDeferredResponse(dependencies, {
          ...deferredContext,
          content: result.message
        });
        return;
      }

      const posted = await postSummaryMessages(dependencies, result.session.channelId, [
        ...result.summaryMessages
      ]);
      await editDeferredResponse(dependencies, {
        ...deferredContext,
        content: posted
          ? "Incident session ended and summary posted."
          : "Incident session ended, but I could not post the summary. Check the bot can view and send messages in this channel, then run `/incident-session summary`."
      });
    });

    return ok(deferredEphemeralDiscordMessage());
  }

  if (subcommand?.name === "summary") {
    const deferredContext = getDeferredInteractionContext(interaction);

    if (!deferredContext) {
      return ok(ephemeralDiscordMessage("Malformed Discord interaction token."));
    }

    scheduleSummaryAction(dependencies, async () => {
      const result = await getLatestClosedSessionSummary({
        repository,
        guildId: context.guildId,
        userId: context.userId,
        memberRoleIds: context.memberRoleIds
      });

      if (result.status !== "found") {
        console.error({
          event: "incident_session_summary_failed",
          guildId: context.guildId,
          channelId: context.channelId,
          status: result.status
        });
        await editDeferredResponse(dependencies, {
          ...deferredContext,
          content: result.message
        });
        return;
      }

      const posted = await postSummaryMessages(dependencies, result.session.channelId, [
        ...result.summaryMessages
      ]);
      await editDeferredResponse(dependencies, {
        ...deferredContext,
        content: posted
          ? "Latest incident session summary reposted."
          : "I could not repost the latest summary. Check the bot can view and send messages in the original session channel, then try again."
      });
    });

    return ok(deferredEphemeralDiscordMessage());
  }

  return ok(ephemeralDiscordMessage("Unsupported incident session command."));
}

async function handleIncidentCommand(
  context: GuildCommandContext,
  dependencies: InteractionHandlerDependencies
): Promise<InteractionHandlerResult> {
  console.log({ event: "handle_incident_command_start", context });
  const repository = getRepository(dependencies);

  if (!repository) {
    return ok(ephemeralDiscordMessage("Incident storage is not configured."));
  }

  const config = await repository.getGuildConfig(context.guildId);

  if (!config) {
    return ok(ephemeralDiscordMessage(INCIDENT_SETUP_MESSAGE));
  }

  const activeSession = await repository.getActiveSession(context.guildId);

  if (!activeSession) {
    return ok(ephemeralDiscordMessage("There is no active incident session."));
  }

  if (activeSession.channelId !== context.channelId) {
    return ok(
      ephemeralDiscordMessage(
        "Incidents can only be reported in the active session channel."
      )
    );
  }

  return ok(incidentReportModalResponse());
}

async function handleModalSubmit(
  interaction: DiscordInteractionPayload,
  dependencies: InteractionHandlerDependencies
): Promise<InteractionHandlerResult> {
  logInteractionEvent("handle_modal_submit_start", interaction);
  const repository = getRepository(dependencies);

  if (!repository) {
    return ok(ephemeralDiscordMessage("Incident storage is not configured."));
  }

  const context = getGuildCommandContext(interaction);

  if (context.status === "invalid") {
    return ok(ephemeralDiscordMessage(context.message));
  }

  if (!isModalData(interaction.data)) {
    return ok(ephemeralDiscordMessage("Malformed modal submission."));
  }

  if (interaction.data.custom_id !== INCIDENT_REPORT_MODAL_CUSTOM_ID) {
    return ok(ephemeralDiscordMessage("Unsupported modal submission."));
  }

  if (typeof interaction.id !== "string" || interaction.id === "") {
    return ok(ephemeralDiscordMessage("Malformed modal submission."));
  }

  const values = getModalValues(interaction.data.components ?? []);
  const result = await createIncidentReport({
    repository,
    guildId: context.guildId,
    channelId: context.channelId,
    submittedByUserId: context.userId,
    discordInteractionId: interaction.id,
    raceNumber: values.get(RACE_NUMBER_INPUT_ID),
    lapNumber: values.get(LAP_NUMBER_INPUT_ID),
    turnNumber: values.get(TURN_NUMBER_INPUT_ID),
    carNumber: values.get(CAR_NUMBER_INPUT_ID)
  });

  if (result.status === "created") {
    try {
      await dependencies.restClient?.createChannelMessage({
        channelId: context.channelId,
        content: `An incident report has been submitted by <@${context.userId}>.
Details:
Race Number: ${values.get(RACE_NUMBER_INPUT_ID)}
Lap Number: ${values.get(LAP_NUMBER_INPUT_ID)}
Turn / Corner Number: ${values.get(TURN_NUMBER_INPUT_ID)}
Car Number: ${values.get(CAR_NUMBER_INPUT_ID)}`,
      });
    } catch (error) {
      console.error({
        event: "discord_rest_channel_message_failed",
        channelId: context.channelId,
        error: error instanceof Error ? error.message : "Unknown Discord REST error"
      });
    }
    return ok(ephemeralDiscordMessage("Incident report submitted."));
  }

  if (result.status === "duplicate_interaction") {
    return ok(ephemeralDiscordMessage("Incident report already submitted."));
  }

  if (
    result.status === "guild_not_configured" ||
    result.status === "no_active_session" ||
    result.status === "wrong_channel" ||
    result.status === "invalid_report" ||
    result.status === "duplicate_report"
  ) {
    return ok(ephemeralDiscordMessage(result.message));
  }

  return ok(ephemeralDiscordMessage("Unable to submit incident report."));
}

interface GuildCommandContext {
  readonly status: "valid";
  readonly guildId: string;
  readonly channelId: string;
  readonly userId: string;
  readonly memberRoleIds: readonly string[];
}

function getGuildCommandContext(
  interaction: DiscordInteractionPayload
):
  | GuildCommandContext
  | {
      readonly status: "invalid";
      readonly message: string;
    } {
  if (typeof interaction.guild_id !== "string" || interaction.guild_id === "") {
    return {
      status: "invalid",
      message: "This bot can only be used in a server."
    };
  }

  if (typeof interaction.channel_id !== "string" || interaction.channel_id === "") {
    return {
      status: "invalid",
      message: "Malformed Discord interaction channel."
    };
  }

  const userId =
    typeof interaction.member?.user?.id === "string"
      ? interaction.member.user.id
      : typeof interaction.user?.id === "string"
        ? interaction.user.id
        : "";

  if (userId === "") {
    return {
      status: "invalid",
      message: "Malformed Discord interaction user."
    };
  }

  return {
    status: "valid",
    guildId: interaction.guild_id,
    channelId: interaction.channel_id,
    userId,
    memberRoleIds: (interaction.member?.roles ?? []).filter(
      (role): role is string => typeof role === "string"
    )
  };
}

function getRepository(
  dependencies: InteractionHandlerDependencies
): IncidentRepository | null {
  return dependencies.repository ?? null;
}

function getSubcommand(
  data: DiscordInteractionPayload["data"]
): DiscordCommandOption | null {
  if (!isApplicationCommandData(data)) {
    return null;
  }

  const [subcommand] = data.options ?? [];
  return subcommand ?? null;
}

function getOptionValue(
  option: DiscordCommandOption,
  name: string
): unknown {
  return option.options?.find((child) => child.name === name)?.value;
}

function getModalValues(
  components: readonly DiscordModalComponent[]
): Map<string, string> {
  const values = new Map<string, string>();
  const pending = [...components];

  while (pending.length > 0) {
    const component = pending.shift();

    if (!component) {
      continue;
    }

    if (typeof component.custom_id === "string") {
      values.set(
        component.custom_id,
        typeof component.value === "string" ? component.value : ""
      );
    }

    pending.push(...(component.components ?? []));
  }

  return values;
}

function hasManageGuildPermission(permissions: unknown): boolean {
  if (typeof permissions !== "string" || permissions === "") {
    return false;
  }

  try {
    return (
      (BigInt(permissions) & MANAGE_GUILD_PERMISSION) === MANAGE_GUILD_PERMISSION
    );
  } catch {
    return false;
  }
}

function getDeferredInteractionContext(
  interaction: DiscordInteractionPayload
): {
  readonly applicationId: string;
  readonly interactionToken: string;
} | null {
  if (
    typeof interaction.application_id !== "string" ||
    interaction.application_id === "" ||
    typeof interaction.token !== "string" ||
    interaction.token === ""
  ) {
    return null;
  }

  return {
    applicationId: interaction.application_id,
    interactionToken: interaction.token
  };
}

function scheduleChannelPosts(
  dependencies: InteractionHandlerDependencies,
  channelId: string,
  messages: readonly string[]
): void {
  const promise = postSummaryMessages(dependencies, channelId, messages);
  schedulePromise(dependencies, promise);
}

function scheduleSummaryAction(
  dependencies: InteractionHandlerDependencies,
  action: () => Promise<void>
): void {
  schedulePromise(dependencies, action());
}

async function postSummaryMessages(
  dependencies: InteractionHandlerDependencies,
  channelId: string,
  messages: readonly string[]
): Promise<boolean> {
  if (!dependencies.restClient) {
    console.error({
      event: "discord_rest_client_missing",
      channelId
    });
    return false;
  }

  let allPosted = true;

  for (const content of messages) {
    try {
      await dependencies.restClient.createChannelMessage({ channelId, content });
    } catch (error) {
      allPosted = false;
      console.error({
        event: "discord_rest_message_post_failed",
        channelId,
        message: error instanceof Error ? error.message : "Unknown Discord REST error"
      });
    }
  }

  return allPosted;
}

async function editDeferredResponse(
  dependencies: InteractionHandlerDependencies,
  input: {
    readonly applicationId: string;
    readonly interactionToken: string;
    readonly content: string;
  }
): Promise<void> {
  if (!dependencies.restClient) {
    return;
  }

  try {
    await dependencies.restClient.editOriginalInteractionResponse(input);
  } catch (error) {
    console.error({
      event: "discord_rest_interaction_response_edit_failed",
      message: error instanceof Error ? error.message : "Unknown Discord REST error"
    });
  }
}

function schedulePromise(
  dependencies: InteractionHandlerDependencies,
  promise: Promise<unknown>
): void {
  if (dependencies.waitUntil) {
    dependencies.waitUntil(promise);
    return;
  }

  void promise;
}

function ok(body: DiscordInteractionResponse): InteractionHandlerResult {
  return {
    status: 200,
    body
  };
}

function isInteractionPayload(
  interaction: unknown
): interaction is DiscordInteractionPayload {
  return interaction !== null && typeof interaction === "object";
}

function isApplicationCommandData(
  data: DiscordInteractionPayload["data"]
): data is DiscordApplicationCommandData {
  return data !== null && typeof data === "object";
}

function isModalData(data: DiscordInteractionPayload["data"]): data is DiscordModalData {
  return (
    data !== null &&
    typeof data === "object" &&
    "custom_id" in data
  );
}

function logInteractionEvent(event: string, interaction: unknown): void {
  if (!isInteractionPayload(interaction)) {
    console.log({ event, interactionType: typeof interaction });
    return;
  }

  console.log({
    event,
    interactionId:
      typeof interaction.id === "string" ? interaction.id : undefined,
    interactionType: interaction.type,
    commandName: isApplicationCommandData(interaction.data)
      ? interaction.data.name
      : undefined,
    modalCustomId: isModalData(interaction.data)
      ? interaction.data.custom_id
      : undefined,
    guildId: interaction.guild_id,
    channelId: interaction.channel_id
  });
}
