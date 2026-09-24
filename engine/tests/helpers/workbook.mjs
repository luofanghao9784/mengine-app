import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
// Independent standard-library ZIP/XML reader checks actual serialized cells and CRCs.
export function inspectWorkbook(bytes) {
  const result = spawnSync(
    process.env.DREAMCORE_TEST_PYTHON || 'python3',
    [
      '-c',
      `
import io,json,sys,zipfile,xml.etree.ElementTree as E
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
sheets=[]
for n in sorted(z.namelist()):
 r=E.fromstring(z.read(n))
 assert not r.findall('.//s:f',ns)
 assert b'TargetMode="External"' not in z.read(n)
 if n.startswith('xl/worksheets/'):
  sheets.append({c.attrib['r']:{'type':c.attrib.get('t','n'),'value':(''.join(c.itertext()))} for c in r.findall('.//s:c',ns)})
print(json.dumps({'files':z.namelist(),'sheets':sheets},ensure_ascii=False))
`,
    ],
    { input: bytes, maxBuffer: 1048576 },
  );
  assert.equal(result.status, 0, result.stderr.toString());
  return JSON.parse(result.stdout);
}
