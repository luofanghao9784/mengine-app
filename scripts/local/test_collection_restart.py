import json
from pathlib import Path
import tempfile
import unittest
from trial import instance_collection_environment, private_write, TrialError


class CollectionRestartTest(unittest.TestCase):
    def test_installed_collector_survives_normal_restart(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            executable = root / 'collector'
            executable.write_text('#!/bin/sh\nexit 1\n')
            executable.chmod(0o700)
            private_write(root / 'collection-runtime.json', {'executable': str(executable)})
            expected = {'DREAMCORE_COLLECTION_EXECUTABLE': str(executable)}
            self.assertEqual(expected, instance_collection_environment(root))
            (root / 'restore.json').write_text('{}')
            self.assertEqual({}, instance_collection_environment(root))
            self.assertEqual(expected, instance_collection_environment(root, root / 'collection-runtime.json'))

    def test_unconfigured_and_unsafe_saved_configuration(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            self.assertEqual({}, instance_collection_environment(root))
            private_write(root / 'collection-runtime.json', {'executable': '/missing'})
            with self.assertRaises(TrialError):
                instance_collection_environment(root)
            (root / 'collection-runtime.json').chmod(0o644)
            with self.assertRaises(TrialError):
                instance_collection_environment(root)

    def test_explicit_configuration_overrides_saved_configuration(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            executable = root / 'collector'
            executable.write_text('#!/bin/sh\nexit 1\n')
            executable.chmod(0o700)
            private_write(root / 'collection-runtime.json', {'executable': '/missing'})
            private_write(root / 'explicit.json', {'executable': str(executable)})
            self.assertEqual({'DREAMCORE_COLLECTION_EXECUTABLE': str(executable)},
                             instance_collection_environment(root, root / 'explicit.json'))


if __name__ == '__main__':
    unittest.main()
