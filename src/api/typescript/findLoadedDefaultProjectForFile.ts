import path from 'node:path';
import ts from 'typescript/lib/tsserverlibrary';
import { projectService } from './projectService';

// directory -> nearest tsconfig.json / jsconfig.json (undefined if there is none)
const nearestConfigByDirectory = new Map<string, string | undefined>();

/**
 * Mirrors the project service's own lookup: walk up from the file's directory,
 * preferring `tsconfig.json` over `jsconfig.json` in each directory, and stop
 * after a `node_modules` directory.
 */
const findNearestConfigFile = (directory: string): string | undefined => {
  if (nearestConfigByDirectory.has(directory)) return nearestConfigByDirectory.get(directory);

  const configFile = (() => {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const candidate = path.join(directory, name);
      if (ts.sys.fileExists(candidate)) return candidate;
    }
    const parent = path.dirname(directory);
    if (parent === directory || path.basename(directory) === 'node_modules') return undefined;
    return findNearestConfigFile(parent);
  })();

  nearestConfigByDirectory.set(directory, configFile);
  return configFile;
};

/**
 * Returns the file's default project *without* opening the file, when that can
 * be decided cheaply: the nearest tsconfig's project is already loaded and the
 * file is one of its root files. That is exactly the project the project
 * service would pick after `openClientFile`.
 *
 * Returns `undefined` otherwise (project not loaded yet, solution-style
 * configs, files pulled in only via references/imports, …), and the caller
 * should fall back to `openClientFile`.
 *
 * This matters for large repos: every `openClientFile` runs the project
 * service's orphan cleanup, which scans every script info in memory, so
 * opening each file in turn is quadratic in the number of files.
 */
export const findLoadedDefaultProjectForFile = (
  file: ts.server.NormalizedPath,
): ts.server.ConfiguredProject | undefined => {
  const scriptInfo = projectService.getScriptInfoForNormalizedPath(file);
  if (!scriptInfo) return undefined;

  const configFile = findNearestConfigFile(path.dirname(file));
  if (configFile === undefined) return undefined;
  const normalizedConfigFile = ts.server.toNormalizedPath(configFile);

  for (const project of projectService.configuredProjects.values()) {
    if (project.isClosed()) continue;
    if (project.getConfigFilePath() !== normalizedConfigFile) continue;
    if (!project.isRoot(scriptInfo)) return undefined;
    // internal API; the project service skips such files when picking a default
    const isRedirect = (
      project as unknown as { isSourceOfProjectReferenceRedirect?: (p: ts.Path) => boolean }
    ).isSourceOfProjectReferenceRedirect?.(scriptInfo.path);
    return isRedirect ? undefined : project;
  }
  return undefined;
};
