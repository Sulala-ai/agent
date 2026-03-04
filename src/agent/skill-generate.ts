/**
 * Skill Wizard: generate a skill spec from goal + app + trigger (no LLM).
 * Used by POST /api/agent/skills/generate. Credential-agnostic: requiredEnv
 * can be satisfied by API key now or connectionId later.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Config } from '../types.js';
import { loadSkillsConfig, saveSkillsConfig } from './skills-config.js';
import type { SkillEntry } from './skills-config.js';

export const WIZARD_APPS = [
  { id: 'gmail', label: 'Gmail', envHint: 'GMAIL_API_KEY or connect later' },
  { id: 'slack', label: 'Slack', envHint: 'SLACK_BOT_TOKEN or connect later' },
  { id: 'notion', label: 'Notion', envHint: 'NOTION_API_KEY or connect later' },
  { id: 'github', label: 'GitHub', envHint: 'GITHUB_TOKEN or connect later' },
  { id: 'calendar', label: 'Google Calendar', envHint: 'GOOGLE_CALENDAR_CREDENTIALS or connect later' },
  { id: 'webhook', label: 'Webhook', envHint: 'Optional' },
  { id: 'other', label: 'Other', envHint: 'Depends on skill' },
] as const;

export const WIZARD_TRIGGERS = [
  { id: 'manual', label: 'When I ask (manual)' },
  { id: 'schedule', label: 'On a schedule (cron)' },
  { id: 'webhook', label: 'When a webhook is called' },
  { id: 'message', label: 'When I send a message (e.g. Telegram)' },
] as const;

export type SkillSpec = {
  name: string;
  description: string;
  slug: string;
  frontmatter: string;
  body: string;
  requiredEnv: string[];
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'skill';
}

function envForApp(appId: string): string[] {
  switch (appId) {
    case 'gmail':
      return ['GMAIL_API_KEY'];
    case 'slack':
      return ['SLACK_BOT_TOKEN'];
    case 'notion':
      return ['NOTION_API_KEY'];
    case 'github':
      return ['GITHUB_TOKEN'];
    case 'calendar':
      return ['GOOGLE_CALENDAR_CREDENTIALS'];
    case 'webhook':
      return [];
    default:
      return [];
  }
}

function defaultNameForApp(appId: string): string {
  const t = WIZARD_APPS.find((a) => a.id === appId);
  return t ? t.label : 'Custom';
}

/**
 * Generate a skill spec from wizard answers. No LLM; deterministic.
 */
export function generateSkillSpec(goal: string, appId: string, triggerId: string): SkillSpec {
  const trimmedGoal = (goal || '').trim();
  const name = trimmedGoal
    ? `${trimmedGoal.slice(0, 50)}${trimmedGoal.length > 50 ? '…' : ''}`
    : defaultNameForApp(appId);
  const slug = slugify(name || appId || 'skill');
  const description = trimmedGoal
    ? trimmedGoal
    : `Skill connected to ${defaultNameForApp(appId)}. Configure trigger and credentials in Settings.`;
  const requiredEnv = envForApp(appId);

  const metadata: Record<string, unknown> = {
    sulala: {
      category: 'integration',
      version: '1.0.0',
      tags: [appId, triggerId],
      requires: requiredEnv.length ? { env: requiredEnv } : {},
    },
  };
  const metadataBlock = JSON.stringify(metadata, null, 2)
    .split('\n')
    .map((line) => '  ' + line)
    .join('\n');
  const frontmatter = `---
name: ${name.replace(/\n/g, ' ')}
description: ${description.replace(/\n/g, ' ').slice(0, 200)}
metadata:
${metadataBlock}
---

`;

  const body = `# ${name}

${description}

## Setup

${requiredEnv.length ? `Add these to the skill config (Skills → this skill):\n- ${requiredEnv.join('\n- ')}` : 'No required env. Configure webhook or schedule in Jobs if needed.'}

## Trigger

This skill is set to run: **${WIZARD_TRIGGERS.find((t) => t.id === triggerId)?.label ?? triggerId}**.
`;

  return {
    name,
    description,
    slug,
    frontmatter,
    body,
    requiredEnv,
  };
}

/** Empty tools.yaml template: user can add tool definitions here. Loader expects `tools:` array. */
const EMPTY_TOOLS_YAML = `# Optional: add tool definitions for this skill.
# Schema: tools[].name, description, profile, auth, request (method, url, queryParams, bodyType, bodyKeys), parameters, response.
# See docs/tool-spec-format.md or context/<name>/tools.yaml examples.
tools: []
`;

/**
 * Write README.md and empty tools.yaml to "created by me" dir and add config entry. Uses config.skillsWorkspaceMyDir.
 */
export function writeGeneratedSkill(config: Config, spec: SkillSpec): { path: string; slug: string } {
  const dir = join(config.skillsWorkspaceMyDir, spec.slug);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'README.md');
  const content = spec.frontmatter + spec.body;
  writeFileSync(filePath, content, 'utf8');
  writeFileSync(join(dir, 'tools.yaml'), EMPTY_TOOLS_YAML, 'utf8');

  const cfg = loadSkillsConfig();
  if (!cfg.entries) cfg.entries = {};
  const entry: SkillEntry = { enabled: true };
  for (const key of spec.requiredEnv) {
    (entry as Record<string, string>)[key] = '';
  }
  cfg.entries[spec.slug] = entry;
  saveSkillsConfig(cfg);

  return { path: filePath, slug: spec.slug };
}
