"""Build reading materials from the reviewed package; never import credentials or unrestricted paths."""
import json,sys,zipfile,xml.etree.ElementTree as ET,hashlib,os
from pathlib import Path
p=Path(sys.argv[1]).resolve()
index=json.loads((p/'01-资料索引.json').read_text())
bundle=json.loads((p/'03-36张卡片数据.json').read_text())
snapshot=json.loads((p/'02-真实数据快照.json').read_text())
refs={r for c in bundle['cards'] for r in c['source_refs']}
refs.add('D08')
materials=[]
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
for s in index['sources']:
    if s['id'] not in refs:continue
    id=s['id'];path=Path(s['path'])if 'path'in s else None
    boundary=s.get('boundary','保留原始适用范围')
    title=s.get('title')or(path.name if path else id)
    relevant=[c for c in bundle['cards'] if id in c['source_refs']]
    content=f"{title}\n\n适用说明：{boundary}\n\n"
    if path and s.get('sha256') and hashlib.sha256(path.read_bytes()).hexdigest()!=s['sha256']:
        raise RuntimeError(f'{id}来源已变化，请先重新核验。')
    if id.startswith('DB:'):
        section=id.removeprefix('DB:');title=(relevant[0]['title']+' · 取数依据')if relevant else section
        content=f'{title}\n\n{boundary}\n金额：cents为分，yuan为元。未扣退款的收款不能作为净收入。\n\n'+json.dumps(snapshot['sections'][section],ensure_ascii=False,indent=2)
    elif s.get('kind')=='docx':
        with zipfile.ZipFile(path)as z:
            root=ET.fromstring(z.read('word/document.xml'))
            blocks=[]
            for element in root.find('w:body',ns):
                if element.tag.endswith('}p'):
                    blocks.append(''.join(t.text or '' for t in element.findall('.//w:t',ns)))
                elif element.tag.endswith('}tbl'):
                    rows=[]
                    for row in element.findall('w:tr',ns):
                        cells=[' / '.join(''.join(t.text or '' for t in para.findall('.//w:t',ns)) for para in cell.findall('.//w:p',ns)).replace('|','｜') for cell in row.findall('w:tc',ns)]
                        rows.append(cells)
                    columns=max((len(row) for row in rows),default=0)
                    if columns:
                        lines=['| '+' | '.join(row+['']*(columns-len(row)))+' |' for row in rows]
                        lines.insert(1,'| '+' | '.join(['---']*columns)+' |')
                        blocks.append('\n'.join(lines))
            content+='\n\n'.join(blocks)
    elif id=='R01':content+=path.read_text()
    elif s.get('kind')=='official_web':content+=s.get('summary','')+'\n\n原文日期：'+s.get('published_at','')+'\n事件日期：'+s.get('event_date','')+'\n原文：'+s['url']
    else:
        content+='本条为本次核读摘记；完整原件保留在内部资料目录。\n\n'
        content+='\n\n'.join(c['title']+'\n'+'\n'.join(c['facts'])+'\n'+'\n'.join(c['boundaries']) for c in relevant)
        if id.startswith('IMG'):title='场馆图片筛选记录 · '+path.parent.name+' · '+id
    if path and not id.startswith('DB:'):
        content+='\n\n原文件名：'+path.name
    if s.get('sha256'):content+='\n内容SHA256：'+s['sha256']
    row=dict(id=id,title=title,content=content,boundary=boundary,status=s.get('demo_status','使用中'))
    if s.get('url'):row.update(url=s['url'],publishedAt=s.get('published_at',''),eventDate=s.get('event_date',''))
    materials.append(row)
missing=refs-{s['id']for s in materials}
if missing:raise RuntimeError('缺少来源：'+','.join(sorted(missing)))
out=p/'09-资料阅读内容.json';out.write_text(json.dumps(dict(materials=materials),ensure_ascii=False,indent=2)+'\n');out.chmod(0o600)
print(f'已准备{len(materials)}份阅读资料，真实内容留在customer-data。')
