import chokidar, { type FSWatcher } from 'chokidar';
import { existsSync } from 'fs';
import { getSkillPaths } from './skills.js';
import type { Config } from '../types.js';

let watcher: FSWatcher | null = null;

export function startSkillsWatcher(
  config: Config,
  onChanged: (event: { type: 'skills_changed'; ts: number }) => void
): FSWatcher | null {
  if (!config.skillsWatch) return null;
  if (watcher) return watcher;
  const paths = getSkillPaths(config).map((p) => p.path);
  const dirs = paths.filter((p) => existsSync(p));
  if (dirs.length === 0) return null;
  const debounceMs = 250;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChanged({ type: 'skills_changed', ts: Date.now() });
    }, debounceMs);
  };
  watcher = chokidar.watch(dirs, {
    ignoreInitial: true,
    depth: 2,
    ignored: (p) => !/\.(md|txt|yaml|yml)$/.test(p),
  });
  watcher.on('add', fire).on('change', fire).on('unlink', fire);
  return watcher;
}
