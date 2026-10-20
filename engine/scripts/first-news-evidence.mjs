/** Local first-onboarding author adapter. Reuses the product reader, never sends enterprise context. */
import { PublicReader } from '../dist/runtime/public-web.js';
import { writeFile } from 'node:fs/promises';
const [sourceUrl, articleUrl, output] = process.argv.slice(2);
if (!sourceUrl || !articleUrl || !output) throw new Error('Usage: source-url article-url output-json');
const reader = new PublicReader();
const candidates = await reader.discover(sourceUrl, AbortSignal.timeout(20000));
if (!candidates.some(c => c.url === articleUrl)) throw new Error('Article must be discovered from selected source');
const page = await reader.read(articleUrl, AbortSignal.timeout(20000), true);
if (!page.publishedAt || Date.parse(page.publishedAt) < Date.now() - 30 * 86400000 || Date.parse(page.publishedAt) > Date.now() + 86400000) throw new Error('Article publication date is missing or outside the news window');
await writeFile(output, JSON.stringify({ discoveredUrls: candidates.map(c => c.url), pages: [page] }, null, 2), { mode: 0o600, flag: 'wx' });
console.log('Original read with shared public reader; evidence saved locally.');
