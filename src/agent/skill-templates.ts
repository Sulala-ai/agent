/**
 * Template manifests: which registry skills are "templates" and which fields to show in the quick-setup form.
 * A template is the same as a skill; we only define the minimal required inputs for one-click install.
 */
import type { RegistrySkill } from './skill-install.js';

export type TemplateManifest = {
  slug: string;
  requiredFields: string[];
};

/** Slugs that are offered as templates, and the only config fields we ask for in the "Use template" form. */
const TEMPLATE_MANIFESTS: Record<string, { requiredFields: string[] }> = {
  weather: { requiredFields: [] },
  bluesky: { requiredFields: ['handle', 'apiKey'] },
  news: { requiredFields: ['apiKey'] },
  files: { requiredFields: [] },
  git: { requiredFields: [] },
  'apple-notes': { requiredFields: [] },
};

export type SkillTemplate = RegistrySkill & { requiredFields: string[] };

/**
 * Return registry skills that have a template manifest, with requiredFields attached.
 */
export function getTemplates(registrySkills: RegistrySkill[]): SkillTemplate[] {
  const out: SkillTemplate[] = [];
  for (const s of registrySkills) {
    const manifest = TEMPLATE_MANIFESTS[s.slug];
    if (!manifest) continue;
    out.push({
      ...s,
      requiredFields: manifest.requiredFields,
    });
  }
  return out;
}
