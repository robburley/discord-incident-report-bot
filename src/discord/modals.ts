import { INCIDENT_REPORT_NOTE_LIMIT } from "../core/incidents";
import { modalDiscordResponse, type DiscordInteractionResponse } from "./responses";

const COMPONENT_TYPE_ACTION_ROW = 1;
const COMPONENT_TYPE_TEXT_INPUT = 4;
const TEXT_INPUT_STYLE_SHORT = 1;

export const INCIDENT_REPORT_MODAL_CUSTOM_ID = "incident-report";
export const RACE_NUMBER_INPUT_ID = "race_number";
export const LAP_NUMBER_INPUT_ID = "lap_number";
export const TURN_NUMBER_INPUT_ID = "turn_number";
export const CAR_NUMBER_INPUT_ID = "car_number";
export const NOTE_INPUT_ID = "note";

export function incidentReportModalResponse(): DiscordInteractionResponse {
  return modalDiscordResponse({
    customId: INCIDENT_REPORT_MODAL_CUSTOM_ID,
    title: "Report incident",
    components: [
      textInputRow(RACE_NUMBER_INPUT_ID, "Race number", 1, 4),
      textInputRow(LAP_NUMBER_INPUT_ID, "Lap number", 1, 4),
      textInputRow(TURN_NUMBER_INPUT_ID, "Turn / corner number", 1, 4),
      textInputRow(CAR_NUMBER_INPUT_ID, "Your Car number", 1, 12),
      textInputRow(NOTE_INPUT_ID, "Note", 0, INCIDENT_REPORT_NOTE_LIMIT, false)
    ]
  });
}

function textInputRow(
  customId: string,
  label: string,
  minLength: number,
  maxLength: number,
  required = true
) {
  return {
    type: COMPONENT_TYPE_ACTION_ROW,
    components: [
      {
        type: COMPONENT_TYPE_TEXT_INPUT,
        custom_id: customId,
        label,
        style: TEXT_INPUT_STYLE_SHORT,
        min_length: minLength,
        max_length: maxLength,
        required
      }
    ]
  } as const;
}
