export type ReplyBlock =
  | { kind: 'paragraph' | 'quote' | 'table' | 'code'; text: string }
  | { kind: 'heading'; text: string; level: number }
  | { kind: 'divider' }
  | { kind: 'list'; ordered: boolean; items: { number?: number; blocks: ReplyBlock[] }[] };

const listMarker = (line: string) => {
  const match = line.match(/^(\s*)(?:(\d+)[.)]|[-*+•])\s+(.+)$/);
  return match ? { indent: match[1].length, ordered: !!match[2],
    number: match[2] ? Number(match[2]) : undefined, text: match[3] } : undefined;
};
const heading = (line: string) => {
  const markdown = line.match(/^\s*(#{1,6})\s+(.+)$/);
  if (markdown) return { level: markdown[1].length, text: markdown[2] };
  if (/^\s*[一二三四五六七八九十]+、/.test(line)) return { level: 1, text: line.trim() };
  return undefined;
};
const fence = (line: string) => line.match(/^\s*(`{3,}|~{3,})/);
const tableStart = (lines: string[], index: number) =>
  lines[index].trim().startsWith('|') && /^\s*\|[\s:|\-]+\|\s*$/.test(lines[index + 1] || '');
const divider = (line: string) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);

// A bounded display subset for replies; this never changes stored text or interprets HTML.
export function parseReplyBlocks(text: string, depth = 0): ReplyBlock[] {
  if (depth >= 12) return [{ kind: 'paragraph', text }];
  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const result: ReplyBlock[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const openingFence = fence(line);
    if (openingFence) {
      const body: string[] = [];
      index++;
      while (index < lines.length) {
        const closingFence = fence(lines[index]);
        if (closingFence && closingFence[1][0] === openingFence[1][0] && closingFence[1].length >= openingFence[1].length) {
          index++; break;
        }
        body.push(lines[index++]);
      }
      result.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const title = heading(line);
    if (title) { result.push({ kind: 'heading', text: title.text, level: title.level }); index++; continue; }
    if (divider(line)) { result.push({ kind: 'divider' }); index++; continue; }
    if (tableStart(lines, index)) {
      const body = [lines[index++], lines[index++]];
      while (index < lines.length && lines[index].trim().startsWith('|')) body.push(lines[index++]);
      result.push({ kind: 'table', text: body.join('\n') });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) body.push(lines[index++].replace(/^\s*>\s?/, ''));
      result.push({ kind: 'quote', text: body.join('\n') });
      continue;
    }
    const marker = listMarker(line);
    if (marker) {
      const items: { number?: number; blocks: ReplyBlock[] }[] = [];
      while (index < lines.length) {
        const item = listMarker(lines[index]);
        if (!item || item.indent !== marker.indent || item.ordered !== marker.ordered) break;
        const body = [item.text];
        index++;
        while (index < lines.length) {
          const next = lines[index];
          if (!next.trim()) {
            let following = index + 1;
            while (following < lines.length && !lines[following].trim()) following++;
            if (following >= lines.length || lines[following].search(/\S/) <= marker.indent) break;
            body.push(''); index++; continue;
          }
          if (next.search(/\S/) <= marker.indent) break;
          body.push(next.slice(Math.min(next.search(/\S/), marker.indent + 2)));
          index++;
        }
        items.push({ ...(item.number !== undefined ? { number: item.number } : {}), blocks: parseReplyBlocks(body.join('\n'), depth + 1) });
        while (index < lines.length && !lines[index].trim()) index++;
      }
      result.push({ kind: 'list', ordered: marker.ordered, items });
      continue;
    }
    const body = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !listMarker(lines[index]) &&
      !heading(lines[index]) && !fence(lines[index]) && !divider(lines[index]) &&
      !/^\s*>/.test(lines[index]) && !tableStart(lines, index)) body.push(lines[index++]);
    result.push({ kind: 'paragraph', text: body.join('\n') });
  }
  return result;
}
