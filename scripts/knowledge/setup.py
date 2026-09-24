"""Install pinned parser dependencies and local OCR data; never uses model APIs."""
from pathlib import Path
import hashlib, subprocess, sys, urllib.request
ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / 'workers/parser'
subprocess.run([sys.executable, '-m', 'venv', str(WORKER / '.venv')], check=True)
subprocess.run([str(WORKER / '.venv/bin/python'), '-m', 'pip', 'install', '--only-binary=:all:', '-r', str(WORKER / ('requirements-test.txt' if '--with-tests' in sys.argv else 'requirements.txt'))], check=True)
DATA = WORKER / '.local/tessdata'
DATA.mkdir(parents=True, exist_ok=True)
for lang, digest in {
    'eng': '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
    'chi_sim': 'a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730',
}.items():
    target = DATA / (lang + '.traineddata')
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        url = f'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/65727574dfcd264acbb0c3e07860e4e9e9b22185/{lang}.traineddata'
        data = urllib.request.urlopen(url, timeout=60).read(10_000_000)
        if hashlib.sha256(data).hexdigest() != digest:
            raise RuntimeError('OCR model checksum mismatch')
        target.write_bytes(data)
print('Parser dependencies and OCR data ready. Poppler and Tesseract must also be installed locally.')
