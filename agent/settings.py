"""Shared, non-secret settings for the Foundry provisioning scripts.

Values come from environment variables, falling back to recruitment-frontend/.env
(parsed here so no python-dotenv dependency is needed). Nothing in this module
holds or prints credentials: every script authenticates with Microsoft Entra ID
through DefaultAzureCredential (your `az login` session locally).
"""

from __future__ import annotations

import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
AGENT_DIR = Path(__file__).resolve().parent


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(APP_DIR / ".env")


def env(name: str, default: str) -> str:
    return (os.environ.get(name) or default).strip()


SUBSCRIPTION_ID = env("AZURE_SUBSCRIPTION_ID", "10c4eebb-b707-4290-b8b7-44510debbb67")
RESOURCE_GROUP = env("AZURE_RESOURCE_GROUP", "rg-adwaithakumar210-3095")
FOUNDRY_ACCOUNT = env("FOUNDRY_ACCOUNT_NAME", "recruitment-ai-lab-resource")
FOUNDRY_PROJECT = env("FOUNDRY_PROJECT_NAME", "recruitment-ai-lab")
PROJECT_ENDPOINT = env(
    "FOUNDRY_PROJECT_ENDPOINT",
    "https://recruitment-ai-lab-resource.services.ai.azure.com/api/projects/recruitment-ai-lab",
).rstrip("/")
MODEL_DEPLOYMENT = env("FOUNDRY_MODEL_DEPLOYMENT", "gpt-5.6-luna")
AGENT_NAME = env("FOUNDRY_AGENT_NAME", "recruitment-source-agent")

SEARCH_SERVICE = env("AZURE_SEARCH_SERVICE_NAME", "recruitment-ai-lab-srch-svvg")
SEARCH_ENDPOINT = env("AZURE_SEARCH_ENDPOINT", f"https://{SEARCH_SERVICE}.search.windows.net").rstrip("/")
KNOWLEDGE_BASE = env("AZURE_SEARCH_KNOWLEDGE_BASE", "knowledgebase606")
KNOWLEDGE_SOURCES = [
    s.strip()
    for s in env("AZURE_SEARCH_KNOWLEDGE_SOURCES", "employer-guidance-source,apprentice-guidance-source,company-policies-source").split(",")
    if s.strip()
]
# Documented in "Connect Foundry IQ to Foundry Agent Service" (Microsoft Learn).
SEARCH_API_VERSION = env("AZURE_SEARCH_API_VERSION", "2026-08-01-preview")
STORAGE_ACCOUNT = env("AZURE_STORAGE_ACCOUNT", "ragstorage4u")

MCP_CONNECTION_NAME = env("FOUNDRY_MCP_CONNECTION_NAME", "recruitment-source-kb-mi")
MCP_SERVER_LABEL = "knowledge-base"
MCP_TOOL_NAME = "knowledge_base_retrieve"
MCP_ENDPOINT = f"{SEARCH_ENDPOINT}/knowledgebases/{KNOWLEDGE_BASE}/mcp?api-version={SEARCH_API_VERSION}"
SEARCH_AUDIENCE = "https://search.azure.com/"

# ARM api-version for project connections, as documented for ProjectManagedIdentity connections.
CONNECTIONS_API_VERSION = env("FOUNDRY_CONNECTIONS_API_VERSION", "2025-10-01-preview")

# Connections that must never be used by the new agent.
FORBIDDEN_CONNECTIONS = {"kb-knowledgebase606-5zq0p"}

ARM = "https://management.azure.com"
ACCOUNT_ID = (
    f"/subscriptions/{SUBSCRIPTION_ID}/resourceGroups/{RESOURCE_GROUP}"
    f"/providers/Microsoft.CognitiveServices/accounts/{FOUNDRY_ACCOUNT}"
)
PROJECT_ID = f"{ACCOUNT_ID}/projects/{FOUNDRY_PROJECT}"
SEARCH_ID = (
    f"/subscriptions/{SUBSCRIPTION_ID}/resourceGroups/{RESOURCE_GROUP}"
    f"/providers/Microsoft.Search/searchServices/{SEARCH_SERVICE}"
)

# Built-in role definition IDs (stable across tenants).
ROLE_SEARCH_INDEX_DATA_READER = "1407120a-92aa-4202-b7e9-c0e197c71c8f"


def credential():
    from azure.identity import DefaultAzureCredential

    # Interactive browser is excluded so scripts fail fast with a clear message instead.
    return DefaultAzureCredential(exclude_interactive_browser_credential=True)


def bearer(cred, scope: str) -> dict[str, str]:
    """Authorization header for one call. The token is never printed or logged."""
    return {"Authorization": f"Bearer {cred.get_token(scope).token}"}


def instructions() -> str:
    return (AGENT_DIR / "instructions.md").read_text(encoding="utf-8").strip()
