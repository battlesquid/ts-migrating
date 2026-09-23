import * as recast from 'recast';
import * as babelTsParser from 'recast/parsers/babel-ts';
import { maxBy } from './utils/maxBy';

const b = recast.types.builders;

const getAbsolutePosition = (
  code: string,
  { line, column }: recast.types.namedTypes.Position,
): number => {
  const lines = code.split(/(?<=\n)/);

  const lineIndex = line - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) throw new RangeError('Invalid line number');
  if (column < 0 || column > (lines[lineIndex]?.length ?? 0))
    throw new RangeError('Invalid column number');

  return lines.slice(0, lineIndex).reduce((acc, l) => acc + l.length, 0) + column;
};

const getLineColumnPosition = (
  code: string,
  absolutePosition: number,
): recast.types.namedTypes.Position => {
  if (absolutePosition < 0 || absolutePosition >= code.length) {
    throw new RangeError('Invalid position');
  }

  const lines = code.split(/(?<=\n)/);

  let currentPosition = 0;
  for (const [i, line] of lines.entries()) {
    currentPosition += line.length;

    if (currentPosition > absolutePosition) {
      return {
        line: i + 1,
        column: line.length - (currentPosition - absolutePosition),
      };
    }
  }
  throw new RangeError('Invalide position');
};

