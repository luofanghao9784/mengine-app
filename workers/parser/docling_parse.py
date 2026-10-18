"""Optional Docling PDF recipe. Invoked only inside sandbox.py, never on the host."""
import io
import json
import os
from pathlib import Path
import sys

VERSION = 'docling-2.140.0'
ROOT = Path(__file__).resolve().parent

def convert(path):
    from importlib.metadata import version
    if version('docling') != '2.140.0':
        raise RuntimeError('DOCLING_VERSION_MISMATCH')
    artifacts = ROOT / '.local/docling-artifacts'
    if not (artifacts / 'manifest.json').is_file():
        raise RuntimeError('DOCLING_MODELS_NOT_READY')
    # Network is denied by the OS sandbox; these also prevent implicit HF downloads.
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HOME=str(path.parent / 'hf'),
                      OMP_NUM_THREADS='1', TOKENIZERS_PARALLELISM='false', HOME=str(path.parent))
    import mimetypes
    mimetypes.knownfiles = []  # Use built-in MIME tables; do not read host /etc.
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat, DocumentStream, ConversionStatus
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TesseractCliOcrOptions
    from docling.datamodel.accelerator_options import AcceleratorOptions, AcceleratorDevice
    from docling_core.types.doc import TableItem, TextItem
    tools = ROOT / '.local/tools/bin'
    tesseract = '/usr/bin/tesseract' if sys.platform == 'linux' else str(tools / 'tesseract') if tools.is_dir() else '/opt/homebrew/bin/tesseract'
    options = PdfPipelineOptions(artifacts_path=artifacts, enable_remote_services=False,
        document_timeout=60, do_ocr=True, do_table_structure=True,
        accelerator_options=AcceleratorOptions(num_threads=1, device=AcceleratorDevice.CPU),
        ocr_options=TesseractCliOcrOptions(lang=['chi_sim', 'eng'], tesseract_cmd=tesseract, path=str(ROOT / '.local/tessdata')))
    converter = DocumentConverter(allowed_formats=[InputFormat.PDF], format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
    if path.stat().st_size > 20_971_520:
        raise RuntimeError('DOCLING_INPUT_LIMIT')
    result = converter.convert(DocumentStream(name='input.pdf', stream=io.BytesIO(path.read_bytes())),
                               max_num_pages=30, max_file_size=20_971_520, raises_on_error=False)
    if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
        raise RuntimeError('DOCLING_CONVERSION_FAILED')
    chunks, used = [], 0
    notes = {'DOCLING_LAYOUT_REVIEW_REQUIRED', 'OCR_REVIEW_REQUIRED'}
    for item, _ in result.document.iterate_items():
        if not isinstance(item, (TableItem, TextItem)):
            continue
        pages = sorted({p.page_no for p in item.prov})
        if not pages:
            notes.add('DOCLING_LOCATION_MISSING'); continue
        text = (item.export_to_markdown(doc=result.document) if isinstance(item, TableItem) else item.text).replace('\x00', '').strip()
        locator = '第 ' + '、'.join(map(str, pages)) + ' 页'
        for start in range(0, len(text), 2000):
            part = text[start:start+2000]
            if len(chunks) >= 500 or used + len(part) > 400_000:
                notes.add('CONTENT_LIMIT')
                return {'parserVersion': VERSION, 'status': 'PARTIAL', 'warnings': sorted(notes), 'chunks': chunks}
            chunks.append({'locator':locator[:180], 'content':part, 'method':'TABLE' if isinstance(item, TableItem) else 'OCR'})
            used += len(part)
    if not chunks:
        raise RuntimeError('DOCLING_NO_TEXT')
    return {'parserVersion': VERSION, 'status':'PARTIAL', 'warnings':sorted(notes), 'chunks':chunks}

if __name__ == '__main__':
    try:
        result = convert(Path(sys.argv[1]))
    except Exception as error:
        allowed = {'DOCLING_VERSION_MISMATCH','DOCLING_MODELS_NOT_READY','DOCLING_INPUT_LIMIT','DOCLING_CONVERSION_FAILED','DOCLING_NO_TEXT'}
        code = str(error) if isinstance(error, RuntimeError) and str(error) in allowed else 'DOCLING_UNAVAILABLE_OR_LIMIT'
        result = {'parserVersion':VERSION, 'status':'FAILED', 'warnings':[code], 'chunks':[]}
    print(json.dumps(result, ensure_ascii=False))
