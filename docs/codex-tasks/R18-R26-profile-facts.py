#!/usr/bin/env python3
"""Synthetic PG18 cost sample only. Never activates, reconciles, or updates coverage."""
import argparse, hashlib, json, os, pathlib, re, secrets, subprocess, sys, tempfile, time
REPO=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(REPO/"scripts/local"))
import backup
import trial

class SampleComplete(Exception): pass

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",type=pathlib.Path,required=True)
    parser.add_argument("--expected-head",required=True)
    parser.add_argument("--max-tables",type=int,default=8)
    parser.add_argument("--seconds",type=int,default=30)
    args=parser.parse_args()
    head=subprocess.check_output(["git","rev-parse","HEAD"],cwd=REPO,text=True).strip()
    dirty=subprocess.check_output(["git","status","--porcelain","--untracked-files=normal"],cwd=REPO,text=True).strip()
    if head!=args.expected_head or dirty:
        parser.error("exact expected HEAD and clean checkout required")
    if not 1<=args.max_tables<=8 or not 1<=args.seconds<=30:
        parser.error("sample cap: at most eight tables and 30 seconds between SQL boundaries")
    root=args.root.resolve()
    forbidden=pathlib.Path("/home/user/mengine-preview/repo")
    if root==REPO or REPO in root.parents or root==forbidden or forbidden in root.parents:
        parser.error("new synthetic directory must be outside checkout/preview")
    trial.directory(root.parent)
    root=backup.reserve(root)
    log=root/"profile.jsonl"
    fd=os.open(log,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    completed=0
    with os.fdopen(fd,"w") as output:
        def emit(event):
            output.write(json.dumps(event,sort_keys=True)+"\n");output.flush()
        def phase(name,operation):
            started=time.monotonic()
            try:
                result=operation()
            except BaseException as error:
                emit({"phase":name,"seconds":time.monotonic()-started,
                      "ok":False,"errorType":type(error).__name__})
                raise
            emit({"phase":name,"seconds":time.monotonic()-started,"ok":True})
            return result
        emit({"phase":"identity","head":head,"synthetic":True,"activationAllowed":False})
        # Only version probes before creating a fresh synthetic cluster. No existing DB is opened.
        for command in ("initdb","pg_ctl","psql","pg_dump","pg_restore"):
            phase("probe_"+command,lambda command=command:backup.pg(command))
        source=backup.reserve(root/"synthetic-source")
        target=backup.reserve(root/"synthetic-restored")
        for folder in (source,target):
            trial.private_write(folder/"database.json",{"password":secrets.token_urlsafe(32)})
        dump=root/"synthetic.dump"
        try:
            with backup.offline_database(source,True) as (run,connection,sql):
                sql("CREATE TABLE flyway_schema_history(installed_rank integer PRIMARY KEY,version varchar(50),script varchar(1000),success boolean)")
                files=trial.api_migration_files()
                if len(files)!=178:
                    raise RuntimeError("fixed source requires 178 default migrations")
                phase("migrations",lambda:run([backup.pg("psql"),"-X",*connection,"-v","ON_ERROR_STOP=1","-1",
                    *[arg for path in files for arg in ("-f",str(path))]]))
                values=",".join("(%d,'%s','%s',true)"%(rank,path.name.split("__")[0][1:],path.name)
                                for rank,path in enumerate(files,1))
                sql("INSERT INTO flyway_schema_history VALUES "+values)
                backup.check_migrations(sql)
                phase("pg_dump",lambda:run([backup.pg("pg_dump"),*connection,
                    "--format=custom","--no-owner","--no-acl","--file",str(dump)]))
                dump.chmod(0o600)
            with backup.offline_database(target,True) as (run,connection,sql):
                phase("pg_restore",lambda:run([backup.pg("pg_restore"),*connection,
                    "--no-owner","--no-acl","--single-transaction","--exit-on-error",str(dump)]))
                profile_started=time.monotonic()
                env={**trial.clean_environment(),
                     "PGPASSWORD":trial.private_read(target/"database.json")["password"],
                     "PGCONNECT_TIMEOUT":"3","PGTZ":"UTC",
                     "PGOPTIONS":"-c statement_timeout=3500"}
                def measured_sql(query,fingerprint=False):
                    # Same COPY bytes/hash algorithm as backup.offline_database, shorter diagnostic limits.
                    command=[backup.pg("psql"),"-X",*connection,"-qAt","-v","ON_ERROR_STOP=1","-c",query]
                    with tempfile.TemporaryFile() as data, (root/"sql-private-errors.log").open("ab") as errors:
                        result=subprocess.run(command,env=env,stdout=data,stderr=errors,timeout=5)
                        if result.returncode:
                            raise RuntimeError("synthetic SQL probe failed; see private error file")
                        data.seek(0)
                        if not fingerprint:return data.read().decode().strip()
                        checksum=hashlib.sha256()
                        while chunk:=data.read(1024*1024):checksum.update(chunk)
                        return checksum.hexdigest()
                # Error file is synthetic but remains private; no SQL rows, hashes or secrets in profile.
                error_file=root/"sql-private-errors.log"
                private_fd=os.open(error_file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
                os.close(private_fd)
                def observe(event):
                    nonlocal completed
                    emit(event)
                    if not event["ok"]:
                        return  # The original SQL exception must propagate, even after the budget.
                    if event["phase"]=="table_count" and event["ok"]:
                        completed+=1
                        if completed>=args.max_tables:
                            raise SampleComplete()
                    if time.monotonic()-profile_started>=args.seconds:
                        raise SampleComplete()
                try:
                    backup.facts(measured_sql,observe)
                except SampleComplete:
                    emit({"phase":"bounded_sample_end","completedTables":completed,
                          "seconds":time.monotonic()-profile_started,
                          "fullIntegrityVerified":False,"activationAllowed":False})
                else:
                    emit({"phase":"sample_end","completedTables":completed,
                          "fullIntegrityVerified":False,"activationAllowed":False})
            emit({"phase":"clusters_stopped",
                  "sourcePidAbsent":not (source/"postgres/postmaster.pid").exists(),
                  "targetPidAbsent":not (target/"postgres/postmaster.pid").exists()})
        except BaseException as error:
            emit({"phase":"failed","errorType":type(error).__name__,"activationAllowed":False})
            return 1
    print(json.dumps({"status":"synthetic_cost_sample_only","evidence":str(log),
                      "completedTables":completed,"activationAllowed":False}))
    return 0

if __name__=="__main__":
    sys.exit(main())
