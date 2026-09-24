#!/usr/bin/env python3
"""Synthetic real-process proof: CLI bootstrap, durable identity/session and secure default cookie."""
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

JAR = "apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar"


def main():
    with tempfile.TemporaryDirectory(prefix="dreamcore-identity-proof-") as temporary:
        root = Path(temporary)
        password = secrets.token_urlsafe(24)
        secret = root / "password"
        secret.write_text(password)
        secret.chmod(0o600)
        email = "restart-platform@example.test"
        env = {**os.environ, "BOOTSTRAP_EMAIL": email, "BOOTSTRAP_PASSWORD_FILE": str(secret)}
        log_path = root / "api.log"
        with log_path.open("w") as log:
            command = ["java", "-jar", JAR, "--bootstrap-admin"]
            assert subprocess.run(command, env=env, stdout=log, stderr=log, timeout=45).returncode == 0, "CLI bootstrap failed"
            assert subprocess.run(command, env=env, stdout=log, stderr=log, timeout=45).returncode != 0, "Repeated bootstrap was accepted"
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                port = listener.getsockname()[1]
            base = f"http://127.0.0.1:{port}"
            jar = http.cookiejar.CookieJar()
            client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

            def call(method, path, body=None, csrf=True, use_client=client):
                headers = {"Content-Type": "application/json"}
                if method != "GET" and csrf:
                    _, token, _ = call("GET", "/api/v1/auth/csrf", use_client=use_client)
                    headers[token["headerName"]] = token["token"]
                request = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
                try:
                    response = use_client.open(request, timeout=5)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    raw = response.read()
                    return response.status, json.loads(raw) if raw else None, response.headers

            def start(secure=False):
                # No engine is required for authentication; health only checks this service and DB.
                process_env = {**env, "SPRING_PROFILES_ACTIVE": ""} if secure else env
                process = subprocess.Popen(["java", "-jar", JAR, f"--server.port={port}", "--server.address=127.0.0.1"], env=process_env, stdout=log, stderr=log)
                try:
                    for _ in range(120):
                        assert process.poll() is None, "API exited during startup"
                        try:
                            if call("GET", "/actuator/health")[0] == 200:
                                return process
                        except (OSError, urllib.error.URLError):
                            pass
                        time.sleep(0.2)
                    raise AssertionError("API readiness timeout")
                except BaseException:
                    stop(process)
                    raise

            def stop(process):
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

            process = start()
            try:
                assert call("POST", "/api/v1/auth/login", {"email": email, "password": password})[0] == 200
                code, created, _ = call("POST", "/api/platform-admin/v1/tenants", {"requestId": str(uuid.uuid4()), "name": "重启验证合成企业", "adminEmail": "restart-admin@example.test"})
                assert code == 201
                tenant_path = "/api/platform-admin/v1/tenants/" + created["tenant"]["id"]
                tenant_id = created["tenant"]["id"]
                admin_path = "/api/tenant-admin/v1/tenants/" + tenant_id
                admin_client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                member_client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

                def join_invitation(invitation_id, account_email, target):
                    invitation = json.loads((Path(env["INVITATION_OUTBOX"]) / (invitation_id + ".json")).read_text())
                    assert call("POST", "/api/v1/auth/invitations/accept", {"token": invitation["token"], "displayName": "重启合成成员", "password": password}, use_client=target)[0] == 200
                    return call("POST", "/api/v1/auth/login", {"email": account_email, "password": password}, use_client=target)[1]["account"]["id"]

                join_invitation(created["invitation"]["id"], "restart-admin@example.test", admin_client)
                code, invited, _ = call("POST", admin_path + "/invitations", {"requestId": str(uuid.uuid4()), "email": "restart-member@example.test"}, use_client=admin_client)
                assert code == 201
                member_id = join_invitation(invited["id"], "restart-member@example.test", member_client)
                code, space, _ = call("POST", admin_path + "/workspaces", {"requestId": str(uuid.uuid4()), "name": "重启共享空间"}, use_client=admin_client)
                assert code == 201
                space_path = admin_path + "/workspaces/" + space["id"]
                grant = {"requestId": str(uuid.uuid4()), "expectedVersion": 0, "enabled": True}
                assert call("POST", space_path + "/members/" + member_id, grant, use_client=admin_client)[0] == 200
                assert call("POST", admin_path + "/members/" + member_id + "/status", {"requestId": str(uuid.uuid4()), "expectedVersion": 0, "status": "DISABLED"}, use_client=admin_client)[0] == 200
                assert call("POST", admin_path + "/settings", {"requestId": str(uuid.uuid4()), "expectedVersion": 0, "name": "重启后保留的企业名称"}, use_client=admin_client)[0] == 200
                assert call("POST", tenant_path + "/status", {"requestId": str(uuid.uuid4()), "expectedVersion": 0, "status": "SUSPENDED"})[0] == 200
                assert len(call("GET", "/api/platform-admin/v1/tenants")[1]) == 1
            finally:
                stop(process)
            process = start()
            try:
                status, me, _ = call("GET", "/api/v1/me")
                assert status == 200 and me["platformAdmin"], "Session did not survive process restart"
                assert len(call("GET", "/api/platform-admin/v1/tenants")[1]) == 1, "Tenant did not persist"
                detail = call("GET", tenant_path)[1]
                assert detail["tenant"]["status"] == "SUSPENDED" and detail["version"] == 1
                assert detail["initialAdminInvitation"]["id"] == created["invitation"]["id"]
                assert [r["action"] for r in call("GET", tenant_path + "/records")[1]] == ["TENANT_SUSPEND", "TENANT_CREATE"]
                assert call("GET", admin_path + "/overview", use_client=admin_client)[0] == 403
                assert call("POST", tenant_path + "/status", {"requestId": str(uuid.uuid4()), "expectedVersion": 1, "status": "ACTIVE"})[0] == 200
                overview = call("GET", admin_path + "/overview", use_client=admin_client)[1]
                assert overview["name"] == "重启后保留的企业名称" and overview["version"] == 1
                assert overview["disabledMemberCount"] == 1 and overview["sharedWorkspaceCount"] == 1
                assert call("GET", space_path, use_client=admin_client)[1]["version"] == 1
                assert call("GET", space_path + "/members", use_client=admin_client)[1][0]["accountId"] == member_id
                assert call("GET", "/api/v1/tenants/" + tenant_id + "/context", use_client=member_client)[0] == 403
                assert call("POST", space_path + "/members/" + member_id, grant, use_client=admin_client)[1]["version"] == 1, "Idempotency key did not survive restart"
                assert call("POST", admin_path + "/members/" + member_id + "/status", {"requestId": str(uuid.uuid4()), "expectedVersion": 1, "status": "ACTIVE"}, use_client=admin_client)[0] == 200
                assert len(call("GET", "/api/v1/tenants/" + tenant_id + "/context", use_client=member_client)[1]["workspaces"]) == 2
                management_actions = [r["action"] for r in call("GET", admin_path + "/records", use_client=admin_client)[1]]
                assert management_actions.count("WORKSPACE_GRANT") == 1 and "MEMBER_DISABLE" in management_actions and "TENANT_RENAME" in management_actions
                assert call("POST", "/api/v1/auth/logout")[0] == 204
                assert call("GET", "/api/v1/me")[0] == 401
            finally:
                stop(process)
            # The production cookie policy must retain Secure even behind an HTTP upstream.
            process = start(secure=True)
            try:
                anonymous = urllib.request.build_opener()
                status, _, headers = call("GET", "/api/v1/auth/csrf", use_client=anonymous)
                assert status == 200
                cookie = headers["Set-Cookie"]
                assert all(flag in cookie for flag in ("Secure", "HttpOnly", "SameSite=Lax", "DREAMCORE_SESSION="))
            finally:
                stop(process)
        logs = log_path.read_text()
        assert password not in logs, "Password leaked in API logs"
        for file in Path(env["INVITATION_OUTBOX"]).glob("*.json"):
            assert json.loads(file.read_text())["token"] not in logs, "Invitation token leaked in logs"
        print("PASS: CLI bootstrap/repeat rejection, tenant status/settings, initial invitation, member status, shared grants, idempotency, audit and session persistence across restart, logout, secure cookie and log redaction.")


if __name__ == "__main__":
    main()
