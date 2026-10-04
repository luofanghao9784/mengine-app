"""Bounded private operational facts for the read-only platform monitor. No paths/content/errors."""
import fcntl
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import trial
from datetime import datetime, timezone
from uuid import UUID, uuid4

FORMAT = 'dreamcore-backup-observation-v1'
RESULTS = {'create':'created','verify':'verified','restore':'restored_quarantined','repack':'copied','rotate':'rotated','reconcile':'current_state_checked_quarantined','activate':'activated'}

def timestamp():
    return datetime.now(timezone.utc).isoformat()

def private_stat(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1:
        raise ValueError('Invalid observation file')
    return info

def write(path, event):
    path = Path(path).absolute()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent = path.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
        raise ValueError('Invalid observation directory')
    fd = os.open(str(path)+'.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        private_stat(Path(str(path)+'.lock'))
        fcntl.flock(fd, fcntl.LOCK_EX)
        events = []
        if path.exists() or path.is_symlink():
            if private_stat(path).st_size > 65536:
                raise ValueError('Oversized observation')
            value = json.loads(path.read_text())
            if set(value) != {'format','updatedAt','events'} or value['format'] != FORMAT or not isinstance(value['events'], list) or len(value['events']) > 40:
                raise ValueError('Invalid observation')
            events = value['events']
        events = [e for e in events if e['id'] != event['id']]
        events.append(event)
        events.sort(key=lambda e:e['startedAt'], reverse=True)
        value = {'format':FORMAT,'updatedAt':timestamp(),'events':events[:40]}
        payload = json.dumps(value, ensure_ascii=True).encode()
        if len(payload) > 65536:
            raise ValueError('Oversized observation')
        temp_fd, name = tempfile.mkstemp(prefix='.backup-observation-', dir=path.parent)
        try:
            with os.fdopen(temp_fd,'wb') as output:
                output.write(payload); output.flush(); os.fsync(output.fileno())
            os.replace(name,path)
        finally:
            if os.path.exists(name): os.unlink(name)
    finally:
        os.close(fd)

def metadata(snapshot):
    if snapshot is None: return None
    snapshot_id = str(UUID(snapshot['snapshotId']))
    created,expires = (datetime.fromisoformat(snapshot[k]) for k in ('createdAt','expiresAt'))
    if created.tzinfo is None or expires.tzinfo is None or expires <= created: raise ValueError('Invalid dates')
    sizes = [f['bytes'] for f in snapshot['files'].values()]
    if any(type(s) is not int or s < 0 for s in sizes): raise ValueError('Invalid sizes')
    return {'id':snapshot_id,'createdAt':created.isoformat(),'expiresAt':expires.isoformat(),'bytes':sum(sizes),'files':len(sizes),'tables':len(snapshot['tables'])}

def observe(path, command, operation, snapshot):
    """Observation failures never replay or misreport a completed backup operation."""
    if path is None: return operation()
    if command not in RESULTS: raise ValueError('Unknown operation')
    event = {'id':str(uuid4()),'command':command.upper(),'state':'RUNNING','startedAt':timestamp(),'finishedAt':None,'snapshot':None}
    def publish():
        try: write(path,event)
        except (OSError,ValueError,KeyError,TypeError):
            print('备份状态记录未写入；实际操作结果以命令回执为准。',file=sys.stderr)
    publish()
    try: result = operation()
    except BaseException:
        event.update(state='FAILED',finishedAt=timestamp()); publish(); raise
    complete = result.get('status') == RESULTS[command] and not (command == 'rotate' and result.get('rejected'))
    event.update(state='SUCCEEDED' if complete else 'UNKNOWN',finishedAt=timestamp())
    if event['state'] == 'SUCCEEDED':
        try: event['snapshot'] = metadata(snapshot())
        except (OSError,ValueError,KeyError,TypeError,RuntimeError,trial.TrialError):
            # The actual operation succeeded; metadata-read failure cannot reverse that fact.
            print('备份操作已完成，但未取得恢复点监测信息。',file=sys.stderr)
    publish()
    return result
