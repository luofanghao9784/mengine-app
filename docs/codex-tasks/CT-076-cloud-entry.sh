#!/usr/bin/env bash
# Only for the General Agent's already authorized Linux cloud execution endpoint.
# Default prepare does not run tests. Existing 15 executions must not be repeated blindly.
set -euo pipefail
[[ $(uname -s) == Linux ]] || { echo 'Linux cloud endpoint required; do not run on the local Mac.' >&2; exit 2; }
[[ -d /home/user && $(id -u) != 0 ]] || { echo 'Run as the authorized cloud user with /home/user available.' >&2; exit 2; }
mode=${CT076_MODE:-prepare}
case "$mode" in prepare|harness|knowledge|table|native-knowledge|knowledge-native|native-table|table-native) ;; *) echo 'Unknown CT076_MODE' >&2; exit 2;; esac
revision=${CT076_REVISION:-merge}
head_sha=3e450e72660eda88498d4719e17f84a7a335f380
merge_sha=3e6bdc740955b06ce6f5b250b43fb600d359104a
base_sha=d945af9235b07ecfbfc4990bd6c4ebae4324b769
case "$revision" in merge) expected=$merge_sha;; head) expected=$head_sha;; *) exit 2;; esac
export CT076_ROOT
CT076_ROOT=$(mktemp -d /home/user/ct076-diagnostic.XXXXXXXX)
printf 'Evidence directory: %s\n' "$CT076_ROOT"
export CT076_MODE=$mode
export CI=true NODE_ENV=test
export MAVEN_USER_HOME="$CT076_ROOT/maven-home"
export MAVEN_OPTS="-Dmaven.repo.local=$CT076_ROOT/maven-repository"
export npm_config_cache="$CT076_ROOT/npm-cache"
mkdir -p "$CT076_ROOT/results"
record() {
  local label=$1 rc=0
  shift
  local dest="$CT076_ROOT/results/$label"
  mkdir "$dest"
  printf '%q ' "$@" > "$dest/command.txt"
  printf '\n' >> "$dest/command.txt"
  date -u +%FT%TZ > "$dest/started_at.txt"
  "$@" > "$dest/output.log" 2>&1 || rc=$?
  printf '%s\n' "$rc" > "$dest/exit-code.txt"
  date -u +%FT%TZ > "$dest/completed_at.txt"
  if [[ -d "$CT076_ROOT/repo/apps/api/target/surefire-reports" ]]; then
    cp -a "$CT076_ROOT/repo/apps/api/target/surefire-reports" "$dest/surefire"
  fi
  printf '%s exit=%s\n' "$label" "$rc"
  return "$rc"
}
record java java -version
grep -Eq 'version "21[.\"]' "$CT076_ROOT/results/java/output.log" || { echo 'Java21 required' >&2; exit 2; }
record node node --version
grep -qx v24.20.0 "$CT076_ROOT/results/node/output.log" || { echo 'Place Node24.20.0 on PATH first.' >&2; exit 2; }
export POSTGRES_BIN=${POSTGRES_BIN:-/usr/lib/postgresql/18/bin}
for tool in initdb pg_ctl psql; do
  record "postgres-$tool" "$POSTGRES_BIN/$tool" --version
  grep -Eq 'PostgreSQL\) 18[.]' "$CT076_ROOT/results/postgres-$tool/output.log" || exit 2
done
record clone git clone --no-checkout https://github.com/luofanghao9784/mengine-app.git "$CT076_ROOT/repo"
cd "$CT076_ROOT/repo"
record fetch git fetch --no-tags origin "$base_sha" "$head_sha" "$merge_sha"
[[ $(git show -s --format=%P "$merge_sha") == "$base_sha $head_sha" ]] || exit 2
record checkout git checkout --detach "$expected"
[[ $(git rev-parse HEAD) == "$expected" ]] || exit 2
git rev-parse HEAD > "$CT076_ROOT/results/actual-checkout-sha.txt"
git status --short > "$CT076_ROOT/results/source-status.txt"
[[ ! -s "$CT076_ROOT/results/source-status.txt" ]] || exit 2
if [[ "$mode" == prepare ]]; then
  echo 'Prepared only; no tests executed. Existing results are already published in Issue #89.'
  exit 0
