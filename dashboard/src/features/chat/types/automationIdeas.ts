/**
 * Automation idea: config-driven suggestion for the chat.
 * Agent interprets base_prompt dynamically; no per-idea logic.
 */
export type AutomationIdea = {
  id: string;
  title: string;
  description: string;
  base_prompt: string;
  required_integrations: string[];
  optional_integrations: string[];
};

/** Sample automation ideas. Use same integration ids as in apps.ts (gmail, linear, slack, zoom, stripe, etc.). */
export const AUTOMATION_IDEAS: AutomationIdea[] = [
  {
    id: "summarize_inbox",
    title: "Summarize my inbox",
    description: "Get a brief summary of unread emails",
    base_prompt: "Summarize my unread emails and list the most important ones with senders and subjects.",
    required_integrations: ["gmail"],
    optional_integrations: [],
  },
  {
    id: "create_linear_issue",
    title: "Create a Linear issue",
    description: "Turn a short description into a Linear issue",
    base_prompt: "Create a Linear issue from this: [describe the issue]. Use the default team and set a sensible title and description.",
    required_integrations: ["linear"],
    optional_integrations: ["slack"],
  },
  {
    id: "schedule_zoom",
    title: "Schedule a Zoom meeting",
    description: "Create a Zoom meeting and optionally invite via Slack",
    base_prompt: "Schedule a Zoom meeting for [time/topic]. Create the meeting and share the link.",
    required_integrations: ["zoom"],
    optional_integrations: ["slack", "calendar"],
  },
  {
    id: "stripe_overview",
    title: "Stripe overview",
    description: "See recent customers and revenue",
    base_prompt: "Give me a short overview of my Stripe account: recent customers, revenue this month, and any failed payments.",
    required_integrations: ["stripe"],
    optional_integrations: [],
  },
];
