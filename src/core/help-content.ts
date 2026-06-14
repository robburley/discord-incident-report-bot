export const STEWARD_USER_GUIDE = `# Incident Bot Steward Guide

This guide is for server managers and configured incident manager-role stewards.
Use it when you are running incident reporting, stewarding, or penalty decisions
for a race server.

## Access

Server admins configure the incident manager role with:

\`\`\`text
/incident-config role role:<manager role>
\`\`\`

After setup, members with Discord Manage Server permission or the configured
manager role can manage incident sessions and stewarding decisions. The
\`/incident-config role\` command remains admin-only.

Use \`/incident-config status\` to check whether the server is configured and
which manager role is active.

## Reporting

Start reporting in the channel where reports should be collected:

\`\`\`text
/incident-session start
\`\`\`

Drivers can submit \`/incident\` only while reporting is open, and only in the
active reporting channel.

End reporting with:

\`\`\`text
/incident-session end
\`\`\`

The bot posts a public incident list in the original session channel. Use the
incident IDs from that list when making penalty decisions.

If reporting ended too early, use \`/incident-session reopen-reporting\` before
stewarding starts. Once stewarding has started, reporting cannot be reopened.

## Stewarding

Start stewarding for the latest session awaiting stewards:

\`\`\`text
/incident-session steward
\`\`\`

Stewarding decisions are recorded against the original incident session. Use
\`/incident-session summary\` if you need to repost the incident list.

Complete stewarding with:

\`\`\`text
/incident-session complete
\`\`\`

The bot posts a final public decision summary. Use \`/incident-session decisions\`
to repost the latest decision summary if needed.

If decisions need correction after completion, use
\`/incident-session reopen-stewarding\`, update the decisions, then complete
stewarding again.

## Penalty Presets

Penalty presets are configured per server:

\`\`\`text
/incident-config penalty-add name:<preset name> outcome:<summary text> delta:<optional integer>
/incident-config penalty-remove penalty:<preset>
/incident-config penalties
\`\`\`

Preset names appear in autocomplete when assigning penalties. The optional
\`delta\` can represent points, seconds, strikes, or another league-specific
number. Removing a preset deactivates it for future use, but old summaries keep
the decision text that was recorded at the time.

## Penalty Decisions

During stewarding, assign or update a penalty with:

\`\`\`text
/incident-session penalty incident-id:<id> affected-user:<driver> penalty:<preset> note:<optional note>
\`\`\`

Assigning a penalty to the same incident and affected user again updates that
decision. Assigning penalties to different affected users on the same incident
creates separate decisions.

Clear all penalty decisions for one incident in the current stewarding session:

\`\`\`text
/incident-session penalty-clear incident-id:<id>
\`\`\`

This does not affect decisions for other incidents.

## Responses And Troubleshooting

Setup confirmations and errors are ephemeral. Session state changes and
summaries are posted publicly in the original session channel.

If a summary does not post, check that the bot can view and send messages in the
session channel, then use \`/incident-session summary\` for incident lists or
\`/incident-session decisions\` for final decisions.

If \`/incident-config\` is visible to someone who cannot use a protected
subcommand, the bot will reject unauthorized actions. Server admins can
optionally hide or restrict the command in Discord Server Settings or
Integrations command permissions.`;
