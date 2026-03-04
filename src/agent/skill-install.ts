import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const registryPath = join(projectRoot, 'registry', 'skills-registry.json');

export type RegistrySkill = {
  slug: string;
  name: string;
  description: string;
  url?: string;
  version?: string;
};

export type RegistryIndex = {
  skills: RegistrySkill[];
};

const DEFAULT_HUB_BASE =  'http://localhost:3002';

function getRegistryUrl(overrideUrl?: string): string | null {
  const explicit = overrideUrl?.trim() || process.env.SKILLS_REGISTRY_URL?.trim();
  if (explicit) return explicit;
  const hubBase = process.env.SULALAHUB_BASE_URL?.trim() || DEFAULT_HUB_BASE;
  return `${hubBase.replace(/\/$/, '')}/api/sulalahub/registry`;
}

export async function getRegistrySkills(overrideUrl?: string): Promise<RegistrySkill[]> {
  const url = getRegistryUrl(overrideUrl);
  if (!url) return getRegistrySkillsLocal();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as RegistryIndex;
    return data.skills || [];
  } catch {
    return getRegistrySkillsLocal();
  }
}

export function getRegistrySkillsLocal(): RegistrySkill[] {
  if (!existsSync(registryPath)) return [];
  try {
    const data = JSON.parse(readFileSync(registryPath, 'utf8')) as RegistryIndex;
    return data.skills || [];
  } catch {
    return [];
  }
}

function getRegistryContentPath(slug: string): string {
  return join(projectRoot, 'registry', `${slug}.md`);
}

function getInstalledVersionsPath(): string {
  const base = process.env.SULALA_SKILLS_DIR || join(homedir(), '.sulala', 'skills');
  return join(dirname(base), 'installed-versions.json');
}

type InstalledVersions = Record<string, { version?: string; target: InstallTarget }>;

function loadInstalledVersions(): InstalledVersions {
  const path = getInstalledVersionsPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as InstalledVersions;
  } catch {
    return {};
  }
}

function saveInstalledVersions(data: InstalledVersions): void {
  const path = getInstalledVersionsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

/** Compare semver strings; returns -1 if a < b, 0 if equal, 1 if a > b. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

function getManagedDir(): string {
  return process.env.SULALA_SKILLS_DIR || join(homedir(), '.sulala', 'skills');
}

/** Workspace skills dir: ~/.sulala/workspace/skills/<skill-name>/SKILL.md. Used for installs (safe from project updates). */
function getWorkspaceSkillsDir(): string {
  return (
    process.env.SULALA_WORKSPACE_SKILLS_DIR ||
    join(homedir(), '.sulala', 'workspace', 'skills')
  );
}

function getWorkspaceDir(): string {
  const cwd = process.cwd();
  const path = process.env.AGENT_CONTEXT_PATH || 'context';
  return join(cwd, path.trim());
}

export type InstallTarget = 'managed' | 'workspace';

export type InstallSkillOptions = { registryUrl?: string };

export async function installSkill(
  slug: string,
  target: InstallTarget,
  opts?: InstallSkillOptions
): Promise<{ success: boolean; path: string; error?: string }> {
  const skills = await getRegistrySkills(opts?.registryUrl);
  const entry = skills.find((s) => s.slug === slug);
  if (!entry) {
    return { success: false, path: '', error: `Skill not found: ${slug}` };
  }

  let content: string;
  if (entry.url) {
    try {
      const res = await fetch(entry.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      content = await res.text();
    } catch (e) {
      return {
        success: false,
        path: '',
        error: `Failed to fetch ${entry.url}: ${(e as Error).message}`,
      };
    }
  } else {
    const localPath = getRegistryContentPath(slug);
    if (!existsSync(localPath)) {
      return { success: false, path: '', error: `Registry content missing: ${localPath}` };
    }
    content = readFileSync(localPath, 'utf8');
  }

  const dir = target === 'managed' ? getWorkspaceSkillsDir() : getWorkspaceDir();
  const destPath =
    target === 'managed'
      ? join(dir, slug, 'SKILL.md')
      : join(dir, `${slug}.md`);
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, content, 'utf8');
  if (entry.version) {
    const versions = loadInstalledVersions();
    versions[slug] = { version: entry.version, target };
    saveInstalledVersions(versions);
  }
  return { success: true, path: destPath };
}

/**
 * Install a skill from a direct content URL (e.g. store install URL with ?license=... for paid skills).
 * Slug is derived from the path: .../skills/<slug> or .../skills/<slug>?...
 */
export async function installSkillFromUrl(
  skillContentUrl: string,
  target: InstallTarget
): Promise<{ success: boolean; path: string; slug?: string; error?: string }> {
  let url: URL;
  try {
    url = new URL(skillContentUrl.trim());
  } catch {
    return { success: false, path: '', error: 'Invalid URL' };
  }
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const slug = pathSegments[pathSegments.length - 1];
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return { success: false, path: '', error: `Could not derive slug from URL path: ${url.pathname}` };
  }
  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const content = await res.text();
    const dir = target === 'managed' ? getWorkspaceSkillsDir() : getWorkspaceDir();
    const destPath =
      target === 'managed'
        ? join(dir, slug, 'SKILL.md')
        : join(dir, `${slug}.md`);
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, content, 'utf8');
    return { success: true, path: destPath, slug };
  } catch (e) {
    return {
      success: false,
      path: '',
      error: `Failed to fetch ${url.toString()}: ${(e as Error).message}`,
    };
  }
}

