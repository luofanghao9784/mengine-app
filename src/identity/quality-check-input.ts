/**
 * CT-043 CheckTaskController: String.strip(), then String.codePointCount().
 * Java Character.isWhitespace includes U+001C–001F, excludes NBSP U+00A0,
 * U+2007, U+202F and BOM U+FEFF; JS trim()/\s is not equivalent.
 * https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Character.html#isWhitespace(int)
 */
function strippedCodePointLength(value: string): number {
  const stripped = value.replace(
    /^[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+$/g,
    '',
  );
  return Array.from(stripped).length;
}

export function qualityCheckInputState(materialText: string, title = '') {
  const materialLength = strippedCodePointLength(materialText);
  const titleLength = strippedCodePointLength(title);
  return {
    materialLength,
    titleLength,
    valid: materialLength > 0 && materialLength <= 20_000 && titleLength <= 200,
  };
}
