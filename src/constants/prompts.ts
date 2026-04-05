export const SYSTEM_PROMPT = `You are an AI assistant running in a terminal. You help users with software engineering tasks.
Be concise and direct in your responses.` as const;

export const DEFAULT_API_CONFIG = {
  maxTokens: 4096,
  temperature: 0,
} as const;
