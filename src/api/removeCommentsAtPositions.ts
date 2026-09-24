type Range = { start: number; end: number };

/**
 * The range to delete for the comment whose text starts at `position` (i.e.
 * right after `//` or `/*` and any whitespace), or `undefined` when the comment
 * isn't a shape we can safely remove (e.g. a line inside a multi-line block
 * comment).
 */
const getRemovalRange = (code: string, position: number): Range | undefined => {
  const lineStart = code.lastIndexOf('\n', position - 1) + 1;
  const newline = code.indexOf('\n', position);
  const lineEnd = newline === -1 ? code.length : newline;
  const contentEnd = code[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;

  const before = code.slice(lineStart, position);

  const wholeLine = (): Range => {
    if (newline !== -1) return { start: lineStart, end: newline + 1 };
    // Last line: take the preceding line break instead.
    if (lineStart === 0) return { start: 0, end: code.length };
    return {
      start: code[lineStart - 2] === '\r' ? lineStart - 2 : lineStart - 1,
      end: code.length,
    };
  };

  const isBlank = (text: string) => text.trim() === '';

  // Removes `start..end` from within a line, plus the whitespace on one side of
  // it so no double (or trailing) space is left behind.
  const withinLine = (start: number, end: number): Range => {
    if (isBlank(code.slice(lineStart, start)) && isBlank(code.slice(end, contentEnd))) {
      return wholeLine();
    }
    const isWhitespace = (index: number) => /[ \t]/.test(code[index] ?? '');
    let trimmedStart = start;
    while (trimmedStart > lineStart && isWhitespace(trimmedStart - 1)) trimmedStart -= 1;
    // `a /* c */ b` or `a; // c`: drop the whitespace before.
    if (trimmedStart < start && (end === contentEnd || isWhitespace(end))) {
      return { start: trimmedStart, end };
    }
    // `f(/* c */ a)`: drop the whitespace after.
    let trimmedEnd = end;
    while (trimmedEnd < contentEnd && isWhitespace(trimmedEnd)) trimmedEnd += 1;
    return { start, end: trimmedEnd };
  };

  const lineCommentOpener = /\/\/[ \t]*$/.exec(before);
  if (lineCommentOpener) {
    const commentStart = lineStart + lineCommentOpener.index;
    // `${// @ts-migrating⏎expr}`: how directives are added inside template
    // literal expressions. Drop the line break too, restoring `${expr}`.
    if (/\$\{[ \t]*$/.test(code.slice(lineStart, commentStart)) && newline !== -1) {
      return { start: commentStart, end: newline + 1 };
    }
    return withinLine(commentStart, contentEnd);
  }

  const blockCommentOpener = /\/\*+[ \t]*$/.exec(before);
  if (blockCommentOpener) {
    const close = code.indexOf('*/', position);
    if (close === -1 || close > contentEnd) return undefined;

    let start = lineStart + blockCommentOpener.index;
    let end = close + 2;
    // `{/* @ts-migrating */}`: how directives are added among JSX children.
    const openBrace = /\{[ \t]*$/.exec(code.slice(lineStart, start));
    const closeBrace = /^[ \t]*\}/.exec(code.slice(end, contentEnd));
    if (openBrace && closeBrace) {
      start = lineStart + openBrace.index;
      end += closeBrace[0].length;
    }
    return withinLine(start, end);
  }

  return undefined;
};

/**
 * Removes the comments whose text starts at `positions` (as reported for
 * `@ts-migrating` directives): a comment alone on its line takes the whole line
 * with it; a trailing comment leaves the code before it untouched.
 *
 * Returns the new code, the positions that could not be removed, and
 * `mapPosition` to translate a position in the old code to the new code.
 */
export const removeCommentsAtPositions = (
  code: string,
  positions: readonly number[],
): {
  code: string;
  removedCount: number;
  unremovedPositions: number[];
  mapPosition: (position: number) => number;
} => {
  const ranges: Range[] = [];
  const unremovedPositions: number[] = [];
  for (const position of new Set(positions)) {
    const range = getRemovalRange(code, position);
    if (range) ranges.push(range);
    else unremovedPositions.push(position);
  }

  ranges.sort((a, b) => a.start - b.start);
  // Merge overlaps (e.g. two directives on the same line).
  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start < last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  let result = '';
  let cursor = 0;
  for (const { start, end } of merged) {
    result += code.slice(cursor, start);
    cursor = end;
  }
  result += code.slice(cursor);

  const mapPosition = (position: number): number => {
    let removedBefore = 0;
    for (const { start, end } of merged) {
      if (start >= position) break;
      removedBefore += Math.min(end, position) - start;
    }
    return position - removedBefore;
  };

  return {
    code: result,
    removedCount: positions.length - unremovedPositions.length,
    unremovedPositions,
    mapPosition,
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const DIRECTIVE = '@ts-migrating';

  const directivePositions = (code: string): number[] =>
    [...code.matchAll(/@ts-migrating/g)].map(({ index }) => index);

  const removeDirectives = (code: string) =>
    removeCommentsAtPositions(code, directivePositions(code));

  describe('removeCommentsAtPositions', async () => {
    const { insertSingleLineCommentAtPositions } = await import(
      './insertSingleLineCommentsAtPositions'
    );

    it('removes a whole-line comment', () => {
      expect(removeDirectives('f();\n  // @ts-migrating\n  g();\n').code).toBe('f();\n  g();\n');
    });

    it('removes a whole-line comment with an explanation', () => {
      expect(removeDirectives('// @ts-migrating - legacy code\ng();').code).toBe('g();');
    });

    it('removes a comment on the last line along with the preceding line break', () => {
      expect(removeDirectives('f();\r\n// @ts-migrating').code).toBe('f();');
    });

    it('removes a whole-line JSX comment', () => {
      expect(removeDirectives('<div>\n  {/* @ts-migrating */}\n  {hi}\n</div>').code).toBe(
        '<div>\n  {hi}\n</div>',
      );
    });

    it('removes a whole-line block comment', () => {
      expect(removeDirectives('/* @ts-migrating */\ng();').code).toBe('g();');
    });

    it('removes only the trailing comment after code', () => {
      expect(removeDirectives('const url = "http://a"; // @ts-migrating\ng();').code).toBe(
        'const url = "http://a";\ng();',
      );
    });

    it('removes an inline block comment', () => {
      expect(removeDirectives('f(/* @ts-migrating */ a);').code).toBe('f(a);');
    });

    it('restores a template literal expression', () => {
      expect(removeDirectives('`I am ${// @ts-migrating\nawesome}.`;').code).toBe(
        '`I am ${awesome}.`;',
      );
    });

    it('keeps CRLF line endings', () => {
      expect(removeDirectives('f();\r\n// @ts-migrating\r\ng();\r\n').code).toBe(
        'f();\r\ng();\r\n',
      );
    });

    it('leaves comments it cannot safely remove', () => {
      const code = '/*\n * @ts-migrating\n */\ng();';
      const result = removeDirectives(code);
      expect(result.code).toBe(code);
      expect(result.removedCount).toBe(0);
      expect(result.unremovedPositions).toEqual(directivePositions(code));
    });

    it('maps positions after removed ranges', () => {
      const code = 'f();\n// @ts-migrating\ng();\nh();';
      const { code: removed, mapPosition } = removeDirectives(code);
      expect(removed.slice(mapPosition(code.indexOf('g')))).toBe('g();\nh();');
      expect(removed.slice(mapPosition(code.indexOf('h')))).toBe('h();');
      expect(mapPosition(code.indexOf('f'))).toBe(0);
    });

    // Removing what `annotate` added must give back the original code.
    it.each([
      ['plain', 'f();\ng();\n\nconst a = 1;', ['g', 'const']],
      ['indented', 'if (a) {\n  f();\n  g();\n}', ['g']],
      ['jsx children', 'const a = <div>\n  {hi}\n</div>;', ['hi']],
      ['jsx attributes', 'const a = <div\n  a={hi}>\n</div>;', ['hi']],
      ['template literal', 'const m = `I am\n freaking ${awesome}.`;', ['awesome']],
      ['crlf', 'f();\r\ng();\r\nh();', ['g', 'h']],
      ['crlf template literal', 'const x = `a ${cool}\r\n${awesome}`;\r\nf();\r\n', ['awesome']],
    ])('round-trips with insertSingleLineCommentAtPositions (%s)', (_, code, needles) => {
      const annotated = insertSingleLineCommentAtPositions(
        code,
        DIRECTIVE,
        needles.map(needle => code.indexOf(needle)),
      );
      expect(annotated).not.toBe(code);
      expect(removeDirectives(annotated).code).toBe(code);
    });
  });
}
