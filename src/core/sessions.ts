import { RepositoryConflictError } from "../db/repository";
import type {
  IncidentRepository,
  IncidentSession,
  PenaltyPreset,
  UpsertPenaltyResult
} from "../db/repository";
import { hasIncidentManagerPermission } from "./authorization";
import { INCIDENT_SETUP_MESSAGE } from "./config";
import {
  formatSplitSessionSummary,
  formatSplitStewardingDecisionSummary
} from "./summary";

export const PENALTY_PRESET_NAME_LIMIT = 100;
export const PENALTY_OUTCOME_LIMIT = 200;
export const PENALTY_NOTE_LIMIT = 200;

interface SessionActionInput {
  readonly repository: IncidentRepository;
  readonly guildId: string;
  readonly userId: string;
  readonly memberRoleIds: readonly string[];
  readonly canManageGuild?: boolean;
}

export interface StartIncidentSessionInput extends SessionActionInput {
  readonly channelId: string;
}

export type StartIncidentSessionResult =
  | {
      readonly status: "started";
      readonly session: IncidentSession;
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "unauthorized"
        | "previous_session_not_decided";
      readonly message: string;
      readonly session?: IncidentSession;
    };

export interface EndIncidentSessionInput extends SessionActionInput {}

export type EndIncidentSessionResult =
  | {
      readonly status: "ended";
      readonly session: IncidentSession;
      readonly summaryMessages: readonly string[];
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "unauthorized"
        | "no_reporting_session";
      readonly message: string;
    };

export interface LatestSessionSummaryInput extends SessionActionInput {}

export type LatestSessionSummaryResult =
  | {
      readonly status: "found";
      readonly session: IncidentSession;
      readonly summaryMessages: readonly string[];
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "unauthorized"
        | "no_incident_summary";
      readonly message: string;
    };

export interface StartStewardingInput extends SessionActionInput {}

export type StartStewardingResult =
  | {
      readonly status: "started";
      readonly session: IncidentSession;
      readonly summaryMessages: readonly string[];
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "unauthorized"
        | "already_stewarding"
        | "no_reporting_session";
      readonly message: string;
      readonly session?: IncidentSession;
    };

export interface ApplyPenaltyInput extends SessionActionInput {
  readonly channelId: string;
  readonly incidentId: string;
  readonly affectedUserId?: string | null;
  readonly penaltyPreset: string;
  readonly note?: string | null;
}

export type ApplyPenaltyResult =
  | {
      readonly status: "recorded" | "updated";
      readonly session: IncidentSession;
      readonly result: UpsertPenaltyResult;
      readonly incidentId: string;
      readonly affectedUserId: string;
      readonly outcome: string;
      readonly note: string | null;
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "unauthorized"
        | "no_stewarding_session"
        | "missing_affected_user"
        | "invalid_note"
        | "unknown_penalty_preset"
        | "unknown_incident";
      readonly message: string;
    };

export interface ClearPenaltyForIncidentInput extends SessionActionInput {
  readonly channelId: string;
  readonly incidentId: string;
}

export type ClearPenaltyForIncidentResult =
  | {
      readonly status: "cleared" | "none_found";
      readonly session: IncidentSession;
      readonly incidentId: string;
      readonly clearedCount: number;
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "unauthorized"
        | "no_stewarding_session"
        | "unknown_incident";
      readonly message: string;
    };

export interface ReopenReportingInput extends SessionActionInput {}

export type ReopenReportingResult =
  | {
      readonly status: "reopened";
      readonly session: IncidentSession;
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "unauthorized"
        | "no_stewarding_session"
        | "penalties_exist";
      readonly message: string;
      readonly session?: IncidentSession;
    };

export interface ReopenStewardingInput extends SessionActionInput {}

export type ReopenStewardingResult =
  | {
      readonly status: "reopened";
      readonly session: IncidentSession;
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "unauthorized"
        | "already_stewarding"
        | "no_decided_session";
      readonly message: string;
      readonly session?: IncidentSession;
    };

export interface PenaltyPresetInput extends SessionActionInput {
  readonly name: string;
  readonly outcome: string;
  readonly delta?: number | null;
}

export type AddPenaltyPresetResult =
  | {
      readonly status: "added";
      readonly preset: PenaltyPreset;
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "unauthorized"
        | "invalid_name"
        | "invalid_outcome"
        | "duplicate_preset";
      readonly message: string;
    };

export interface RemovePenaltyPresetInput extends SessionActionInput {
  readonly penaltyPreset: string;
}

export type RemovePenaltyPresetResult =
  | {
      readonly status: "removed";
      readonly preset: PenaltyPreset;
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "unauthorized"
        | "unknown_penalty_preset";
      readonly message: string;
    };

