#!/usr/bin/env python3
"""Run one command against an owned, disposable PostgreSQL cluster. Never reuse a running DB."""
import os
import pathlib
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile


def binary(name):
    directory = os.environ.get("POSTGRES_BIN")
    resolved = str(pathlib.Path(directory) / name) if directory else shutil.which(name)
    if not resolved or not pathlib.Path(resolved).is_file():
        raise SystemExit(f"Missing {name}; install PostgreSQL 18 and set POSTGRES_BIN if needed.")
    return resolved


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 scripts/with-test-postgres.py COMMAND [ARG ...]")
    initdb, pg_ctl, psql = (binary(name) for name in ("initdb", "pg_ctl", "psql"))
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    with tempfile.TemporaryDirectory(prefix="dreamcore-test-pg-") as temp:
        root = pathlib.Path(temp)
        data = root / "data"
        password = secrets.token_urlsafe(32)
        secret = root / "password"
        secret.write_text(password)
        secret.chmod(0o600)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        with (root / "setup.log").open("w") as log:
            subprocess.run([initdb, "-D", str(data), "-U", "dreamcore_test", "--pwfile", str(secret), "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"], check=True, stdout=log, stderr=log)
            started = False
            try:
                subprocess.run([pg_ctl, "-D", str(data), "-l", str(root / "postgres.log"), "-o", f"-h 127.0.0.1 -p {port} -k {root}", "-w", "start"], check=True, stdout=log, stderr=log)
                started = True
                subprocess.run([psql, "-h", "127.0.0.1", "-p", str(port), "-U", "dreamcore_test", "-d", "postgres", "-c", "CREATE DATABASE dreamcore_test"], env={**os.environ, "PGPASSWORD": password}, check=True, stdout=log, stderr=log)
                env = {**{k: v for k, v in os.environ.items() if not k.startswith("AGENT_")}, "DATABASE_URL": f"jdbc:postgresql://127.0.0.1:{port}/dreamcore_test", "DATABASE_USER": "dreamcore_test", "DATABASE_PASSWORD": password,
                       "SPRING_PROFILES_ACTIVE": "local", "MATERIAL_STORAGE_ROOT": str(root / "objects"), "INVITATION_DELIVERY": "local", "INVITATION_OUTBOX": str(root / "invitations")}
                print("Running against an isolated temporary PostgreSQL database.", flush=True)
                result = subprocess.run(sys.argv[1:], env=env)
                return result.returncode
            finally:
                if started:
                    subprocess.run([pg_ctl, "-D", str(data), "-m", "immediate", "-w", "stop"], check=True, stdout=log, stderr=log)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
