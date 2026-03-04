import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import type { Config } from '../types.js';
import { isSkillEnabled } from './skills-config.js';

export type SkillStatus = 'eligible' | 'blocked' | 'unknown';

export type Skill = {
  name: string;
  description: string;
  filePath: string;
  /** Filename without .md, used for install/uninstall. */
  slug?: string;
  status: SkillStatus;
  category?: string;
  version?: string;
  tags?: string[];
  missing?: string[];
  bins?: string[];
  /** Required env vars from metadata sulala.requires.env (e.g. BSKY_HANDLE, BSKY_APP_PASSWORD). */
  env?: string[];
  source?: 'user' | 'workspace' | 'managed' | 'bundled' | 'plugin' | 'extra';
};

function parseFrontmatter(
  content: string
): { name?: string; description?: string; metadata?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return {};

  const block = match[1];
  let name: string | undefined;
  let description: string | undefined;
  let metadataRaw: string | undefined;
  let inMetadata = false;
  const metaLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
      inMetadata = false;
      continue;
    }
    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) {
      description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
      inMetadata = false;
      continue;
    }
    const metaStart = line.match(/^metadata:\s*$/);
    if (metaStart) {
      inMetadata = true;
      continue;
    }
    const metaInline = line.match(/^metadata:\s*(.*)$/);
    if (metaInline) {
      inMetadata = true;
      if (metaInline[1].trim()) metaLines.push(metaInline[1]);
      continue;
    }
    if (inMetadata) {
      metaLines.push(line);
    }
  }
  if (metaLines.length) {
    metadataRaw = metaLines.join('\n').trim();
  }
  return { name, description, metadata: metadataRaw };
}

export function validateSkillContent(content: string): {
  valid: boolean;
  name?: string;
  description?: string;
  bins?: string[];
  errors: string[];
} {
  const errors: string[] = [];
  const { name, description, metadata } = parseFrontmatter(content);
  if (!name?.trim()) errors.push('Missing or empty name');
  if (!description?.trim()) errors.push('Missing or empty description');
  const bins = extractRequiredBins(metadata);
  return {
    valid: errors.length === 0,
    name: name?.trim(),
    description: description?.trim(),
    bins: bins.length ? bins : undefined,
    errors,
  };
}

function extractRequiredBins(metadataRaw: string | undefined): string[] {
  if (!metadataRaw) return [];
  try {
    const jsonStr = metadataRaw.replace(/^\s+/gm, ' ').replace(/\s+/g, ' ');
    const parsed = JSON.parse(jsonStr) as { sulala?: { requires?: { bins?: string[] } } };
    return (parsed?.sulala?.requires?.bins || []) as string[];
  } catch {
    const m = metadataRaw.match(/"bins"\s*:\s*\[([^\]]*)\]/);
    if (!m) return [];
    const inner = m[1];
    return inner
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
}

function extractMetadataExtras(metadataRaw: string | undefined): { category?: string; version?: string; tags?: string[] } {
  if (!metadataRaw) return {};
  try {
    const jsonStr = metadataRaw.replace(/^\s+/gm, ' ').replace(/\s+/g, ' ');
    const parsed = JSON.parse(jsonStr) as { sulala?: { category?: string; version?: string; tags?: string[] } };
    const s = parsed?.sulala;
    if (!s) return {};
    return {
      ...(s.category && typeof s.category === 'string' ? { category: s.category } : {}),
      ...(s.version && typeof s.version === 'string' ? { version: s.version } : {}),
      ...(Array.isArray(s.tags) ? { tags: s.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0) } : {}),
    };
  } catch {
    return {};
  }
}

function extractRequiredEnv(metadataRaw: string | undefined): string[] {
  if (!metadataRaw) return [];
  try {
    const jsonStr = metadataRaw.replace(/^\s+/gm, ' ').replace(/\s+/g, ' ');
    const parsed = JSON.parse(jsonStr) as { sulala?: { requires?: { env?: string[] } } };
    const env = parsed?.sulala?.requires?.env;
    return Array.isArray(env) ? env.filter((e): e is string => typeof e === 'string' && e.trim().length > 0) : [];
  } catch {
    const m = metadataRaw.match(/"env"\s*:\s*\[([^\]]*)\]/);
    if (!m) return [];
    const inner = m[1];
    return inner
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
}

function binAvailable(bin: string): boolean {
  const allowed = (process.env.ALLOWED_BINARIES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.includes(bin.toLowerCase())) return true;
  const r = spawnSync('which', [bin], { encoding: 'utf8' });
  return r.status === 0 && !!r.stdout?.trim();
}

/** Collect all required bins from enabled skills (for auto-merge with ALLOWED_BINARIES). */
export function getAllRequiredBins(config: Config): string[] {
  const skills = listSkills(config);
  const bins = new Set<string>();
  for (const s of skills) {
    for (const b of s.bins || []) {
      if (b?.trim()) bins.add(b.trim().toLowerCase());
    }
  }
  return [...bins];
}