if (import.meta.vitest) {
  const { it, describe, expect } = import.meta.vitest;

  describe('getAbsolutePosition / getLineColumnPosition', async () => {
    const ts = await import('typescript/lib/tsserverlibrary');

    it('should return the absolute position and back', () => {
      const code = `const a = 'hi'
const b = 'bye'
hello()`;
      const sourcefile = ts.createSourceFile(
        'tmp.ts',
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const checkForIndex = (index: number) => {
        const { line, character } = ts.getLineAndCharacterOfPosition(sourcefile, index);
        expect(getAbsolutePosition(code, { line: line + 1, column: character })).toBe(index);
        expect(getLineColumnPosition(code, index)).toEqual({ line: line + 1, column: character });
      };

      checkForIndex(code.indexOf('='));
      checkForIndex(code.indexOf('\n'));
      checkForIndex(code.indexOf('const b'));
      checkForIndex(code.indexOf('bye'));
      checkForIndex(code.indexOf('llo()'));
    });

    it('should deal with empty line start correctly', () => {
      const code = '\nconst a = "hi"';
      expect(getLineColumnPosition(code, 0)).toEqual({ line: 1, column: 0 });
    });
  });
}

const extractIndent = (code: string): string => {
  return code.replace(/^([ \t]*).*/s, '$1');
};

type NaiveCommentType = 'jsx-naive' | 'vanilla-naive';
type CommentType = NaiveCommentType | 'vanilla-attach-to-node';

/**
 * The comment to insert. Either a single string used for every position, or a
 * function resolving the comment from the position — the latter lets callers
 * (e.g. `annotate`) embed per-diagnostic context such as the error code or
 * message.
 */
type CommentResolver = string | ((position: number) => string);

export const insertSingleLineCommentAtPositions = (
  code: string,
  comment: CommentResolver,
  positions: number[],
): string => {
  if (positions.length <= 0) return code;

  const ast = recast.parse(code, { parser: babelTsParser });

  const resolveComment = typeof comment === 'function' ? comment : () => comment;

  // Map every affected line to the comment of the first position landing on it.
  // Multiple positions can collapse onto one line but we only ever insert a
  // single comment there, so the first one wins.
  const lineToComment = new Map<number, string>();
  for (const position of positions) {
    const line = getLineColumnPosition(code, position).line;
    if (!lineToComment.has(line)) lineToComment.set(line, resolveComment(position));
  }

  const linesToAdd = new Set(lineToComment.keys());

  const naiveComments = new Map<number, NaiveCommentType>();
  const addedLineNumbers = new Set<number>();
  const commentTypeStack: CommentType[] = ['vanilla-naive'];

  recast.types.visit(ast, {
    visitTemplateElement(path) {
      this.traverse(path);
    },

    visitNode(path) {
      const { node } = path;

      if (linesToAdd.size <= 0) {
        return this.abort();
      }

      if (!node.loc) {
        this.traverse(path);
        return;
      }

      const preVisits: (() => void)[] = [];
      const postVisits: (() => void)[] = [];

      const setChildrenCommentType = (type: CommentType) => {
        preVisits.push(() => {
          commentTypeStack.push(type);
        });

        postVisits.push(() => {
          commentTypeStack.pop();
        });
      };

      if (
        recast.types.namedTypes.JSXElement.check(node) ||
        recast.types.namedTypes.JSXFragment.check(node)
      ) {
        setChildrenCommentType('jsx-naive');
      }

      if (
        recast.types.namedTypes.JSXExpressionContainer.check(node) ||
        recast.types.namedTypes.JSXOpeningElement.check(node) ||
        recast.types.namedTypes.JSXClosingElement.check(node)
      ) {
        setChildrenCommentType('vanilla-naive');
      }

      if (recast.types.namedTypes.TemplateLiteral.check(node)) {
        setChildrenCommentType('vanilla-attach-to-node');
      }

      const commentType = commentTypeStack.at(-1);
      if (linesToAdd.has(node.loc.start.line)) {
        linesToAdd.delete(node.loc.start.line);
        switch (commentType) {
          case 'vanilla-attach-to-node': {
            addedLineNumbers.add(node.loc.start.line);
            node.comments = [
              ...(node?.comments ?? []),
              b.commentLine.from({
                value: ` ${lineToComment.get(node.loc.start.line) ?? ''}`,
                leading: true,
              }),
            ];
            break;
          }
          case 'vanilla-naive':
          case 'jsx-naive': {
            naiveComments.set(node.loc.start.line, commentType);
            break;
          }
        }
      }

      for (const preVisit of preVisits) preVisit();
      this.traverse(path);
      for (const postVisit of postVisits) postVisit();
    },
  });

  const adjustLineNumber = (originalLineNumber: number): number => {
    // this represents the number of lines already added during ast traversal
    const offset = [...addedLineNumbers].filter(
      lineNumber => lineNumber <= originalLineNumber,
    ).length;
    return originalLineNumber + offset;
  };

  const adjustedAddedLineNumbers = new Set([...addedLineNumbers].map(adjustLineNumber));

  const adjustedNaiveComments = new Map(
    [...naiveComments].map(([lineNumber, commentType]) => [
      adjustLineNumber(lineNumber),
      commentType,
    ]),
  );

  const adjustedLineToComment = new Map(
    [...lineToComment].map(([lineNumber, resolvedComment]) => [
      adjustLineNumber(lineNumber),
      resolvedComment,
    ]),
  );

  // Only template-literal comments are attached to the AST. When there are
  // none, the tree is unmodified and recast would print back the original
  // source, so skip the (expensive) print.
  const lines = (addedLineNumbers.size > 0 ? recast.print(ast).code : code).split('\n');
    return lines
    .flatMap((line, i) => {
      const lineNumber = i + 1; // +1 because line numbers are 1-index
      if (adjustedAddedLineNumbers.has(lineNumber)) return [line];

      const commentType = adjustedNaiveComments.get(lineNumber);
      if (commentType === undefined) return [line];

      const indent = maxBy(
        [extractIndent(line), extractIndent(lines[i - 1] ?? '')],
        ({ length }) => length,
      );
      const resolvedComment = adjustedLineToComment.get(lineNumber) ?? '';
      return [
        {
          'vanilla-naive': `${indent}// ${resolvedComment}`,
          'jsx-naive': `${indent}{/* ${resolvedComment} */}`,
        }[commentType],
        line,
      ];
    })
    .join('\n');
};

if (import.meta.vitest) {
  const { it, describe, expect } = import.meta.vitest;

  describe('insertSingleLineCommentsAtPositions', () => {
    it('should insert comment at given position', () => {
      expect(
        insertSingleLineCommentAtPositions(`f();\ng();\n\nconst a = 'hello';`, 'hello', [0]),
      ).toMatchInlineSnapshot(`
        "// hello
        f();
        g();

        const a = 'hello';"
      `);
    });

    it('should only insert one comment if given multiple positions on the same line', () => {
      expect(
        insertSingleLineCommentAtPositions(`f();\ng();\n\nconst a = 'hello';`, 'hello', [0, 1, 2]),
      ).toMatchInlineSnapshot(`
        "// hello
        f();
        g();

        const a = 'hello';"
      `);
    });
  });
}
