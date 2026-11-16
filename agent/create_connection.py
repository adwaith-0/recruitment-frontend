"""Phase 3: create (or update in place) the RemoteTool connection `recruitment-source-kb-mi`.

Uses the documented ARM call for a Foundry IQ MCP connection authenticated with the
project's managed identity (Microsoft Learn: "Connect Foundry IQ to Foundry Agent Service").
No keys, anonymous auth or hardcoded tokens: the Foundry Agent Service obtains a token for
https://search.azure.com/ as the project's system-assigned managed identity at run time.

Usage (from recruitment-frontend/):  ..\\.venv\\Scripts\\python agent/create_connection.py
"""

from __future__ import annotations

import sys

import requests

import settings as s


def main() -> int:
    if s.MCP_CONNECTION_NAME in s.FORBIDDEN_CONNECTIONS:
        print(f"Refusing to modify {s.MCP_CONNECTION_NAME}: it is the faulty Custom Keys connection.")
        return 1

    cred = s.credential()
    url = f"{s.ARM}{s.PROJECT_ID}/connections/{s.MCP_CONNECTION_NAME}"
    headers = {**s.bearer(cred, f"{s.ARM}/.default"), "Content-Type": "application/json"}
    body = {
        "name": s.MCP_CONNECTION_NAME,
        "type": "Microsoft.MachineLearningServices/workspaces/connections",
        "properties": {
            "authType": "ProjectManagedIdentity",
            "category": "RemoteTool",
            "target": s.MCP_ENDPOINT,
            "isSharedToAll": True,
            "audience": s.SEARCH_AUDIENCE,
            "metadata": {"ApiType": "Azure"},
        },
    }
    r = requests.put(url, params={"api-version": s.CONNECTIONS_API_VERSION}, headers=headers, json=body, timeout=60)
    if not r.ok:
        detail = r.json().get("error", {}) if r.content else {}
        print(f"Connection create failed: HTTP {r.status_code} {detail.get('code', '')}: {detail.get('message', r.text[:300])}")
        if r.status_code == 403:
            print("Required: the Foundry Project Manager (formerly Azure AI Project Manager) role on the Foundry resource.")
        return 1

    # Read it back and verify what Azure actually stored.
    g = requests.get(url, params={"api-version": s.CONNECTIONS_API_VERSION}, headers=headers, timeout=60)
    g.raise_for_status()
    p = g.json().get("properties", {})
    print(f"Connection: {g.json().get('name')}")
    print(f"  id:        {g.json().get('id')}")
    for key in ("category", "authType", "target", "audience", "isSharedToAll"):
        print(f"  {key + ':':<10} {p.get(key)}")
    ok = p.get("category") == "RemoteTool" and p.get("authType") == "ProjectManagedIdentity" and p.get("target") == s.MCP_ENDPOINT
    print("Verified." if ok else "WARNING: stored connection does not match the requested configuration.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
