#!/usr/bin/env python3
"""CT-076 selected cross-JVM pairs. Run only in an authorized disposable cloud clone."""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, sys, time, uuid
import xml.etree.ElementTree as ET

SOURCE = "3e6bdc740955b06ce6f5b250b43fb600d359104a"
N = "NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions"
K = "KnowledgeIntegrationTest#ordinaryHistoricalUploadStillGetsItsParse"
T = "TableCalculationIntegrationTest#sourceAndCapabilityMustBelongToCurrentSpaceAndAttemptAndToolMustBeStarted"
PAIRS = {"native-knowledge": [N,K], "knowledge-native": [K,N],
         "native-table": [N,T], "table-native": [T,N]}
TRACKED = "apps/api/src/test/java/com/dreamcore/workspace/NativeConversationIntegrationTest.java"

def git(*args):
    return subprocess.check_output(["git",*args],text=True).strip()

def save(path, value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n")

def snapshot():
    url=os.environ.get("DATABASE_URL","")
    match=re.fullmatch(r"jdbc:postgresql://127\.0\.0\.1:([0-9]+)/dreamcore_test",url)
    if not match or os.environ.get("DATABASE_USER")!="dreamcore_test":
        raise RuntimeError("wrapper-owned database required")
    def query(sql):
        psql=str(pathlib.Path(os.environ["POSTGRES_BIN"])/"psql") if os.environ.get("POSTGRES_BIN") else "psql"
        env={**os.environ,"PGPASSWORD":os.environ["DATABASE_PASSWORD"]}
        return subprocess.check_output([psql,"-X","-qAt","-v","ON_ERROR_STOP=1",
            "-h","127.0.0.1","-p",match[1],"-U","dreamcore_test","-d","dreamcore_test",
            "-c",sql],env=env,text=True).strip()
    if query("SELECT current_database() || ':' || current_user")!="dreamcore_test:dreamcore_test":
        raise RuntimeError("database identity mismatch")
    exists=query("SELECT to_regclass('public.knowledge_runs') IS NOT NULL")=="t"
    pending=int(query("SELECT count(*) FROM knowledge_runs WHERE status IN ('QUEUED','RUNNING')")) if exists else 0
    return {"sharedPending":pending, "isolatedDatabases":int(query(
        "SELECT count(*) FROM pg_database WHERE datname LIKE 'dreamcore_isolated_test_%'"))}

def run_case(selector, step, settings, expected_head, env=None):
    if git("rev-parse","HEAD")!=expected_head or git("status","--porcelain","--untracked-files=normal"):
        raise RuntimeError("source changed before selected method")
    step.mkdir(parents=True,exist_ok=False)
    suffix="ct076-"+uuid.uuid4().hex
    argv=["./apps/api/mvnw"]
    if settings: argv+=["-s",settings]
    argv+=["-B","-f","apps/api/pom.xml","-Dtest="+selector,
           "-Dsurefire.reportNameSuffix="+suffix,"test"]
    started_ns=time.time_ns()
    with (step/"maven.log").open("w") as log:
        result=subprocess.run(argv,env=env,stdout=log,stderr=subprocess.STDOUT)
    reports=list(pathlib.Path("apps/api/target/surefire-reports").glob("TEST-*"+suffix+"*.xml"))
    suites=[]
    cases=[]
    fresh=True
    for report in reports:
        fresh=fresh and report.stat().st_mtime_ns>=started_ns
        shutil.copy2(report,step/report.name)
        xml=ET.parse(report).getroot()
        suites.append({key:xml.get(key) for key in ("name","tests","failures","errors","skipped")})
        cases.extend({"name":c.get("name"),"classname":c.get("classname"),
                      "skipped":c.find("skipped") is not None} for c in xml.findall("testcase"))
    source_unchanged=(git("rev-parse","HEAD")==expected_head and not git("status","--porcelain","--untracked-files=normal"))
    cls,method=selector.split("#",1)
    expected_class="com.dreamcore.workspace."+cls
    selected=(len(cases)==1 and cases[0]["name"]==method
              and cases[0]["classname"] in (expected_class,expected_class+"-"+suffix)
              and not cases[0]["skipped"] and fresh and source_unchanged
              and sum(int(s["tests"] or 0) for s in suites)==1
              and all(int(s["skipped"] or 0)==0 for s in suites))
    record={"selector":selector,"argv":argv,"exit":result.returncode,"surefire":suites,
            "testcases":cases,"freshReports":fresh and bool(reports),
            "sourceUnchanged":source_unchanged,"expectedHead":expected_head,
            "oneSelectedTest":selected,"reportSuffix":suffix}
    save(step/"result.json",record)
    return record

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--repo",required=True)
    p.add_argument("--out",required=True)
    p.add_argument("--phase",choices=["red","green"],required=True)
    p.add_argument("--settings")
    p.add_argument("--expected-head",required=True)
    p.add_argument("--child",choices=list(PAIRS))
    p.add_argument("--negative",choices=["token","directory","empty-password"])
    args=p.parse_args()
    repo=pathlib.Path(args.repo).resolve()
    preview=pathlib.Path("/home/user/mengine-preview/repo")
    if repo==preview or preview in repo.parents:
        raise RuntimeError("preview repository must remain untouched")
    os.chdir(repo)
    out=pathlib.Path(args.out).resolve()
    if out==repo or repo in out.parents:
        raise RuntimeError("evidence output must be outside the source checkout")
    if not re.fullmatch("[0-9a-f]{40}",args.expected_head) or git("rev-parse","HEAD")!=args.expected_head:
        raise RuntimeError("HEAD does not equal --expected-head")
    if git("status","--porcelain","--untracked-files=normal"):
        raise RuntimeError("source checkout must be clean, including untracked files")
    if args.negative:
        before=snapshot()
        env=dict(os.environ)
        if args.negative=="token": env["DREAMCORE_TEST_PG_OWNER"]="0"*64
        elif args.negative=="directory": env["DREAMCORE_TEST_PG_DATA_DIRECTORY"]="/not-wrapper-owned"
        else: env["DATABASE_PASSWORD"]=""
        record=run_case(N,out/"case",args.settings,args.expected_head,env)
        text=(out/"case"/"maven.log").read_text()
        after=snapshot()
        expected=("ownership did not match" in text if args.negative in ("token","directory")
                  else "Isolated integration tests require scripts/with-test-postgres.py" in text)
        valid=record["exit"]!=0 and record["sourceUnchanged"] and expected and before==after
        save(out/"negative.json",{"exit":record["exit"],"before":before,"after":after,
             "guardRejectedBeforeDatabaseCreation":valid})
        sys.exit(0 if valid else 1)
    if args.child:
        records=[]
        for i,selector in enumerate(PAIRS[args.child]):
            before=snapshot()
            record=run_case(selector,out/str(i+1),args.settings,args.expected_head)
            record.update(before=before,after=snapshot())
            if args.phase=="green" and selector==N:
                record["isolationVerified"]=(
                    record["after"]["sharedPending"]==before["sharedPending"]
                    and record["after"]["isolatedDatabases"]>before["isolatedDatabases"])
            save(out/str(i+1)/"result.json",record)
            records.append(record)
        save(out/"pair.json",records)
        sys.exit(0 if all(r["exit"]==0 and r["oneSelectedTest"]
                         and r.get("isolationVerified",True) for r in records) else 1)
    out.mkdir(parents=True,exist_ok=False)
    # Exact starting commit or a committed descendant; record the complete diff.
    subprocess.run(["git","merge-base","--is-ancestor",SOURCE,"HEAD"],check=True)
    diff=subprocess.check_output(["git","diff",SOURCE,"--"],text=True)
    names=git("diff","--name-only",SOURCE,"--").splitlines()
    required={TRACKED,"scripts/with-test-postgres.py",
              "apps/api/src/test/java/com/dreamcore/workspace/IsolatedTestDatabase.java"}
    valid=(not names) if args.phase=="red" else (
        required.issubset(names) and all(n in required or n.startswith("docs/codex-tasks/CT-076-") for n in names))
    if not valid:
        raise RuntimeError("unexpected source diff outside CT-076 test infrastructure")
    (out/"source.diff").write_text(diff)
    save(out/"source.json",{"source":SOURCE,"head":git("rev-parse","HEAD"),
        "tree":git("rev-parse","HEAD^{tree}"),"phase":args.phase,
        "diffSha256":hashlib.sha256(diff.encode()).hexdigest(),
        "trackedStatus":git("status","--porcelain","--untracked-files=normal"),
        "expectedHead":args.expected_head})
    overview={}
    for label in PAIRS:
        target=out/label
        target.mkdir()
        argv=[sys.executable,"scripts/with-test-postgres.py",sys.executable,
              str(pathlib.Path(__file__).resolve()),"--repo",str(repo),
              "--out",str(target),"--phase",args.phase,"--child",label,"--expected-head",args.expected_head]
        if args.settings: argv+=["--settings",args.settings]
        with (target/"wrapper.log").open("w") as log:
            code=subprocess.run(argv,stdout=log,stderr=subprocess.STDOUT).returncode
        overview[label]=code
    if args.phase=="green":
        for label,url in [("negative-no-wrapper",None),
                          ("negative-non-wrapper-url","jdbc:postgresql://192.0.2.1:9/not_wrapper")]:
            env={k:v for k,v in os.environ.items() if k not in
                 ("DATABASE_URL","DATABASE_USER","DATABASE_PASSWORD","DREAMCORE_TEST_PG_OWNER","DREAMCORE_TEST_PG_DATA_DIRECTORY")}
            if url:
                env.update(DATABASE_URL=url,DATABASE_USER="not_wrapper",
                           DATABASE_PASSWORD="synthetic-negative-not-a-secret")
            record=run_case(N,out/label,args.settings,args.expected_head,env)
            text=(out/label/"maven.log").read_text()
            valid=record["exit"]!=0 and record["sourceUnchanged"] and "Isolated integration tests require scripts/with-test-postgres.py" in text
            record["expectedGuardFailure"]=valid
            save(out/label/"result.json",record)
            overview[label]=0 if valid else 1
    if args.phase=="green":
        for mode in ("token","directory","empty-password"):
            target=out/("negative-"+mode)
            target.mkdir()
            argv=[sys.executable,"scripts/with-test-postgres.py",sys.executable,
                  str(pathlib.Path(__file__).resolve()),"--repo",str(repo),"--out",str(target),
                  "--phase","green","--negative",mode,"--expected-head",args.expected_head]
            if args.settings: argv+=["--settings",args.settings]
            with (target/"wrapper.log").open("w") as log:
                overview["negative-"+mode]=subprocess.run(argv,stdout=log,stderr=subprocess.STDOUT).returncode
    save(out/"overview.json",overview)
    expected={"native-knowledge":1,"knowledge-native":0,"native-table":1,"table-native":0}
    ok=(overview==expected) if args.phase=="red" else all(v==0 for v in overview.values())
    sys.exit(0 if ok else 1)

if __name__=="__main__":
    main()

