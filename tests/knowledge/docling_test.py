"""Optional real Docling recipe checks; synthetic PDFs, no cloud model calls."""
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'workers/parser'))
import sandbox

@unittest.skipUnless(os.environ.get('DOCLING_TEST') == '1', 'Docling model installation is opt-in')
class DoclingTests(unittest.TestCase):
    def parse(self, data):
        with tempfile.TemporaryDirectory() as job:
            Path(job, 'input').write_bytes(data)
            return json.loads(sandbox.run(job, 'docling-pdf'))

    def test_scanned_pdf_has_page_provenance_and_review_warning(self):
        from PIL import Image, ImageDraw, ImageFont
        image = Image.new('RGB', (1000, 400), 'white')
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 42) if sys.platform == 'darwin' else ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 42)
        draw.text((50, 100), 'Synthetic budget 123.45', font=font, fill='black')
        data = io.BytesIO(); image.save(data, format='PDF')
        result = self.parse(data.getvalue())
        self.assertEqual('PARTIAL', result['status'], result)
        self.assertEqual('docling-2.140.0', result['parserVersion'])
        self.assertIn('123.45', '\n'.join(c['content'] for c in result['chunks']))
        self.assertTrue(all(c['locator'] == '第 1 页' for c in result['chunks']))
        self.assertIn('OCR_REVIEW_REQUIRED', result['warnings'])

    def test_corrupt_pdf_has_no_fake_chunks(self):
        result = self.parse(b'not a pdf')
        self.assertEqual('FAILED', result['status'])
        self.assertEqual([], result['chunks'])
