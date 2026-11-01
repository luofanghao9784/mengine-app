from pathlib import Path
import tempfile
import unittest
from render_cloud import render


class CloudRenderSafetyTests(unittest.TestCase):
    def test_rejects_command_injection_before_writing(self):
        with tempfile.TemporaryDirectory() as temporary:
            for host in ('example;touch x', '$(id)', '../parent', 'host\ncommand'):
                destination = Path(temporary) / 'new'
                with self.subTest(host=host), self.assertRaises(ValueError):
                    render('203.0.113.10', host, destination)
                self.assertFalse(destination.exists())

    def test_rejects_invalid_addresses(self):
        with tempfile.TemporaryDirectory() as temporary:
            for address in ('127.0.0.1', '0.0.0.0', '224.0.0.1', '::1', 'host;id'):
                with self.subTest(address=address), self.assertRaises(ValueError):
                    render(address, 'approved-host', Path(temporary) / 'new')

    def test_preserves_existing_files_and_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / 'existing'
            directory.mkdir()
            marker = directory / 'authority'
            marker.write_text('Do not replace')
            with self.assertRaises(ValueError):
                render('203.0.113.10', 'approved-host', directory)
            self.assertEqual(marker.read_text(), 'Do not replace')
            link = Path(temporary) / 'link'
            link.symlink_to(directory, target_is_directory=True)
            with self.assertRaises(ValueError):
                render('203.0.113.10', 'approved-host', link)


if __name__ == '__main__':
    unittest.main()