export interface ListPenaltyPresetsInput extends SessionActionInput {}

export type ListPenaltyPresetsResult =
  | {
      readonly status: "found";
      readonly presets: readonly PenaltyPreset[];
    }
  | {
      readonly status: "guild_not_configured" | "unauthorized";
      readonly message: string;
    };

export interface SearchPenaltyPresetsInput {
  readonly repository: IncidentRepository;
  readonly guildId: string;
  readonly query: string;
}

export type SearchPenaltyPresetsResult =
  | {
      readonly status: "found";
      readonly presets: readonly PenaltyPreset[];
    }
  | {
      readonly status: "guild_not_configured";
      readonly message: string;
    };

export interface CompleteStewardingInput extends SessionActionInput {
  readonly channelId: string;
}

export type CompleteStewardingResult =
  | {
      readonly status: "completed";
      readonly session: IncidentSession;
      readonly summaryMessages: readonly string[];
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "unauthorized"
        | "no_stewarding_session";
      readonly message: string;
    };

export interface LatestDecisionSummaryInput extends SessionActionInput {}

export type LatestDecisionSummaryResult =
  | {
      readonly status: "found";
      readonly session: IncidentSession;
      readonly summaryMessages: readonly string[];
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "unauthorized"
        | "no_decided_session";
      readonly message: string;
    };

export async function startIncidentSession(
  input: StartIncidentSessionInput
): Promise<StartIncidentSessionResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  try {
    const session = await input.repository.createReportingSession({
      guildId: input.guildId,
      channelId: input.channelId,
      startedByUserId: input.userId
    });

    return {
      status: "started",
      session
    };
  } catch (error) {
    if (error instanceof RepositoryConflictError) {
      return {
        status: "previous_session_not_decided",
        message:
          "The previous incident session must be decided before starting a new one."
      };
    }

    throw error;
  }
}

export async function endIncidentSession(
  input: EndIncidentSessionInput
): Promise<EndIncidentSessionResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const reportingSession = await input.repository.getReportingSessionForGuild(
    input.guildId
  );

  if (!reportingSession) {
    return {
      status: "no_reporting_session",
      message: "There is no reporting incident session to end."
    };
  }

  const endedSession = await input.repository.endReportingSession({
    sessionId: reportingSession.id,
    endedByUserId: input.userId
  });

  if (!endedSession) {
    return {
      status: "no_reporting_session",
      message: "There is no reporting incident session to end."
    };
  }

  const reports = await input.repository.getOrderedReportsForSession(
    endedSession.id
  );

  return {
    status: "ended",
    session: endedSession,
    summaryMessages: formatSplitSessionSummary({
      session: endedSession,
      reports
    })
  };
}

export async function getLatestIncidentSessionSummary(
  input: LatestSessionSummaryInput
): Promise<LatestSessionSummaryResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const session = await input.repository.getLatestIncidentSummarySessionForGuild(
    input.guildId
  );

  if (!session) {
    return {
      status: "no_incident_summary",
      message: "No incident report summary is available yet."
    };
  }

  const reports = await input.repository.getOrderedReportsForSession(session.id);

  return {
    status: "found",
    session,
    summaryMessages: formatSplitSessionSummary({ session, reports })
  };
}

export async function startStewarding(
  input: StartStewardingInput
): Promise<StartStewardingResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const stewarding = await input.repository.getStewardingSessionForGuild(
    input.guildId
  );

  if (stewarding) {
    return {
      status: "already_stewarding",
      message: "An incident session is already being stewarded for this server.",
      session: stewarding
    };
  }

  const reportingSession = await input.repository.getReportingSessionForGuild(
    input.guildId
  );

  if (!reportingSession) {
    return {
      status: "no_reporting_session",
      message: "There is no reporting incident session to start stewarding."
    };
  }

  const awaiting = await input.repository.endReportingSession({
    sessionId: reportingSession.id,
    endedByUserId: input.userId
  });

  if (!awaiting) {
    return {
      status: "no_reporting_session",
      message: "There is no reporting incident session to start stewarding."
    };
  }

  const session = await input.repository.startStewardingSession({
    sessionId: awaiting.id,
    startedByUserId: input.userId
  });

  if (!session) {
    return {
      status: "no_reporting_session",
      message: "There is no reporting incident session to start stewarding."
    };
  }

  const reports = await input.repository.getOrderedReportsForSession(session.id);

  return {
    status: "started",
    session,
    summaryMessages: formatSplitSessionSummary({ session, reports })
  };
}

