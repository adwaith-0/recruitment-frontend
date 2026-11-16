"""Test I: MCP authentication and real retrieval, directly against Azure.

1. MCP tools/list on the knowledgebase606 endpoint (Entra ID, signed-in user) -> lists knowledge_base_retrieve.
2. knowledge_base_retrieve via MCP tools/call -> real indexed passages.
3. recruitment-source-agent via the Responses API with the knowledge-base tool forced ->
   the agent's MCP call (project managed identity through recruitment-source-kb-mi) succeeds
   with documents and no HTTP 401.

Usage (from recruitment-frontend/):  ..\\.venv\\Scripts\\python agent/smoke_test.py
"""

from __future__ import annotations

import json
import sys

import requests

import settings as s


def sse_json(text: str) -> dict:
    for line in text.splitlines():
        if line.startswith("data:"):
            return json.loads(line[5:])
    return json.loads(text)


def main() -> int:
    cred = s.credential()
    failures = 0
    mcp_headers = {
        **s.bearer(cred, f"{s.SEARCH_AUDIENCE}.default"),
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }

    r = requests.post(s.MCP_ENDPOINT, headers=mcp_headers, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, timeout=60)
    tools = [t["name"] for t in sse_json(r.text).get("result", {}).get("tools", [])] if r.ok else []
    ok = r.status_code == 200 and s.MCP_TOOL_NAME in tools
    failures += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] MCP tools/list: HTTP {r.status_code} tools={tools}")

    r = requests.post(
        s.MCP_ENDPOINT,
        headers=mcp_headers,
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": s.MCP_TOOL_NAME, "arguments": {"query_variants": ["employer recruitment process"]}}},
        timeout=120,
    )
    passages = []
    if r.ok:
        for part in sse_json(r.text).get("result", {}).get("content", []):
            if part.get("type") != "text":
                continue
            try:
                value = json.loads(part["text"])
            except json.JSONDecodeError:
                continue
            items = value if isinstance(value, list) else value.get("documents", []) if isinstance(value, dict) else []
            passages += [p for p in items if isinstance(p, dict) and p.get("content")]
    ok = r.status_code == 200 and len(passages) > 0
    failures += not ok
    titles = sorted({(p.get("content", "").splitlines() or ["?"])[0] for p in passages})[:6]
    print(f"[{'PASS' if ok else 'FAIL'}] MCP knowledge_base_retrieve: HTTP {r.status_code} passages={len(passages)} e.g. {titles}")

    body = {
        "agent_reference": {"type": "agent_reference", "name": s.AGENT_NAME},
        "input": "How does employer recruitment work?",
        "tool_choice": {"type": "mcp", "server_label": s.MCP_SERVER_LABEL, "name": s.MCP_TOOL_NAME},
    }
    r = requests.post(
        f"{s.PROJECT_ENDPOINT}/openai/v1/responses",
        headers={**s.bearer(cred, "https://ai.azure.com/.default"), "Content-Type": "application/json"},
        json=body,
        timeout=180,
    )
    data = r.json() if r.content else {}
    calls = [i for i in data.get("output", []) if i.get("type") == "mcp_call"]
    docs = sum(len(json.loads(c["output"]).get("documents", [])) for c in calls if c.get("output") and not c.get("error"))
    errors = [c.get("error") for c in calls if c.get("error")]
    ok = r.status_code == 200 and calls and not errors and docs > 0
    failures += not ok
    detail = f"HTTP {r.status_code} version={data.get('agent_reference', {}).get('version')} mcp_calls={len(calls)} documents={docs} errors={errors}"
    if not r.ok:
        detail += f" error={data.get('error', {}).get('code')}"
    print(f"[{'PASS' if ok else 'FAIL'}] Agent MCP retrieval via project managed identity: {detail}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
