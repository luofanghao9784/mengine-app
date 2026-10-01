"""Owned technical logs: immutable segment anchors, bounded storage, no live-file copy/truncate."""
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import re
import stat
import threading
import uuid
import trial

RETENTION_DAYS = 30
MAX_SEGMENT_BYTES = 4 * 1024**2
MAX_TOTAL_BYTES = 128 * 1024**2
MAX_SEGMENTS = 128
NAME = re.compile(r'(service|postgres)-(\d{8}T\d{12}Z)-[0-9a-f]{12}\.log')


def now():
    return datetime.now(timezone.utc)


def anchor(name):
    match = NAME.fullmatch(name)
    if not match:
        raise trial.TrialError('技术日志目录包含未知条目，未跟随路径或删除其他文件。')
    return datetime.strptime(match[2], '%Y%m%dT%H%M%S%fZ').replace(tzinfo=timezone.utc)


def regular(path):
    value = path.lstat()
    if not stat.S_ISREG(value.st_mode) or value.st_uid != os.getuid() or value.st_mode & 0o077 or value.st_nlink != 1:
        raise trial.TrialError('技术日志必须是本人所有的0600普通文件，不允许符号链接或硬链接。')
    return value


class Logs:
    def __init__(self, root):
        self.root = trial.directory(root)
        self.directory = trial.directory(self.root / 'logs', True)
        self.lock = threading.RLock()
        self.current = {}
        self.error = None
        self.streams = []
        self.last_cleanup = None
        # Called only after the supervisor acquired its exclusive lock and before processes start.
        # Native birth time proves an upper age bound for every byte in a legacy append-only log.
        for name in ('service.log', 'postgres.log'):
            source = self.root / name
            if not source.exists() and not source.is_symlink():
                continue
            value = regular(source)
            birth = getattr(value, 'st_birthtime', None)
            if birth is None:
                source.unlink()  # Unknown original age is not renewed by this migration.
                continue
            started = datetime.fromtimestamp(min(birth, value.st_mtime, value.st_ctime), timezone.utc)
            source.rename(self.directory / self.name(name[:-4], started))
        self.cleanup()
        self.sequence = max((int(path.stem[-12:],16) for _,path,_ in self.files()), default=0)

    @staticmethod
    def name(kind, started):
        return kind + '-' + started.strftime('%Y%m%dT%H%M%S%fZ') + '-' + uuid.uuid4().hex[:12] + '.log'

    def files(self):
        trial.directory(self.directory)
        result = []
        for path in self.directory.iterdir():
            started = anchor(path.name)
            metadata = regular(path)
            if started > now():
                raise trial.TrialError('技术日志原始时间晚于当前时间，拒绝重置保留期限。')
            result.append((started, path, metadata.st_size))
        return sorted(result, key=lambda value: (value[0], int(value[1].stem[-12:],16)))

    def cleanup(self):
        with self.lock:
            current_time = now()
            rows = self.files()
            total, count = sum(row[2] for row in rows), len(rows)
            for started, path, size in rows:
                if current_time < started + timedelta(days=RETENTION_DAYS) and total <= MAX_TOTAL_BYTES and count <= MAX_SEGMENTS:
                    continue
                path.unlink()
                total -= size
                count -= 1
                for kind, current in list(self.current.items()):
                    if current == path:
                        del self.current[kind]
            self.last_cleanup = current_time

    def write(self, kind, content):
        if kind not in ('service', 'postgres'):
            raise trial.TrialError('未知技术日志类型。')
        with self.lock:
            while content:
                instant = now()
                path = self.current.get(kind)
                size = regular(path).st_size if path is not None and path.exists() else 0
                if path is None or not path.exists() or anchor(path.name).date() != instant.date() or size >= MAX_SEGMENT_BYTES:
                    self.sequence += 1
                    if self.sequence >= 16**12:
                        raise trial.TrialError('技术日志分段序号已超过上限。')
                    path = self.directory / (kind+'-'+instant.strftime('%Y%m%dT%H%M%S%fZ')+f'-{self.sequence:012x}.log')
                    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
                    os.close(fd)
                    self.current[kind], size = path, 0
                chunk, content = content[:MAX_SEGMENT_BYTES-size], content[MAX_SEGMENT_BYTES-size:]
                regular(path)
                fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
                with os.fdopen(fd, 'ab') as target:
                    target.write(chunk)
                self.cleanup()

    def pipe(self, kind):
        stream = LogPipe(self, kind)
        self.streams.append(stream)
        return stream

    def tick(self):
        if self.error:
            raise trial.TrialError('技术日志写入或保留检查失败；请检查所属私有日志目录。')
        if self.last_cleanup is None or now() - self.last_cleanup >= timedelta(seconds=60):
            self.cleanup()

    def close(self):
        for stream in self.streams:
            stream.close()
        self.cleanup()
        self.tick()


class LogPipe:
    def __init__(self, logs, kind):
        self.logs, self.kind = logs, kind
        self.reader, self.writer = os.pipe()
        self.closed = False
        self.thread = threading.Thread(target=self.collect, name='owned-' + kind + '-logs', daemon=True)
        self.thread.start()

    def fileno(self):
        return self.writer

    def collect(self):
        try:
            while True:
                content = os.read(self.reader, 65536)
                if not content:
                    break
                if self.logs.error is None:
                    try:
                        self.logs.write(self.kind, content)
                    except (OSError, ValueError, trial.TrialError):
                        self.logs.error = True
                # Continue draining until the supervisor stops its children; never block a child on a full pipe.
        finally:
            os.close(self.reader)

    def close(self):
        if self.closed:
            return
        self.closed = True
        os.close(self.writer)
        self.thread.join(timeout=10)
        if self.thread.is_alive():
            raise trial.TrialError('仍有所属进程写入日志管道，未截断或回收它的活动文件。')
