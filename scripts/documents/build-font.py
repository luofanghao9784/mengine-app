"""Reproduce the bundled document font. Development-only: Python + fonttools==4.61.1.
Application startup/export never downloads fonts or runs this script.
"""
from pathlib import Path
import hashlib
import io
import urllib.request
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / 'apps/api/src/main/resources/fonts/DreamcoreDocumentSansSC-Regular.ttf'
SOURCE = 'https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf'
raw = urllib.request.urlopen(SOURCE, timeout=60).read(20_000_000)
assert hashlib.sha256(raw).hexdigest() == 'd68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964'
font = instantiateVariableFont(TTFont(io.BytesIO(raw), recalcTimestamp=False), {'wght': 400}, inplace=True)
names = {1: 'Dreamcore Document Sans SC', 3: 'DreamcoreDocumentSansSC-Regular-2.004', 4: 'Dreamcore Document Sans SC Regular', 6: 'DreamcoreDocumentSansSC-Regular', 16: 'Dreamcore Document Sans SC', 17: 'Regular'}
for record in font['name'].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
out = io.BytesIO()
font.save(out)
data = out.getvalue()
assert hashlib.sha256(data).hexdigest() == 'd033bb0663f8afd4349c219e2634783f102b64f49871a367675c16718297e5fb'
FONT.write_bytes(data)
print('Verified reproducible bundled font:', FONT.name)
