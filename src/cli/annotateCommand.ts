/**
 * The command `check` suggests for fixing unmarked errors.
 *
 * - An explicit `--annotate-command` always wins, so a consumer can point at
 *   their own script (e.g. `yarn typecheck:annotate`).
 * - Otherwise we match the package manager that launched us, read from
 *   `npm_config_user_agent` (set by npm, yarn, pnpm and bun when running a
 *   package.json script or a bin), and append the paths `check` was given so
 *   the suggestion annotates exactly what was checked.
 */
export const getAnnotateCommand = ({
  override,
  userAgent,
  inputPaths,
}: {
  override: string | undefined;
  userAgent: string | undefined;
  inputPaths: readonly string[];
}): string => {
  if (override !== undefined && override.trim() !== '') return override;

  const runner = (() => {
    if (userAgent?.startsWith('yarn/')) return 'yarn ts-migrating';
    if (userAgent?.startsWith('pnpm/')) return 'pnpm exec ts-migrating';
    if (userAgent?.startsWith('bun/')) return 'bunx ts-migrating';
    return 'npx ts-migrating';
  })();

  return [runner, 'annotate', ...inputPaths].join(' ');
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe('getAnnotateCommand', () => {
    const base = { override: undefined, userAgent: undefined, inputPaths: [] };

    it('defaults to npx when the package manager is unknown', () => {
      expect(getAnnotateCommand(base)).toBe('npx ts-migrating annotate');
    });

    it.each([
      ['yarn/1.22.22 npm/? node/v24.21.0 darwin arm64', 'yarn ts-migrating annotate'],
      ['yarn/4.9.1 npm/? node/v24.21.0 darwin arm64', 'yarn ts-migrating annotate'],
      ['pnpm/10.28.0 npm/? node/v24.21.0 darwin arm64', 'pnpm exec ts-migrating annotate'],
      ['bun/1.2.0 npm/? node/v24.21.0 darwin arm64', 'bunx ts-migrating annotate'],
      ['npm/11.0.0 node/v24.21.0 darwin arm64 workspaces/false', 'npx ts-migrating annotate'],
    ])('matches the package manager from %s', (userAgent, expected) => {
      expect(getAnnotateCommand({ ...base, userAgent })).toBe(expected);
    });

    it('appends the checked paths', () => {
      expect(
        getAnnotateCommand({
          ...base,
          userAgent: 'yarn/4.9.1',
          inputPaths: ['src', 'lib/**/*.ts'],
        }),
      ).toBe('yarn ts-migrating annotate src lib/**/*.ts');
    });

    it('uses the override verbatim', () => {
      expect(
        getAnnotateCommand({
          override: 'yarn typecheck:annotate',
          userAgent: 'pnpm/10.28.0',
          inputPaths: ['src'],
        }),
      ).toBe('yarn typecheck:annotate');
    });

    it('ignores a blank override', () => {
      expect(getAnnotateCommand({ ...base, override: '  ', userAgent: 'yarn/4.9.1' })).toBe(
        'yarn ts-migrating annotate',
      );
    });
  });
}
