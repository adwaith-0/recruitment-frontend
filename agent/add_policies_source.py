"""Add the `policesshared` blob container to knowledgebase606 as a third knowledge source.

Steps (idempotent; safe to re-run):
  1. Create/update knowledge source `company-policies-source` (kind azureBlob) over ragstorage4u/policesshared.
     Keyless: the search service's managed identity reads the blobs (Storage Blob Data Reader) and calls
     the embedding model (Cognitive Services OpenAI User). No storage or model keys are used.
  2. Wait until the first ingestion finishes and report indexed chunk count and errors.
  3. With --attach: add the source to knowledgebase606 (other sources are kept unchanged).

Usage (from recruitment-frontend/):  ..\\.venv\\Scripts\\python agent/add_policies_source.py [--attach]
"""

from __future__ import annotations

import argparse
import sys
import time

import requests

import settings as s

SOURCE_NAME = "company-policies-source"
CONTAINER = "policesshared"
STORAGE_ID = (
    f"/subscriptions/{s.SUBSCRIPTION_ID}/resourceGroups/{s.RESOURCE_GROUP}"
    f"/providers/Microsoft.Storage/storageAccounts/{s.STORAGE_ACCOUNT}"
)


def call(cred, method, path, **kw):
    headers = {**s.bearer(cred, f"{s.SEARCH_AUDIENCE}.default"), "Content-Type": "application/json", **kw.pop("headers", {})}
    sep = "&" if "?" in path else "?"
    return requests.request(method, f"{s.SEARCH_ENDPOINT}/{path}{sep}api-version={s.SEARCH_API_VERSION}", headers=headers, timeout=120, **kw)


def fail(r, what):
    body = r.json() if r.content else {}
    err = body.get("error", {})
    print(f"{what} failed: HTTP {r.status_code} {err.get('code', '')}: {err.get('message', r.text[:400])}")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--attach", action="store_true", help="attach the source to the knowledge base after indexing succeeds")
    parser.add_argument("--timeout", type=int, default=900, help="seconds to wait for ingestion")
    args = parser.parse_args()
    cred = s.credential()

    body = {
        "name": SOURCE_NAME,
        "kind": "azureBlob",
        "description": "Apprenticeship Connect company policies (complaints, data protection, equality, health and safety, Prevent, privacy, plagiarism and related policies).",
        "azureBlobParameters": {
            # Managed-identity connection: no account key.
            "connectionString": f"ResourceId={STORAGE_ID};",
            "containerName": CONTAINER,
            "folderPath": "",
            "isADLSGen2": False,
            "ingestionParameters": {
                "disableImageVerbalization": True,
                "contentExtractionMode": "minimal",
                "embeddingModel": {
                    "kind": "azureOpenAI",
                    "azureOpenAIParameters": {
                        "resourceUri": f"https://{s.FOUNDRY_ACCOUNT}.openai.azure.com",
                        "deploymentId": "text-embedding-3-small",
                        "modelName": "text-embedding-3-small",
                    },
                },
            },
        },
    }
    r = call(cred, "PUT", f"knowledgesources/{SOURCE_NAME}", json=body)
    if r.status_code not in (200, 201, 204):
        return fail(r, "Create knowledge source")
    print(f"Knowledge source '{SOURCE_NAME}' created/updated (HTTP {r.status_code}).")

    ks = call(cred, "GET", f"knowledgesources/{SOURCE_NAME}").json()
    created = (ks.get("azureBlobParameters") or {}).get("createdResources") or {}
    index = created.get("index")
    print(f"Created resources: {created}")

    deadline = time.time() + args.timeout
    status = {}
    count = 0
    while time.time() < deadline:
        status = call(cred, "GET", f"knowledgesources/{SOURCE_NAME}/status").json()
        last = status.get("lastSynchronizationState") or {}
        current = status.get("currentSynchronizationState")
        if index:
            cr = call(cred, "GET", f"indexes/{index}/docs/$count")
            count = int(cr.text) if cr.ok and cr.text.strip().isdigit() else 0
        print(
            f"  status={status.get('synchronizationStatus')} running={'yes' if current else 'no'} "
            f"processed={last.get('itemsUpdatesProcessed')} failed={last.get('itemsUpdatesFailed')} chunks={count}"
        )
        if last and not current:
            break
        time.sleep(15)

    last = status.get("lastSynchronizationState") or {}
    errors = last.get("errors") or []
    for e in errors[:5]:
        print(f"  ERROR: {str(e)[:300]}")
    if errors or count == 0:
        print("Ingestion did not complete cleanly; the knowledge base was NOT changed.")
        return 1
    print(f"Ingestion complete: {count} chunks indexed in {index}.")

    if not args.attach:
        print("Re-run with --attach to add it to the knowledge base.")
        return 0

    r = call(cred, "GET", f"knowledgebases/{s.KNOWLEDGE_BASE}")
    if not r.ok:
        return fail(r, "Read knowledge base")
    kb = r.json()
    etag = kb.pop("@odata.etag", None)
    kb.pop("@odata.context", None)
    names = [k["name"] for k in kb.get("knowledgeSources", [])]
    if SOURCE_NAME in names:
        print(f"'{SOURCE_NAME}' is already attached to {s.KNOWLEDGE_BASE}: {names}")
        return 0
    kb["knowledgeSources"].append({"name": SOURCE_NAME})
    r = call(cred, "PUT", f"knowledgebases/{s.KNOWLEDGE_BASE}", json=kb, headers={"If-Match": etag} if etag else {})
    if r.status_code not in (200, 201, 204):
        return fail(r, "Update knowledge base")
    after = [k["name"] for k in call(cred, "GET", f"knowledgebases/{s.KNOWLEDGE_BASE}").json().get("knowledgeSources", [])]
    print(f"Knowledge base {s.KNOWLEDGE_BASE} sources: {after}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