fi
if [[ -n ${CT076_MAVEN_SETTINGS:-} ]]; then [[ -r "$CT076_MAVEN_SETTINGS" ]] || exit 2; fi
record maven-runtime ./apps/api/mvnw --version
grep -Eq 'Java version: 21[.,]' "$CT076_ROOT/results/maven-runtime/output.log" || { echo 'The Maven wrapper must also use Java21.' >&2; exit 2; }
record engine-install npm ci --prefix engine
record engine-build npm run build --prefix engine
cat > "$CT076_ROOT/sequence.py" <<'PY'
import json, os, pathlib, shutil, subprocess, time, xml.etree.ElementTree as E
p=pathlib.Path(os.environ['CT076_ROOT']);cwd=p/'repo';dest=p/'results'/'classes';dest.mkdir()
n='NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions'
k='KnowledgeIntegrationTest#ordinaryHistoricalUploadStillGetsItsParse'
t='TableCalculationIntegrationTest#sourceAndCapabilityMustBelongToCurrentSpaceAndAttemptAndToolMustBeStarted'
orders={'harness':['TaskContextHarnessIT'],'knowledge':[k+'+supersededAutomaticSceneVersionDoesNotStarveCurrentParse+repeatedWorkerCrashesStopAfterThreeAttempts'],'table':[t],'native-knowledge':[n,k],'knowledge-native':[k,n],'native-table':[n,t],'table-native':[t,n]}
env=os.environ.copy();env['PGPASSWORD']=env['DATABASE_PASSWORD']
port=env['DATABASE_URL'].split(':')[-1].split('/')[0]
psql=[str(pathlib.Path(env['POSTGRES_BIN'])/'psql'),'-X','-h','127.0.0.1','-p',port,'-U',env['DATABASE_USER'],'-d','dreamcore_test','-At','-v','ON_ERROR_STOP=1']
def snapshot(place,name):
    probe=subprocess.run(psql+['-c',"SELECT to_regclass('public.knowledge_runs') IS NOT NULL"],env=env,check=True,capture_output=True,text=True)
    if probe.stdout.strip()=='f':
        (place/(name+'.json')).write_text('{"schemaNotMigrated":true,"queue":[]}');return
    sql="SELECT coalesce(json_agg(q),'[]') FROM (SELECT r.id,r.tenant_id,r.workspace_id,r.material_id,r.version_id,r.requested_by,r.status,r.attempts,EXISTS(SELECT 1 FROM active_materials m WHERE m.id=r.material_id AND m.tenant_id=r.tenant_id AND m.workspace_id=r.workspace_id) AS material_active,EXISTS(SELECT 1 FROM material_versions v WHERE v.id=r.version_id AND v.tenant_id=r.tenant_id AND v.workspace_id=r.workspace_id AND v.material_id=r.material_id) AS version_exists,library_mask(r.requested_by,r.tenant_id,'MATERIAL',r.material_id) AS actor_material_mask FROM knowledge_runs r WHERE r.status IN ('QUEUED','RUNNING') ORDER BY r.created_at,r.id) q"
    z=subprocess.run(psql+['-c',sql],env=env,check=True,capture_output=True,text=True)
    (place/(name+'.json')).write_text(json.dumps(json.loads(z.stdout),indent=2))
failed=False
for i,selector in enumerate(orders[os.environ['CT076_MODE']]):
    place=dest/(str(i+1)+'-'+selector.split('#')[0]);place.mkdir()
    snapshot(place,'before')
    reports=cwd/'apps/api/target/surefire-reports'
    if reports.exists():shutil.rmtree(reports) # Previous command reports already archived.
    cmd=['./apps/api/mvnw']
    if os.environ.get('CT076_MAVEN_SETTINGS'):cmd+=['-s',os.environ['CT076_MAVEN_SETTINGS']]
    cmd+=['-B','-f','apps/api/pom.xml','-Dtest='+selector,'test']
    (place/'argv.json').write_text(json.dumps(cmd));start=time.time()
    with (place/'output.log').open('w') as log:z=subprocess.run(cmd,cwd=cwd,stdout=log,stderr=subprocess.STDOUT)
    (place/'exit-code.txt').write_text(str(z.returncode)+'\n')
    if reports.exists():shutil.copytree(reports,place/'surefire')
    summary=[]
    if reports.exists():
        for f in reports.glob('TEST-*.xml'):
            r=E.parse(f).getroot();summary.append({key:r.get(key) for key in ['name','tests','failures','errors','skipped','time']})
    (place/'result.json').write_text(json.dumps({'selector':selector,'exit':z.returncode,'start':start,'end':time.time(),'summary':summary},indent=2))
    snapshot(place,'after')
    failed|=z.returncode!=0
    print(selector,'exit='+str(z.returncode),json.dumps(summary),flush=True)
raise SystemExit(1 if failed else 0)
PY
# A bounded diagnostic, not a change to the workflow's 90-minute timeout.
# The repository wrapper owns initdb/start/stop and removes its disposable cluster.
record diagnostic timeout --signal=TERM --kill-after=20s 600s python3 scripts/with-test-postgres.py python3 "$CT076_ROOT/sequence.py"
record diff-check git diff --check
git status --short > "$CT076_ROOT/results/final-source-status.txt"
[[ ! -s "$CT076_ROOT/results/final-source-status.txt" ]] || exit 2
