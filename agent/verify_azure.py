"""Phase 2/3 verification of the existing Azure resources used by recruitment-source-agent.

Read-only by default. With --assign-role it assigns "Search Index Data Reader" on the
search service to the Foundry project's system-assigned managed identity, but only
if that exact assignment is missing.

Usage (from recruitment-frontend/):  ..\\.venv\\Scripts\\python agent/verify_azure.py [--assign-role]

Never prints tokens, keys or connection credentials.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid

import requests

import settings as s

OK, WARN, FAIL = "PASS", "WARN", "FAIL"
results: list[tuple[str, str, str]] = []


def report(status: str, check: str, detail: str = "") -> None:
    results.append((status, check, detail))
    print(f"[{status}] {check}" + (f" - {detail}" if detail else ""))


def arm_get(cred, path: str, api_version: str):
    r = requests.get(f"{s.ARM}{path}", params={"api-version": api_version}, headers=s.bearer(cred, f"{s.ARM}/.default"), timeout=60)
    return r.status_code, (r.json() if r.content else None)


def search_call(cred, method: str, path: str, **kw):
    headers = {**s.bearer(cred, f"{s.SEARCH_AUDIENCE}.default"), "Content-Type": "application/json", **kw.pop("headers", {})}
    sep = "&" if "?" in path else "?"
    return requests.request(method, f"{s.SEARCH_ENDPOINT}/{path}{sep}api-version={s.SEARCH_API_VERSION}", headers=headers, timeout=90, **kw)


def error_text(body) -> str:
    if isinstance(body, dict):
        err = body.get("error", body)
        return f"{err.get('code', '')}: {err.get('message', '')}"[:400]
    return str(body)[:400]


def mi_role_assignments(cred, principal_id: str):
    path = f"{s.SEARCH_ID}/providers/Microsoft.Authorization/roleAssignments"
    r = requests.get(
        f"{s.ARM}{path}",
        params={"api-version": "2022-04-01", "$filter": f"principalId eq '{principal_id}'"},
        headers=s.bearer(cred, f"{s.ARM}/.default"),
        timeout=60,
    )
    r.raise_for_status()
    return r.json().get("value", [])


def assign_search_reader(cred, principal_id: str) -> None:
    role_def = f"/subscriptions/{s.SUBSCRIPTION_ID}/providers/Microsoft.Authorization/roleDefinitions/{s.ROLE_SEARCH_INDEX_DATA_READER}"
    path = f"{s.SEARCH_ID}/providers/Microsoft.Authorization/roleAssignments/{uuid.uuid4()}"
    r = requests.put(
        f"{s.ARM}{path}",
        params={"api-version": "2022-04-01"},
        headers={**s.bearer(cred, f"{s.ARM}/.default"), "Content-Type": "application/json"},
        json={"properties": {"roleDefinitionId": role_def, "principalId": principal_id, "principalType": "ServicePrincipal"}},
        timeout=60,
    )
    if r.ok:
        report(OK, "Assigned Search Index Data Reader to project managed identity")
    else:
        report(
            FAIL,
            "Role assignment failed",
            f"HTTP {r.status_code} {error_text(r.json() if r.content else r.text)}. "
            "You need Owner, User Access Administrator or Role Based Access Control Administrator on the search service.",
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--assign-role", action="store_true", help="assign Search Index Data Reader to the project MI if missing")
    args = parser.parse_args()
    cred = s.credential()

    # --- Foundry account / project / model --------------------------------------------------
    code, acct = arm_get(cred, s.ACCOUNT_ID, "2025-10-01-preview")
    if code != 200:
        report(FAIL, f"Foundry resource {s.FOUNDRY_ACCOUNT}", f"HTTP {code} {error_text(acct)}")
        return summary()
    report(OK, f"Foundry resource {s.FOUNDRY_ACCOUNT}", f"kind={acct.get('kind')} location={acct.get('location')}")

    code, proj = arm_get(cred, s.PROJECT_ID, "2025-10-01-preview")
    principal_id = (proj or {}).get("identity", {}).get("principalId") if code == 200 else None
    if code != 200:
        report(FAIL, f"Foundry project {s.FOUNDRY_PROJECT}", f"HTTP {code} {error_text(proj)}")
    elif not principal_id:
        report(FAIL, "Project system-assigned managed identity", "not enabled - enable it on the project (Identity blade)")
    else:
        report(OK, f"Foundry project {s.FOUNDRY_PROJECT}", f"managed identity principalId={principal_id}")

    code, dep = arm_get(cred, f"{s.ACCOUNT_ID}/deployments/{s.MODEL_DEPLOYMENT}", "2025-10-01-preview")
    if code != 200:
        report(FAIL, f"Model deployment {s.MODEL_DEPLOYMENT}", f"HTTP {code} {error_text(dep)}")
    else:
        props = dep.get("properties", {})
        caps = props.get("capabilities", {})
        ok = props.get("provisioningState") == "Succeeded" and caps.get("agentsV2") == "true" and caps.get("responses") == "true"
        report(
            OK if ok else FAIL,
            f"Model deployment {s.MODEL_DEPLOYMENT}",
            f"model={props.get('model', {}).get('name')}@{props.get('model', {}).get('version')} "
            f"state={props.get('provisioningState')} agentsV2={caps.get('agentsV2')} responses={caps.get('responses')}",
        )

    # --- Search service ---------------------------------------------------------------------
    code, srch = arm_get(cred, s.SEARCH_ID, "2025-05-01")
    if code != 200:
        report(FAIL, f"Search service {s.SEARCH_SERVICE}", f"HTTP {code} {error_text(srch)}")
    else:
        p = srch.get("properties", {})
        rbac = p.get("disableLocalAuth") is True or "aadOrApiKey" in (p.get("authOptions") or {})
        mode = "RBAC only (API keys disabled)" if p.get("disableLocalAuth") else f"authOptions={json.dumps(p.get('authOptions'))}"
        report(OK if rbac else FAIL, "Search role-based data-plane auth enabled", mode)

    # --- Project MI role on search ----------------------------------------------------------
    if principal_id:
        try:
            assignments = mi_role_assignments(cred, principal_id)
            has_reader = any(a["properties"]["roleDefinitionId"].lower().endswith(s.ROLE_SEARCH_INDEX_DATA_READER) for a in assignments)
            if has_reader:
                report(OK, "Project MI has Search Index Data Reader on the search service")
            elif args.assign_role:
                assign_search_reader(cred, principal_id)
            else:
                report(FAIL, "Project MI is missing Search Index Data Reader", "re-run with --assign-role")
        except requests.HTTPError as e:
            report(FAIL, "Could not list role assignments", f"HTTP {e.response.status_code}")

    # --- Knowledge base and sources ---------------------------------------------------------
    r = search_call(cred, "GET", f"knowledgebases/{s.KNOWLEDGE_BASE}")
    if r.status_code != 200:
        report(FAIL, f"Knowledge base {s.KNOWLEDGE_BASE}", f"HTTP {r.status_code} {error_text(r.json() if r.content else '')}")
        return summary()
    kb = r.json()
    attached = [k["name"] for k in kb.get("knowledgeSources", [])]
    missing = [k for k in s.KNOWLEDGE_SOURCES if k not in attached]
    report(OK if not missing else FAIL, f"Knowledge base {s.KNOWLEDGE_BASE}", f"sources={attached} outputMode={kb.get('outputMode')}")

    for name in s.KNOWLEDGE_SOURCES:
        r = search_call(cred, "GET", f"knowledgesources/{name}")
        if r.status_code != 200:
            report(FAIL, f"Knowledge source {name}", f"HTTP {r.status_code}")
            continue
        ks = r.json()
        params = ks.get("azureBlobParameters") or {}
        index = (params.get("createdResources") or {}).get("index")
        st = search_call(cred, "GET", f"knowledgesources/{name}/status").json()
        last = st.get("lastSynchronizationState") or {}
        errors = last.get("errors") or []
        count = None
        if index:
            cr = search_call(cred, "GET", f"indexes/{index}/docs/$count")
            count = int(cr.text) if cr.ok and cr.text.strip().isdigit() else None
        ok = st.get("synchronizationStatus") == "active" and not errors and (count or 0) > 0
        report(
            OK if ok else FAIL,
            f"Knowledge source {name}",
            f"container={params.get('containerName')} status={st.get('synchronizationStatus')} "
            f"lastSyncErrors={len(errors)} indexedChunks={count}",
        )

    # --- MCP endpoint reachable with Entra ID (as the signed-in user) ------------------------
    r = requests.post(
        s.MCP_ENDPOINT,
        headers={**s.bearer(cred, f"{s.SEARCH_AUDIENCE}.default"), "Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        timeout=60,
    )
    tools = []
    if r.ok:
        for line in r.text.splitlines():
            if line.startswith("data:"):
                tools = [t["name"] for t in json.loads(line[5:]).get("result", {}).get("tools", [])]
    report(OK if s.MCP_TOOL_NAME in tools else FAIL, "MCP tools/list (Entra ID, signed-in user)", f"HTTP {r.status_code} tools={tools}")

    # --- Project connection -----------------------------------------------------------------
    code, conn = arm_get(cred, f"{s.PROJECT_ID}/connections/{s.MCP_CONNECTION_NAME}", s.CONNECTIONS_API_VERSION)
    if code == 404:
        report(WARN, f"Connection {s.MCP_CONNECTION_NAME}", "not created yet - run agent/create_connection.py")
    elif code == 200:
        p = conn.get("properties", {})
        ok = (
            p.get("category") == "RemoteTool"
            and p.get("authType") == "ProjectManagedIdentity"
            and p.get("target") == s.MCP_ENDPOINT
            and (p.get("audience") or "").rstrip("/") == s.SEARCH_AUDIENCE.rstrip("/")
        )
        report(OK if ok else FAIL, f"Connection {s.MCP_CONNECTION_NAME}", f"category={p.get('category')} auth={p.get('authType')} audience={p.get('audience')}")
    else:
        report(FAIL, f"Connection {s.MCP_CONNECTION_NAME}", f"HTTP {code}")

    return summary()


def summary() -> int:
    failed = [r for r in results if r[0] == FAIL]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks without failures.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
