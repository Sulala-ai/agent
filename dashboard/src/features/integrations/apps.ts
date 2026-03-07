import type { LucideIcon } from "lucide-react";
import {
  Github,
  Mail,
  Calendar,
  HardDrive,
  Users,
  FileText,
  Sheet,
  CheckSquare,
  Facebook,
  BookOpen,
  MessageCircle,
  LayoutGrid,
  Activity,
  Video,
  Youtube,
  Cloud,
  FolderKanban,
  Presentation,
  PenTool,
} from "lucide-react";

export type IntegrationCategory = "featured" | "productivity" | "lifestyle";

/** Optional logo URL (e.g. from Simple Icons CDN). When set, UI shows logo; otherwise falls back to icon. */
const LOGO_BASE = "https://cdn.simpleicons.org";

export type IntegrationAppMeta = {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  icon: LucideIcon;
  /** Optional: URL to brand logo. When set, shown in app card instead of Lucide icon. */
  logoUrl?: string;
  /** When true, app uses a bot token in agent .env (no OAuth). Show setup instructions instead of Connect. */
  tokenOnly?: boolean;
};

/** App metadata for automation ideas and missing-integrations UI (e.g. Gmail, Slack). */
const appMeta: IntegrationAppMeta[] = [
  { id: "github", name: "GitHub", description: "Repos, issues, and code", category: "featured", icon: Github, logoUrl: `${LOGO_BASE}/github` },
  { id: "gmail", name: "Gmail", description: "Send and read email", category: "featured", icon: Mail, logoUrl: `${LOGO_BASE}/gmail` },
  { id: "notion", name: "Notion", description: "Pages, databases, and docs", category: "featured", icon: BookOpen, logoUrl: `${LOGO_BASE}/notion` },
  { id: "slack", name: "Slack", description: "Channels and messages", category: "featured", icon: MessageCircle, logoUrl: `${LOGO_BASE}/slack` },
  { id: "calendar", name: "Google Calendar", description: "Events and scheduling", category: "featured", icon: Calendar, logoUrl: `${LOGO_BASE}/googlecalendar` },
  { id: "drive", name: "Google Drive", description: "Files and folders", category: "featured", icon: HardDrive, logoUrl: `${LOGO_BASE}/googledrive` },
  { id: "docs", name: "Google Docs", description: "Create and edit documents", category: "featured", icon: FileText, logoUrl: `${LOGO_BASE}/googledocs` },
  { id: "sheets", name: "Google Sheets", description: "Spreadsheets and data", category: "featured", icon: Sheet, logoUrl: `${LOGO_BASE}/googlesheets` },
  { id: "asana", name: "Asana", description: "Tasks and projects", category: "featured", icon: CheckSquare, logoUrl: `${LOGO_BASE}/asana` },
  { id: "contacts", name: "Google Contacts", description: "Contacts and people", category: "featured", icon: Users, logoUrl: `${LOGO_BASE}/google` },
  { id: "facebook", name: "Facebook", description: "Pages and posts", category: "featured", icon: Facebook, logoUrl: `${LOGO_BASE}/facebook` },
  { id: "bluesky", name: "Bluesky", description: "Posts and timeline (atproto)", category: "featured", icon: MessageCircle, logoUrl: `${LOGO_BASE}/bluesky` },
  { id: "airtable", name: "Airtable", description: "Bases, tables, and records", category: "featured", icon: LayoutGrid, logoUrl: `${LOGO_BASE}/airtable` },
  { id: "linear", name: "Linear", description: "Issues and workflows", category: "featured", icon: Activity, logoUrl: `${LOGO_BASE}/linear` },
  { id: "zoom", name: "Zoom", description: "Meetings and video", category: "featured", icon: Video, logoUrl: `${LOGO_BASE}/zoom` },
  { id: "dropbox", name: "Dropbox", description: "Files and folders", category: "featured", icon: Cloud, logoUrl: `${LOGO_BASE}/dropbox` },
  { id: "jira", name: "Jira", description: "Issues and projects", category: "featured", icon: FolderKanban, logoUrl: `${LOGO_BASE}/jirasoftware` },
  { id: "slides", name: "Google Slides", description: "Presentations and slides", category: "featured", icon: Presentation, logoUrl: `${LOGO_BASE}/googleslides` },
  { id: "figma", name: "Figma", description: "Design files and prototypes", category: "featured", icon: PenTool, logoUrl: `${LOGO_BASE}/figma` },
  { id: "trello", name: "Trello", description: "Boards, lists, and cards", category: "productivity", icon: FolderKanban, logoUrl: `${LOGO_BASE}/trello` },
  { id: "twitter", name: "Twitter / X", description: "Post and read tweets", category: "featured", icon: MessageCircle, logoUrl: `${LOGO_BASE}/x` },
  { id: "microsoft", name: "Microsoft 365", description: "Outlook, Calendar, OneDrive", category: "featured", icon: Mail, logoUrl: `${LOGO_BASE}/microsoft` },
  { id: "zendesk", name: "Zendesk", description: "Tickets and support", category: "productivity", icon: MessageCircle, logoUrl: `${LOGO_BASE}/zendesk` },
  { id: "youtube", name: "YouTube", description: "Channels, videos, and uploads", category: "featured", icon: Youtube, logoUrl: `${LOGO_BASE}/youtube` },
];

const byId = new Map<string, IntegrationAppMeta>(appMeta.map((a) => [a.id, a]));

export const INTEGRATION_CATEGORIES: { id: IntegrationCategory; label: string }[] = [
  { id: "featured", label: "Featured" },
  { id: "productivity", label: "Productivity" },
  { id: "lifestyle", label: "Lifestyle" },
];

export function getAppMeta(providerId: string): IntegrationAppMeta | null {
  return byId.get(providerId.toLowerCase()) ?? null;
}

/** All known apps; providers from API may be a subset. */
export function getAllIntegrationApps(): IntegrationAppMeta[] {
  return appMeta;
}

/** Apps that are available from the API (providers), in display order. Unknown providers get a fallback meta. */
export function getAppsForProviders(providerIds: string[]): IntegrationAppMeta[] {
  const seen = new Set<string>();
  const result: IntegrationAppMeta[] = [];
  for (const meta of appMeta) {
    if (providerIds.includes(meta.id) && !seen.has(meta.id)) {
      seen.add(meta.id);
      result.push(meta);
    }
  }
  for (const id of providerIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const name = id.charAt(0).toUpperCase() + id.slice(1);
    result.push({
      id,
      name,
      description: `Connect ${name}`,
      category: "productivity",
      icon: BookOpen,
    });
  }
  return result;
}
