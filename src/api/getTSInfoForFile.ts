import path from 'node:path';
import ts from 'typescript/lib/tsserverlibrary';
import { findLoadedDefaultProjectForFile } from './typescript/findLoadedDefaultProjectForFile';
import { getPluginsFromCompilerOptions } from './typescript/getPluginsFromCompilerOptions';
import { projectService } from './typescript/projectService';

type TSInfo = {
  tsconfigPath: string;
  pluginEnabled: boolean;
};

const toTSInfo = (compilerOptions: ts.CompilerOptions): TSInfo => ({
  tsconfigPath: (compilerOptions.configFilePath as string) ?? '[not found]',
  pluginEnabled: isPluginEnabled(compilerOptions),
});

export const getTSInfoForFile = (filePath: string): TSInfo => {
  const file = ts.server.toNormalizedPath(path.resolve(process.cwd(), filePath));

  const loadedProject = findLoadedDefaultProjectForFile(file);
  if (loadedProject) return toTSInfo(loadedProject.getCompilerOptions());

  projectService.openClientFile(file);

  const tsInfo = toTSInfo(
    projectService.getDefaultProjectForFile(file, true)?.getCompilerOptions() ?? {},
  );

  projectService.closeClientFile(file);
  return tsInfo;
};

export const isPluginEnabled = (compilerOptions: ts.CompilerOptions): boolean =>
  getPluginsFromCompilerOptions(compilerOptions).some(({ name }) => name === 'ts-migrating');
