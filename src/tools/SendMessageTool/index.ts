import { z } from "zod";
import type { Tool, ToolResult, ToolContext, ValidationResult } from "../types.js";
import { getAgentName, getTeammateColor, getTeamName } from "../../utils/teammate.js";
import { writeToMailbox, TEAM_LEAD_NAME } from "../../utils/teammateMailbox.js";
import { readTeamFile } from "../../utils/teamHelper.js";

const sendMessageInputSchema = z.strictObject({
  to: z.string().describe(
    "Recipient agent name, '*' for broadcast to all teammates, or 'team-lead' for the team leader",
  ),
  summary: z.string().optional().describe(
    "5-10 word preview of the message content",
  ),
  message: z.string().describe("The message content to send"),
});

type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export const SendMessageTool: Tool<typeof sendMessageInputSchema> = {
  name: "send_message",
  description:
    "Send a message to a teammate or broadcast to the entire team. " +
    "Use '*' as the recipient to broadcast, or 'team-lead' to message the team leader.",

  inputSchema: sendMessageInputSchema,

  requiresConfirmation: false,

  async validateInput(
    input: SendMessageInput,
    _context: ToolContext,
  ): Promise<ValidationResult> {
    if (!input.to.trim()) {
      return { ok: false, error: "Error: recipient (to) is required" };
    }
    if (!input.message.trim()) {
      return { ok: false, error: "Error: message body is required" };
    }
    return { ok: true };
  },

  async checkPermissions(
    _input: SendMessageInput,
    _context: ToolContext,
  ): Promise<import("../../permissions/types.js").PermissionDecision> {
    return { behavior: "ask" };
  },

  isSearchOrReadCommand(_input: SendMessageInput): {
    isSearch: boolean;
    isRead: boolean;
  } {
    return { isSearch: false, isRead: false };
  },

  isReadOnly(_input: SendMessageInput): boolean {
    return false;
  },

  isConcurrencySafe(_input: SendMessageInput): boolean {
    return false;
  },

  async execute(
    input: SendMessageInput,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const sender = getAgentName() ?? TEAM_LEAD_NAME;
    const senderColor = getTeammateColor();
    const timestamp = new Date().toISOString();

    const mailPayload = {
      from: sender,
      text: input.message,
      timestamp,
      color: senderColor,
      summary: input.summary,
    };

    if (input.to === "*") {
      return await handleBroadcast(sender, input, mailPayload);
    }

    const recipient = input.to === "team-lead" ? TEAM_LEAD_NAME : input.to;
    await writeToMailbox(recipient, mailPayload);

    return {
      output: `Message sent to ${recipient}`,
      metadata: {
        routing: {
          sender,
          target: recipient,
          summary: input.summary ?? input.message.slice(0, 60),
        },
      },
    };
  },
};

async function handleBroadcast(
  sender: string,
  input: SendMessageInput,
  mailPayload: { from: string; text: string; timestamp: string; color?: string; summary?: string },
): Promise<ToolResult> {
  const teamName = getTeamName() ?? "default";
  const teamFile = readTeamFile(teamName);

  if (!teamFile || teamFile.members.length === 0) {
    return {
      output: "Error: no team members found for broadcast",
      error: true,
    };
  }

  const recipients = teamFile.members.filter(
    (m) => m.name !== sender,
  );

  if (recipients.length === 0) {
    return {
      output: "Error: no other team members to broadcast to",
      error: true,
    };
  }

  await Promise.all(
    recipients.map((m) => writeToMailbox(m.name, mailPayload)),
  );

  const names = recipients.map((m) => m.name).join(", ");
  return {
    output: `Broadcast sent to ${recipients.length} teammate(s): ${names}`,
    metadata: {
      routing: {
        sender,
        target: "*",
        summary: input.summary ?? input.message.slice(0, 60),
        recipientCount: recipients.length,
      },
    },
  };
}
