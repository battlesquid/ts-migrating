/**
 * The line terminator used by most lines of `code`: `\r\n` if CRLF lines
 * outnumber LF-only lines, `\n` otherwise (including for single-line code).
 */
export const detectLineTerminator = (code: string): '\n' | '\r\n' => {
  let crlf = 0;
  let lf = 0;
  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) {
    if (code[i - 1] === '\r') crlf += 1;
    else lf += 1;
  }
  return crlf > lf ? '\r\n' : '\n';
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe('detectLineTerminator', () => {
    it('detects LF', () => {
      expect(detectLineTerminator('a\nb\n')).toBe('\n');
    });

    it('detects CRLF', () => {
      expect(detectLineTerminator('a\r\nb\r\n')).toBe('\r\n');
    });

    it('defaults to LF without line breaks', () => {
      expect(detectLineTerminator('a')).toBe('\n');
    });

    it('picks the majority for mixed endings', () => {
      expect(detectLineTerminator('a\r\nb\r\nc\n')).toBe('\r\n');
      expect(detectLineTerminator('a\r\nb\nc\n')).toBe('\n');
    });
  });
}