export async function applyPenalty(
  input: ApplyPenaltyInput
): Promise<ApplyPenaltyResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const session = await input.repository.getStewardingSessionForChannel(
    input.guildId,
    input.channelId
  );

  if (!session) {
    return {
      status: "no_stewarding_session",
      message: "There is no stewarding session in this channel."
    };
  }

  const affectedUserId = input.affectedUserId?.trim();

  if (!affectedUserId) {
    return {
      status: "missing_affected_user",
      message: "Choose an affected user before assigning a penalty."
    };
  }

  const note = normalizePenaltyText(input.note ?? "") || null;

  if (note && note.length > PENALTY_NOTE_LIMIT) {
    return {
      status: "invalid_note",
      message: `Penalty note must be ${PENALTY_NOTE_LIMIT} characters or fewer.`
    };
  }

  const preset = await input.repository.getActivePenaltyPresetForGuild(
    input.guildId,
    input.penaltyPreset
  );

  if (!preset) {
    return {
      status: "unknown_penalty_preset",
      message: "That penalty preset is not configured or has been removed."
    };
  }

  const report =
    await input.repository.getReportForStewardingSessionByDiscordInteractionId(
      session.id,
      input.guildId,
      input.incidentId
    );

  if (!report) {
    return {
      status: "unknown_incident",
      message: `Incident ${input.incidentId} was not found in this stewarding session.`
    };
  }

  const outcome = normalizePenaltyText(preset.outcome);

  const result = await input.repository.upsertPenaltyForIncidentSession({
    incidentSessionId: session.id,
    incidentReportId: report.id,
    affectedUserId,
    penaltyPresetId: preset.id,
    outcome,
    delta: preset.delta,
    note,
    createdByUserId: input.userId,
    updatedByUserId: input.userId
  });

  return {
    status: result.status === "inserted" ? "recorded" : "updated",
    session,
    result,
    incidentId: input.incidentId,
    affectedUserId,
    outcome,
    note
  };
}

export async function clearPenaltyForIncident(
  input: ClearPenaltyForIncidentInput
): Promise<ClearPenaltyForIncidentResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const session = await input.repository.getStewardingSessionForChannel(
    input.guildId,
    input.channelId
  );

  if (!session) {
    return {
      status: "no_stewarding_session",
      message: "There is no stewarding session in this channel."
    };
  }

  const report =
    await input.repository.getReportForStewardingSessionByDiscordInteractionId(
      session.id,
      input.guildId,
      input.incidentId
    );

  if (!report) {
    return {
      status: "unknown_incident",
      message: `Incident ${input.incidentId} was not found in this stewarding session.`
    };
  }

  const clearedCount = await input.repository.clearPenaltiesForIncidentInSession({
    incidentSessionId: session.id,
    incidentReportId: report.id
  });

  return {
    status: clearedCount > 0 ? "cleared" : "none_found",
    session,
    incidentId: input.incidentId,
    clearedCount
  };
}

export async function reopenReporting(
  input: ReopenReportingInput
): Promise<ReopenReportingResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const result = await input.repository.reopenStewardingSessionForReporting({
    guildId: input.guildId,
    reopenedByUserId: input.userId
  });

  if (result.status === "reopened") {
    return result;
  }

  if (result.status === "penalties_exist") {
    return {
      status: "penalties_exist",
      message:
        "Reporting cannot be reopened after penalty decisions have been recorded.",
      ...(result.session ? { session: result.session } : {})
    };
  }

  return {
    status: "no_stewarding_session",
    message:
      "There is no latest stewarding incident session available to reopen for reporting.",
    ...(result.session ? { session: result.session } : {})
  };
}

export async function reopenStewarding(
  input: ReopenStewardingInput
): Promise<ReopenStewardingResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const result = await input.repository.reopenDecidedSessionForStewarding({
    guildId: input.guildId,
    reopenedByUserId: input.userId
  });

  if (result.status === "reopened") {
    return result;
  }

  if (result.status === "already_stewarding") {
    return {
      status: "already_stewarding",
      message: "An incident session is already being stewarded for this server.",
      ...(result.session ? { session: result.session } : {})
    };
  }

  return {
    status: "no_decided_session",
    message: "No latest decided incident session is available to reopen.",
    ...(result.session ? { session: result.session } : {})
  };
}

