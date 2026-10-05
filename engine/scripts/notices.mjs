import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const groups = new Map();
let text =
  '# Engine third-party notices\n\nGenerated from the installed, locked production dependency packages.\n';
text +=
  'Use `npm ci --ignore-scripts` and `npm run licenses:write` to regenerate. Keep these notices with redistributed engine artifacts.\n\n';
text += '| Package | Version | Declared license |\n| --- | --- | --- |\n';
for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!path || entry.dev) continue;
  const metadata = JSON.parse(await readFile(join(root, path, 'package.json'), 'utf8'));
  if (metadata.version !== entry.version) throw new Error(`Install differs from lock: ${path}`);
  let license;
  try { license = (await readFile(join(root, path, 'LICENSE'), 'utf8')).trim(); }
  catch (error) {
    if(error.code !== 'ENOENT') throw error;
    license = (await readFile(join(root, 'vendor-licenses', metadata.name, metadata.version, 'LICENSE'), 'utf8')).trim();
  }
  text += `| ${metadata.name} | ${metadata.version} | ${metadata.license} |\n`;
  if (!groups.has(license)) groups.set(license, []);
  groups.get(license).push(`${metadata.name}@${metadata.version}`);
}
for (const [license, packages] of groups) {
  text += `\n## ${packages.join(', ')}\n\n\`\`\`text\n${license}\n\`\`\`\n`;
}
const destination = join(root, 'THIRD_PARTY_NOTICES.md');
if (process.argv.includes('--check')) {
  if ((await readFile(destination, 'utf8')) !== text)
    throw new Error('Notices are stale; run npm run licenses:write');
  console.log('Installed production dependency notices match the lock.');
} else await writeFile(destination, text);