export function uninstallSkill(
  slug: string,
  target: InstallTarget
): { success: boolean; path: string; error?: string } {
  const dir = target === 'managed' ? getWorkspaceSkillsDir() : getWorkspaceDir();
  const filePath =
    target === 'managed' ? join(dir, slug, 'SKILL.md') : join(dir, `${slug}.md`);
  if (!existsSync(filePath)) {
    return { success: false, path: '', error: `Skill not installed: ${slug}` };
  }
  try {
    unlinkSync(filePath);
    const versions = loadInstalledVersions();
    delete versions[slug];
    saveInstalledVersions(versions);
    return { success: true, path: filePath };
  } catch (e) {
    return {
      success: false,
      path: '',
      error: `Failed to remove ${filePath}: ${(e as Error).message}`,
    };
  }
}

/** Get installed skills as { slug, target } where target is where the file lives. */
function getInstalledSkills(): { slug: string; target: InstallTarget }[] {
  const seen = new Set<string>();
  const out: { slug: string; target: InstallTarget }[] = [];
  const workspaceSkills = getWorkspaceSkillsDir();
  const managedLegacy = getManagedDir();
  const workspace = getWorkspaceDir();
  // Managed (workspace dir): ~/.sulala/workspace/skills/<slug>/SKILL.md
  if (existsSync(workspaceSkills)) {
    try {
      for (const n of readdirSync(workspaceSkills, { withFileTypes: true })) {
        if (!n.isDirectory() || n.name.startsWith('.')) continue;
        const skillPath = join(workspaceSkills, n.name, 'SKILL.md');
        if (!existsSync(skillPath)) continue;
        const slug = n.name;
        if (!seen.has(slug)) {
          seen.add(slug);
          out.push({ slug, target: 'managed' });
        }
      }
    } catch {
      // skip
    }
  }
  // Legacy managed: ~/.sulala/skills/<slug>.md
  if (existsSync(managedLegacy)) {
    try {
      for (const n of readdirSync(managedLegacy)) {
        if (!n.endsWith('.md')) continue;
        const slug = n.replace(/\.md$/, '');
        if (seen.has(slug)) continue;
        seen.add(slug);
        out.push({ slug, target: 'managed' });
      }
    } catch {
      // skip
    }
  }
  // Workspace (project): AGENT_CONTEXT_PATH/<slug>.md
  if (existsSync(workspace)) {
    try {
      for (const n of readdirSync(workspace)) {
        if (!n.endsWith('.md')) continue;
        const slug = n.replace(/\.md$/, '');
        if (seen.has(slug)) continue;
        seen.add(slug);
        out.push({ slug, target: 'workspace' });
      }
    } catch {
      // skip
    }
  }
  return out;
}

export async function updateSkillsAll(): Promise<
  { updated: string[]; failed: { slug: string; error: string }[] }
> {
  const installed = getInstalledSkills();
  const registry = await getRegistrySkills();
  const bySlug = new Map(registry.map((s) => [s.slug, s]));
  const updated: string[] = [];
  const failed: { slug: string; error: string }[] = [];
  for (const { slug, target } of installed) {
    if (!bySlug.has(slug)) continue;
    const result = await installSkill(slug, target);
    if (result.success) updated.push(slug);
    else failed.push({ slug, error: result.error || 'unknown' });
  }
  return { updated, failed };
}

export type SkillUpdateInfo = {
  slug: string;
  installedVersion?: string;
  registryVersion?: string;
  updateAvailable: boolean;
};

export async function getAvailableUpdates(): Promise<SkillUpdateInfo[]> {
  const installed = getInstalledSkills();
  const versions = loadInstalledVersions();
  const registry = await getRegistrySkills();
  const bySlug = new Map(registry.map((s) => [s.slug, s]));
  const out: SkillUpdateInfo[] = [];
  for (const { slug } of installed) {
    const reg = bySlug.get(slug);
    const inst = versions[slug];
    const instVer = inst?.version;
    const regVer = reg?.version;
    if (!regVer) continue;
    const updateAvailable = !instVer || compareVersions(instVer, regVer) < 0;
    out.push({
      slug,
      installedVersion: instVer,
      registryVersion: regVer,
      updateAvailable,
    });
  }
  return out.filter((u) => u.updateAvailable);
}