export async function addPenaltyPreset(
  input: PenaltyPresetInput
): Promise<AddPenaltyPresetResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const name = normalizePenaltyText(input.name);
  const outcome = normalizePenaltyText(input.outcome);

  if (name.length === 0 || name.length > PENALTY_PRESET_NAME_LIMIT) {
    return {
      status: "invalid_name",
      message: `Penalty preset name must be 1-${PENALTY_PRESET_NAME_LIMIT} characters.`
    };
  }

  if (outcome.length === 0 || outcome.length > PENALTY_OUTCOME_LIMIT) {
    return {
      status: "invalid_outcome",
      message: `Penalty outcome must be 1-${PENALTY_OUTCOME_LIMIT} characters.`
    };
  }

  const activePresets = await input.repository.listPenaltyPresetsForGuild(
    input.guildId
  );
  const existing = activePresets.find(
    (preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  );

  if (existing) {
    return {
      status: "duplicate_preset",
      message: "An active penalty preset with that name already exists."
    };
  }

  let preset: PenaltyPreset;

  try {
    preset = await input.repository.createPenaltyPreset({
      guildId: input.guildId,
      name,
      outcome,
      delta: input.delta ?? null,
      createdByUserId: input.userId
    });
  } catch (error) {
    if (error instanceof RepositoryConflictError) {
      return {
        status: "duplicate_preset",
        message: "An active penalty preset with that name already exists."
      };
    }

    throw error;
  }

  return {
    status: "added",
    preset
  };
}

export async function removePenaltyPreset(
  input: RemovePenaltyPresetInput
): Promise<RemovePenaltyPresetResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const preset = await input.repository.getActivePenaltyPresetForGuild(
    input.guildId,
    input.penaltyPreset
  );

  if (!preset) {
    return {
      status: "unknown_penalty_preset",
      message: "That penalty preset is not configured or has already been removed."
    };
  }

  const removed = await input.repository.deactivatePenaltyPreset({
    presetId: preset.id,
    deactivatedByUserId: input.userId
  });

  if (!removed) {
    return {
      status: "unknown_penalty_preset",
      message: "That penalty preset is not configured or has already been removed."
    };
  }

  return {
    status: "removed",
    preset: removed
  };
}

export async function listPenaltyPresets(
  input: ListPenaltyPresetsInput
): Promise<ListPenaltyPresetsResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const presets = await input.repository.listPenaltyPresetsForGuild(
    input.guildId
  );

  return {
    status: "found",
    presets
  };
}

export async function searchPenaltyPresets(
  input: SearchPenaltyPresetsInput
): Promise<SearchPenaltyPresetsResult> {
  const config = await input.repository.getGuildConfig(input.guildId);

  if (!config) {
    return {
      status: "guild_not_configured",
      message: INCIDENT_SETUP_MESSAGE
    };
  }

  const presets = await input.repository.searchPenaltyPresetsForGuild(
    input.guildId,
    input.query
  );

  return {
    status: "found",
    presets
  };
}

export async function completeStewarding(
  input: CompleteStewardingInput
): Promise<CompleteStewardingResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const stewardingSession = await input.repository.getStewardingSessionForChannel(
    input.guildId,
    input.channelId
  );

  if (!stewardingSession) {
    return {
      status: "no_stewarding_session",
      message: "There is no stewarding session in this channel."
    };
  }

  const session = await input.repository.completeStewardingSession({
    sessionId: stewardingSession.id,
    completedByUserId: input.userId
  });

  if (!session) {
    return {
      status: "no_stewarding_session",
      message: "There is no stewarding session in this channel."
    };
  }

  const decisions = await input.repository.getPenaltiesWithReportsForSession(
    session.id
  );

  return {
    status: "completed",
    session,
    summaryMessages: formatSplitStewardingDecisionSummary({
      session,
      decisions
    })
  };
}

export async function getLatestDecisionSummary(
  input: LatestDecisionSummaryInput
): Promise<LatestDecisionSummaryResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const session = await input.repository.getLatestDecidedSessionForGuild(
    input.guildId
  );

  if (!session) {
    return {
      status: "no_decided_session",
      message: "No decided incident session is available yet."
    };
  }

  const decisions = await input.repository.getPenaltiesWithReportsForSession(
    session.id
  );

  return {
    status: "found",
    session,
    summaryMessages: formatSplitStewardingDecisionSummary({
      session,
      decisions
    })
  };
}

async function authorizeSessionAction(
  input: SessionActionInput
): Promise<
  | {
      readonly status: "authorized";
    }
  | {
      readonly status: "guild_not_configured" | "unauthorized";
      readonly message: string;
    }
> {
  const config = await input.repository.getGuildConfig(input.guildId);

  if (!config) {
    return {
      status: "guild_not_configured",
      message: INCIDENT_SETUP_MESSAGE
    };
  }

  if (
    !hasIncidentManagerPermission({
      managerRoleId: config.managerRoleId,
      memberRoleIds: input.memberRoleIds,
      ...(input.canManageGuild === undefined
        ? {}
        : { canManageGuild: input.canManageGuild })
    })
  ) {
    return {
      status: "unauthorized",
      message: "Only incident managers can use this command."
    };
  }

  return { status: "authorized" };
}

function normalizePenaltyText(value: string): string {
  return value.replace(/`/g, "'").replace(/\s+/g, " ").trim();
}
