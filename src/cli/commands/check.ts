import process from 'node:process';
import { getAnnotateCommand } from '../annotateCommand';
import { type ReporterName, reporters } from '../reporters/mod';

export const check = (
  {
    verbose,
    allTypeErrors,
    reporter,
    annotateCommand,
  }: {
    verbose: boolean;
    allTypeErrors: boolean;
    reporter: ReporterName;
    annotateCommand?: string;
  },
  ...inputPaths: string[]
): void => {
  const { unmarkedTsMigratingErrorCount, baselineErrorCount } = reporters[reporter](
    {
      verbose,
      allTypeErrors,
      annotateCommand: getAnnotateCommand({
        override: annotateCommand,
        userAgent: process.env.npm_config_user_agent,
        inputPaths,
      }),
    },
    ...inputPaths,
  );

  // The check fails when there are unmarked ts-migrating errors; with
  // `--all-type-errors`, pre-existing (baseline) errors fail too. Marked debt
  // never fails. We set `process.exitCode` rather than calling `process.exit()`
  // so a large JSON/NDJSON report on stdout flushes fully before the process
  // exits naturally.
  process.exitCode =
    unmarkedTsMigratingErrorCount > 0 || (allTypeErrors && baselineErrorCount > 0) ? 1 : 0;
};
