#!/usr/bin/env node
import process from 'node:process';
import { buildApplication, buildCommand, buildRouteMap, run } from '@stricli/core';
import packageJSON from '../../package.json' with { type: 'json' };
import { ANNOTATE_WARNING } from './constants/annotate-warning';
import { applyMaxOldSpaceSize } from './maxOldSpaceSize';

// Honour a `--max-old-space-size` flag by re-exec'ing node with it before any
// heavy work; returns the remaining args (with the flag removed) to parse.
const args = applyMaxOldSpaceSize();

(async () => {
  await run(
    buildApplication(
      buildRouteMap({
        routes: {
          check: buildCommand({
            loader: async () => (await import('./commands/check')).check,
            parameters: {
              flags: {
                verbose: {
                  kind: 'boolean',
                  brief: 'Enable verbose logging.',
                  default: false,
                },
                allTypeErrors: {
                  kind: 'boolean',
                  brief:
                    'Display all type errors. By default, this command only show [ts-migrating] errors, which are type errors introduced by the new tsconfig.',
                  default: false,
                },
                reporter: {
                  kind: 'enum',
                  values: ['pretty', 'json', 'ndjson'],
                  brief:
                    'Output format. "pretty" (default) prints human-readable diagnostics with colour and context; "json" prints a flat JSON array of every diagnostic (origin + @ts-migrating directive info) for CI gates / dashboards; "ndjson" streams the same records one JSON object per line for large repos.',
                  default: 'pretty',
                },
                annotateCommand: {
                  kind: 'parsed',
                  parse: String,
                  optional: true,
                  placeholder: 'command',
                  brief:
                    'Command suggested for marking unmarked errors, e.g. "yarn typecheck:annotate". Defaults to the package manager that ran this CLI (yarn, pnpm, bun or npx), followed by the checked paths.',
                },
              },
              aliases: {
                v: 'verbose',
                a: 'allTypeErrors',
                r: 'reporter',
              },
              positional: {
                kind: 'array',
                parameter: {
                  placeholder: 'path',
                  brief: 'File / Directories Paths or Globs',
                  parse: String,
                },
              },
            },
            docs: {
              brief: 'Run `@ts-migrating`-aware type checks.',
              customUsage: ['path/to/file1.ts path/to/directory glob/**/example/*'],
            },
          }),
          annotate: buildCommand({
            loader: async () => (await import('./commands/annotate')).annotate,
            parameters: {
              flags: {
                verbose: {
                  kind: 'boolean',
                  brief: 'Enable verbose logging.',
                  default: false,
                },
                detail: {
                  kind: 'enum',
                  values: ['none', 'rule', 'error', 'both'],
                  brief:
                    'Extra context to embed in each inserted @ts-migrating annotation: "rule" appends the TypeScript error code (e.g. @ts-migrating TS7006); "error" appends the error message; "both" appends both; "none" (default) inserts just @ts-migrating.',
                  default: 'none',
                },
                keepStale: {
                  kind: 'boolean',
                  brief:
                    'Keep stale @ts-migrating directives (ones whose next line no longer has an error introduced by the new tsconfig). By default they are removed.',
                  default: false,
                },
              },
              aliases: {
                v: 'verbose',
                d: 'detail',
              },
              positional: {
                kind: 'array',
                parameter: {
                  placeholder: 'path',
                  brief: 'File / Directories Paths or Globs',
                  parse: String,
                },
              },
            },
            docs: {
              brief:
                'Annotate all errors introduced by the new config with @ts-migrating, and remove stale directives',
              fullDescription: `Annotate all errors introduced by the new config with @ts-migrating, and remove @ts-migrating directives that no longer mark such an error (unless --keep-stale is passed).

${ANNOTATE_WARNING}`,
            },
          }),
          info: buildCommand({
            func: (await import('./commands/info')).info,
            parameters: {
              positional: {
                kind: 'array',
                parameter: {
                  placeholder: 'path',
                  brief: 'File / Directories Paths or Globs',
                  parse: String,
                },
              },
            },
            docs: {
              brief: 'Show some debug info that might be useful.',
            },
          }),
        },
        docs: {
          brief: '@ts-migrating CLI',
        },
      }),
      {
        name: packageJSON.name,
        // Accept `--all-type-errors` as well as `--allTypeErrors`.
        scanner: { caseStyle: 'allow-kebab-for-camel' },
        versionInfo: {
          currentVersion: packageJSON.version,
        },
      },
    ),
    args,
    { process },
  );
})();
