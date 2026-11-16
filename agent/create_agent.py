"""Phase 4: create a new version of the Prompt Agent `recruitment-source-agent`.

The agent has exactly one tool: the Foundry IQ MCP server for knowledgebase606, reached
through the managed-identity connection `recruitment-source-kb-mi`, restricted to the
read-only `knowledge_base_retrieve` tool with approval policy "never".

No web search, Bing grounding, other knowledge bases, toolboxes or hosted agents are attached.
The old hosted agent is not touched, so it remains available for rollback.

Usage (from recruitment-frontend/):  ..\\.venv\\Scripts\\python agent/create_agent.py [--name NAME] [--connection NAME]
"""

from __future__ import annotations

import argparse
import sys

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import MCPTool, PromptAgentDefinition

import settings as s


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default=s.AGENT_NAME)
    parser.add_argument("--connection", default=s.MCP_CONNECTION_NAME)
    parser.add_argument(
        "--allow-forbidden-connection",
        action="store_true",
        help="testing only: build an outage-simulation agent on the faulty Custom Keys connection",
    )
    args = parser.parse_args()

    if args.connection in s.FORBIDDEN_CONNECTIONS and not args.allow_forbidden_connection:
        print(f"Refusing to use {args.connection}: it is the faulty Custom Keys connection (HTTP 401).")
        return 1
    if args.allow_forbidden_connection and args.name == s.AGENT_NAME:
        print("The outage-simulation agent must use a different name from the production agent.")
        return 1

    kb_tool = MCPTool(
        server_label=s.MCP_SERVER_LABEL,
        server_url=s.MCP_ENDPOINT,
        server_description=(
            "Apprenticeship Connect company documents (employer guidance, apprentice guidance and company policies) in Foundry IQ "
            f"knowledge base {s.KNOWLEDGE_BASE}."
        ),
        require_approval="never",
        allowed_tools=[s.MCP_TOOL_NAME],
        project_connection_id=args.connection,
    )

    project = AIProjectClient(endpoint=s.PROJECT_ENDPOINT, credential=s.credential())
    agent = project.agents.create_version(
        agent_name=args.name,
        description="Source-grounded recruitment and apprenticeship guidance assistant (Foundry IQ knowledgebase606 only).",
        metadata={"knowledge_base": s.KNOWLEDGE_BASE, "connection": args.connection, "managed_by": "recruitment-frontend/agent"},
        definition=PromptAgentDefinition(
            model=s.MODEL_DEPLOYMENT,
            instructions=s.instructions(),
            tools=[kb_tool],
        ),
    )

    # Read the version back to confirm what was stored.
    stored = project.agents.get_version(agent_name=args.name, agent_version=agent.version)
    definition = stored.definition
    tools = [t.as_dict() if hasattr(t, "as_dict") else dict(t) for t in (definition.tools or [])]
    print(f"Agent name:     {stored.name}")
    print(f"Agent version:  {stored.version}")
    print(f"Agent id:       {stored.id}")
    print(f"Model:          {definition.model}")
    print(f"Project:        {s.PROJECT_ENDPOINT}")
    print(f"Responses API:  POST {s.PROJECT_ENDPOINT}/openai/v1/responses  (agent_reference.name={stored.name})")
    for t in tools:
        print(
            f"Tool:           type={t.get('type')} label={t.get('server_label')} connection={t.get('project_connection_id')} "
            f"allowed={t.get('allowed_tools')} approval={t.get('require_approval')}"
        )
    if len(tools) != 1 or tools[0].get("type") != "mcp":
        print("WARNING: unexpected tool set on the stored agent version.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