/** Paths in precedence order: user (workspace skills) > workspace (agentContextPath) > managed > bundled > extra. */
export function getSkillPaths(config: Config): { path: string; source: Skill['source']; isWorkspaceDir?: boolean }[] {
  const out: { path: string; source: Skill['source']; isWorkspaceDir?: boolean }[] = [];
  const cwd = process.cwd();

  // User skills: ~/.sulala/workspace/skills/<skill-name>/SKILL.md — safe from project updates
  out.push({ path: config.skillsWorkspaceDir, source: 'user', isWorkspaceDir: true });
  if (config.agentContextPath?.trim()) {
    out.push({
      path: resolve(cwd, config.agentContextPath.trim()),
      source: 'workspace',
    });
  }
  out.push({ path: config.skillsManagedDir, source: 'managed' });
  out.push({ path: config.skillsBundledDir, source: 'bundled' });
  for (const p of config.skillsPluginDirs) {
    out.push({ path: p, source: 'plugin' });
  }
  for (const p of config.skillsExtraDirs) {
    out.push({ path: resolve(cwd, p), source: 'extra' });
  }
  return out;
}

/** Scan workspace skills dir: <base>/<skill-name>/SKILL.md (directory-per-skill). */
function scanWorkspaceDirForSkills(
  base: string,
  source: Skill['source']
): Array<Skill & { name: string }> {
  if (!existsSync(base)) return [];
  const skills: Array<Skill & { name: string }> = [];
  try {
    const stat = statSync(base);
    if (!stat.isDirectory()) return [];
    const subdirs = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
    for (const subdir of subdirs) {
      const skillPath = join(base, subdir, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      const fullPath = skillPath;
      try {
        const raw = readFileSync(fullPath, 'utf8');
        const { name, description, metadata } = parseFrontmatter(raw);
        if (!name || !description) continue;

        const bins = extractRequiredBins(metadata);
        const env = extractRequiredEnv(metadata);
        const extras = extractMetadataExtras(metadata);
        const missing: string[] = [];
        for (const b of bins) {
          if (!binAvailable(b)) missing.push(b);
        }
        const status: SkillStatus =
          bins.length === 0 ? 'unknown' : missing.length === 0 ? 'eligible' : 'blocked';

        const slug = subdir;
        skills.push({
          name,
          description,
          filePath: fullPath,
          slug,
          status,
          source,
          ...(extras.category ? { category: extras.category } : {}),
          ...(extras.version ? { version: extras.version } : {}),
          ...(extras.tags?.length ? { tags: extras.tags } : {}),
          bins: bins.length ? bins : undefined,
          env: env.length ? env : undefined,
          ...(missing.length ? { missing } : {}),
        });
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
  return skills;
}

function scanDirForSkills(
  base: string,
  source: Skill['source']
): Array<Skill & { name: string }> {
  if (!existsSync(base)) return [];
  const skills: Array<Skill & { name: string }> = [];
  try {
    const stat = statSync(base);
    const files: { path: string; name: string }[] = [];
    if (stat.isFile() && (base.endsWith('.md') || base.endsWith('.txt'))) {
      files.push({ path: base, name: base.split(/[/\\]/).pop() || '' });
    } else if (stat.isDirectory()) {
      const names = readdirSync(base).sort();
      for (const n of names) {
        if (!n.endsWith('.md') && !n.endsWith('.txt')) continue;
        files.push({ path: join(base, n), name: n });
      }
    }

    for (const { path: fullPath, name: fileName } of files) {
      if (!fileName.endsWith('.md')) continue;
      try {
        const raw = readFileSync(fullPath, 'utf8');
        const { name, description, metadata } = parseFrontmatter(raw);
        if (!name || !description) continue;

        const bins = extractRequiredBins(metadata);
        const env = extractRequiredEnv(metadata);
        const extras = extractMetadataExtras(metadata);
        const missing: string[] = [];
        for (const b of bins) {
          if (!binAvailable(b)) missing.push(b);
        }
        const status: SkillStatus =
          bins.length === 0 ? 'unknown' : missing.length === 0 ? 'eligible' : 'blocked';

        const slug = fileName.replace(/\.md$/, '');
        skills.push({
          name,
          description,
          filePath: fullPath,
          slug,
          status,
          source,
          ...(extras.category ? { category: extras.category } : {}),
          ...(extras.version ? { version: extras.version } : {}),
          ...(extras.tags?.length ? { tags: extras.tags } : {}),
          bins: bins.length ? bins : undefined,
          env: env.length ? env : undefined,
          ...(missing.length ? { missing } : {}),
        });
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
  return skills;
}

/** List skills from all paths with precedence: user > workspace > managed > bundled > extra. Deduped by slug. By default filtered by skills.entries.<slug>.enabled; set includeDisabled true to return all (e.g. for dashboard). */
export function listSkills(config: Config, options?: { includeDisabled?: boolean }): Skill[] {
  const paths = getSkillPaths(config);
  const bySlug = new Map<string, Skill>();
  for (const { path: p, source, isWorkspaceDir } of paths) {
    const scanned = isWorkspaceDir ? scanWorkspaceDirForSkills(p, source) : scanDirForSkills(p, source);
    for (const s of scanned) {
      const slug = s.slug ?? s.filePath.split(/[/\\]/).pop()?.replace(/\.md$/, '') ?? s.name;
      if (!bySlug.has(slug)) {
        if (options?.includeDisabled || isSkillEnabled(slug)) {
          bySlug.set(slug, { ...s, slug });
        }
      }
    }
  }
  return Array.from(bySlug.values()).sort((a, b) => a.name.localeCompare(b.name));
}
