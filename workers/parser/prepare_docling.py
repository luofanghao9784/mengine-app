"""Trusted deployment step only. Downloads public model weights, never customer documents."""
import hashlib
from importlib.metadata import version
import json
from pathlib import Path

if __name__ == '__main__':
    if version('docling') != '2.140.0':
        raise SystemExit('Expected docling==2.140.0')
    import urllib.request
    tessdata = Path(__file__).resolve().parent / '.local/tessdata'
    tessdata.mkdir(parents=True, exist_ok=True)
    target = tessdata / 'osd.traineddata'
    expected = '9cf5d576fcc47564f11265841e5ca839001e7e6f38ff7f7aacf46d15a96b00ff'
    if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != expected:
        with urllib.request.urlopen('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/65727574dfcd264acbb0c3e07860e4e9e9b22185/osd.traineddata', timeout=30) as response:
            data = response.read(15_000_000)
        if hashlib.sha256(data).hexdigest() != expected:
            raise SystemExit('OCR orientation model checksum mismatch')
        target.write_bytes(data)
    configs = tessdata / 'configs'
    configs.mkdir(exist_ok=True)
    (configs / 'tsv').write_text('tessedit_create_tsv 1\n')
    from docling.utils.model_downloader import download_models
    root = Path(__file__).resolve().parent / '.local/docling-artifacts'
    root.mkdir(parents=True, exist_ok=True)
    download_models(output_dir=root, with_layout=True, with_tableformer=True,
                    with_code_formula=False, with_picture_classifier=False, with_rapidocr=False)
    files = {}
    for path in sorted(root.rglob('*')):
        if path.is_file() and path.name != 'manifest.json' and '.cache' not in path.parts:
            with path.open('rb') as source:
                files[str(path.relative_to(root))] = hashlib.file_digest(source, 'sha256').hexdigest()
    if not files:
        raise SystemExit('No model artifacts downloaded')
    (root / 'manifest.json').write_text(json.dumps({'docling':'2.140.0', 'sha256':files}, indent=2)+'\n')
    print('Prepared Docling model manifest:', len(files), 'files')
