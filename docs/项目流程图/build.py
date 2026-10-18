#!/usr/bin/env python3
"""Extract maintained Markdown diagrams and validate all local evidence links."""
import hashlib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SNAPSHOT = json.loads((HERE / 'snapshot.json').read_text(encoding='utf8'))
FILES = [('功能流程', '01-功能流程.md'), ('开源替代方案', '05-开源替代流程.md'), ('实现流程', '02-实现流程.md')]


def main():
    diagrams = []
    out = HERE / 'diagrams'
    out.mkdir(exist_ok=True)
    seen = set()
    for group, filename in FILES:
        markdown = (HERE / filename).read_text()
        sections = re.split(r'^## ', markdown, flags=re.M)[1:]
        for section in sections:
            heading, body = section.split('\n', 1)
            identifier, title = heading.split(' ', 1)
            assert re.fullmatch(r'[FIO]\d{2}', identifier), heading
            assert identifier not in seen, identifier
            seen.add(identifier)
            blocks = re.findall(r'```mermaid\n(.*?)\n```', body, flags=re.S)
            assert len(blocks) == 1, heading
            diagram = blocks[0].strip() + '\n'
            before, after = body.split('```mermaid', 1)
            evidence = after.split('```', 1)[1].strip()
            sources = []
            for label, link in re.findall(r'\[([^\]]+)\]\(([^)]+)\)', evidence):
                if link.startswith('https://'):
                    sources.append({'label': label, 'path': link, 'link': link, 'kind': 'web'})
                    continue
                path = (HERE / link).resolve()
                assert path.is_relative_to(ROOT), link
                assert path.is_file(), 'Missing source: ' + str(path)
                sources.append({'label': label, 'path': path.relative_to(ROOT).as_posix(),
                                'link': link, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
            assert sources, 'No evidence: ' + identifier
            (out / (identifier + '.mmd')).write_text(diagram)
            diagrams.append({'id': identifier, 'title': title, 'group': group, 'document': filename,
                             'description': before.strip(), 'mermaid': diagram, 'sources': sources})
    head = SNAPSHOT['sourceHead']
    assessments = json.loads((HERE / 'opensource-options.json').read_text())
    for diagram in diagrams:
        diagram['options'] = [item for item in assessments['items'] if diagram['id'] in item['flows']]
    catalog = {'date': SNAPSHOT['reviewedOn'], 'timezone': SNAPSHOT['timezone'], 'head': head,
               'runtimeHead': SNAPSHOT['runtimeHead'],
               'scope': '源码核查；开发基线与运行部署分别记录', 'diagrams': diagrams}
    (HERE / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
    print(f'Validated {len(diagrams)} diagrams and {sum(len(d["sources"]) for d in diagrams)} evidence references.')


if __name__ == '__main__':
    main()
