#!/usr/bin/env python3
"""Developer-only: record fingerprints from synthetic clean migrations and an actual dump/restore.
Run only AFTER reviewing and implementing recovery behavior for every migration being admitted.
Never learns fingerprints from an existing user/trial database.
"""
import argparse
import json
from pathlib import Path
import sys
from unittest.mock import patch
import backup
import backup_recovery


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reviewed-through',type=int,required=True)
    args=parser.parse_args()
    migrations=backup.migrations()
    if not migrations or int(migrations[-1]['version'])!=args.reviewed_through:
        parser.error('明确审查过的最高迁移必须与当前文件完全一致。')
    sys.path.insert(0,str(backup.trial.WORKSPACE/'tests/local'))
    from backup_integration_test import RealBackupTest
    case=RealBackupTest('test_real_create_restore_current_deletion_revocation_rotation')
    try:
        case.setUp()
        with backup.offline_database(case.source) as (_,__,sql):
            tables=sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
            original=backup_recovery.catalog_hash(sql)
        bundle,restored=case.root/'recording-bundle',case.root/'recording-restored'
        backup.create(case.source,bundle,case.key)
        # This explicit maintenance command substitutes only the catalog gate, only in fresh synthetic data.
        # Real restore integrity, quarantine and all SQL continue to execute and must succeed.
        with patch.object(backup_recovery,'coverage',return_value='synthetic-catalog-recording'):
            backup.restore(bundle,restored,case.key)
        with backup.offline_database(restored) as (_,__,sql):
            restored_hash=backup_recovery.catalog_hash(sql)
        value={'format':'dreamcore-recovery-coverage-v1','throughVersion':args.reviewed_through,
               'implementationHashes':backup_recovery.implementation_hashes(),'migrations':migrations,'tables':tables,'catalogHashes':sorted({original,restored_hash})}
        backup_recovery.COVERAGE.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'status':'recorded_from_synthetic_database','migrations':len(migrations),'tables':len(tables),'catalogs':len(value['catalogHashes'])}))
    finally:case.doCleanups()


if __name__=='__main__':main()
