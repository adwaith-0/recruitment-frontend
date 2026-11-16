# Recruitment AI – Frontend

A React homepage with a bottom-right chat widget for the AI recruitment and apprenticeship platform.
The homepage follows the supplied Apprenticeship Connect reference, using its original logo, photography
and locally bundled typography (see `docs/homepage-assets.md`). The assistant is the Microsoft Foundry
**Prompt Agent `recruitment-source-agent`**. It answers company and apprenticeship questions only from
the Foundry IQ knowledge base `knowledgebase606`, and the browser reaches it through a small Node/Express bridge.

One shared chat handles apprentice hiring, courses, eligibility and applications. There is no sidebar or
role selection: the assistant follows the context of the conversation. The **Find an apprenticeship** and
**Plan a hire** starter prompts also tell the agent which journey the user chose.


Click the floating **Chat with us** button to open the popup. Minimize it with the header control, the
launcher, or Escape. Messages, unfinished drafts and in-flight replies stay available while minimized;
the homepage remains usable behind the non-modal panel. The layout adapts to mobile and landscape screens.

The chat uses a neutral palette, a bottom composer, and unboxed assistant replies. Theme controls affect
the chat while the homepage keeps its reference colors. Inline source
badges show a document icon and readable title. Click a badge to read the retrieved excerpt, or expand
**Sources** to browse the references. URL citations include a link to the original page.

## Interactive replies

- Procedural numbered lists become preparation checklists, preserving every instruction, nested list and
  citation. Checkboxes track personal preparation in this tab; they never submit an application or invoke a tool.
- **Guide / Text** switches presentation without losing checklist progress. **Expand chat** provides a wider
  reading area on desktop. Non-procedural answers keep their normal Markdown layout.
- **Where next?** offers questions based on the current user message. Clicking one sends a real follow-up to
  the existing agent with the conversation context; it does not invent an action result.
- **Save guide** downloads a Markdown file containing the original answer, returned sources and personal
  checklist notes. No external document service is used.
- Source previews support literal text search, highlighted matches and jumping to the first match.
- Course explanations and lists include course cards with rounded **View course** links. Recognized names
  are matched to the official page directory, and **Browse all courses** is available for broader enquiries.
  See `docs/course-links.md` for the checked destinations and refresh procedure.

The presentation is derived from the returned answer. No new agent prompt, generated business facts,
confidence score, or simulated backend progress is added.

```
Browser (React, Vite :5173) ──/api──▶ Vite proxy ──▶ Bridge (Express :8787)
                                                       │  1. greeting? → fixed reply (no Azure call)
                                                       │  2. else → Responses API, Entra ID token
                                                       ▼
                       Foundry Prompt Agent recruitment-source-agent (gpt-5.6-luna)
                                                       │  MCP tool knowledge_base_retrieve (forced)
                                                       │  connection recruitment-source-kb-mi
                                                       │  = project managed identity, audience https://search.azure.com/
                                                       ▼
                       Foundry IQ knowledgebase606 (Azure AI Search, RBAC only)
                          ├─ employer-guidance-source   (blob container employer-docs)
                          ├─ apprentice-guidance-source (blob container apprentice-docs)
                          └─ company-policies-source    (blob container policesshared)
```

The browser never receives Azure credentials, Foundry response IDs or storage URLs. Tokens are obtained
and used only inside the bridge.

## Prerequisites

- Node.js 22.12+ (tested on 24.11)
- Azure CLI, signed in to the tenant/subscription that hosts `recruitment-ai-lab`: `az login`
- To invoke the agent, your account needs **Foundry User** (formerly Azure AI User) on the Foundry project.
- For the provisioning scripts in `agent/`: the repository's Python environment (`..\.venv`, with
  `azure-ai-projects` 2.10 and `azure-identity`). Creating connections requires **Foundry Project Manager**.

## Run it

```bash
cd recruitment-frontend
npm install
cp .env.example .env        # non-secret settings; defaults point at recruitment-source-agent
npm run dev:all             # API bridge (:8787) + Vite (:5173)
```

Open http://localhost:5173. The header shows **Connected** when the bridge can get an Azure token.
**Settings** shows the agent name, agent type and knowledge base in use.

To run the two parts in separate terminals, use `npm run dev:api` (the bridge, which restarts on `server/`
changes) and `npm run dev`.

Other scripts: `npm run lint` (oxlint), `npm test` (unit and API routing tests with Foundry mocked),
`npm run build` and `npm run preview`.

## Azure setup (already done, safe to re-run)

The scripts are idempotent. They read settings from `.env`, use `DefaultAzureCredential` and never
print tokens or keys. Run them from `recruitment-frontend/`:

| Script | What it does |
| --- | --- |
| `..\.venv\Scripts\python agent\verify_azure.py [--assign-role]` | Checks the Foundry resource, the project managed identity, the `gpt-5.6-luna` deployment (agentsV2 and responses), Search RBAC, the managed identity's **Search Index Data Reader** role, `knowledgebase606`, both knowledge sources (active status, sync errors, indexed chunks), MCP `tools/list` and the connection. With `--assign-role` it assigns the role, but only if it's missing. |
| `..\.venv\Scripts\python agent\create_connection.py` | Creates or updates `recruitment-source-kb-mi` (RemoteTool, **ProjectManagedIdentity**, audience `https://search.azure.com/`) with the documented ARM call (`api-version=2025-10-01-preview`), then reads it back. It refuses to touch the faulty `kb-knowledgebase606-5zq0p`. |
| `..\.venv\Scripts\python agent\create_agent.py` | Creates a new version of `recruitment-source-agent`: a `PromptAgentDefinition` with one `MCPTool` (`server_label=knowledge-base`, `allowed_tools=[knowledge_base_retrieve]`, `require_approval=never`, `project_connection_id=recruitment-source-kb-mi`) and the instructions in `agent/instructions.md`. |
| `..\.venv\Scripts\python agent\add_policies_source.py [--attach]` | Creates the `company-policies-source` knowledge source over `ragstorage4u/policesshared` (keyless: the search service's managed identity reads blobs and calls `text-embedding-3-small` via **Cognitive Services OpenAI User**), waits for indexing, and with `--attach` adds it to `knowledgebase606`. Citations from it are labelled **Policies**. |
| `..\.venv\Scripts\python agent\smoke_test.py` | Test I: runs MCP `tools/list`, a real `knowledge_base_retrieve`, and an agent call that proves the managed-identity connection returns documents with no HTTP 401. |
| `node scripts/live-test.mjs [--only=C,F] [--outage]` | Runs live Tests A–H and J (or K with `--outage`) against a running bridge. Each grounded turn uses about 15–25k tokens, and the deployment allows 125k tokens per minute. |

### Why the previous agent failed with HTTP 401

The old connection `kb-knowledgebase606-5zq0p` used **Custom Keys**, meaning an API key. The search
service has `disableLocalAuth: true`, so it rejects every API key. The MCP server answered with a 401
(`-32006`), which Foundry reported as `tool_user_error`.

The new connection authenticates as the **project's system-assigned managed identity** (principal
`4b6e21cd-…cb91`). That identity already holds **Search Index Data Reader** on
`recruitment-ai-lab-srch-svvg`. Storage roles play no part in retrieval: only indexing uses the search
service's own identity (which has Storage Blob Data Reader on `ragstorage4u`).

## Grounding: how factual answers are enforced

The approach is **mandatory MCP retrieval inside the agent, checked by an evidence gate in the bridge.**
The Prompt Agent still generates the response, and it calls the knowledge base itself through the
managed-identity connection. The bridge doesn't rely on the model to decide whether to retrieve. It also
doesn't treat "a tool call was attempted" as proof of anything: it checks the actual tool result before
releasing any text.

1. **Greeting router** (`server/greetings.js`). Exact standalone greetings and acknowledgements (after
   normalising case, whitespace and trailing punctuation) get a fixed reply. There is no Foundry, LLM, MCP,
   Search or token call, and no Foundry conversation is created. "Hi, how does employer recruitment
   work?" is *not* a greeting. `ok` and `yes` are excluded on purpose, because users send them to answer
   the agent's confirmation questions.
2. **Forced retrieval.** Every other message is sent with
   `tool_choice: { type: "mcp", server_label: "knowledge-base", name: "knowledge_base_retrieve" }`.
3. **Evidence gate** (`server/grounding.js`):

| Response | Bridge returns |
| --- | --- |
| HTTP 400 `tool_user_error`, a failed `mcp_call`, or an `mcp_list_tools` error | 503 `knowledge_unavailable`: a safe message, with the model text withheld and details in the server log |
| No knowledge-base call at all | 502 `retrieval_missing`: the answer is withheld |
| Retrieval succeeded with zero documents (the tool returns an empty body) | The fixed reply "I couldn't find verified information…" |
| Documents retrieved | The model's text, with validated citations |

4. **Citations.** Foundry generates `url_citation` annotations for the model's `【msg:doc†source】` markers
   from the real tool result. The bridge keeps a marker (rewritten to `[n]`) only if it resolves to a
   document retrieved in this conversation. Any other marker is removed and counted in
   `grounding.removedCitations`, and the UI shows a note. Each source card shows the document title, the
   knowledge source (Employer or Apprentice guidance), the **Captured** date and the public page link. All
   of these come from the retrieved document itself. Storage URLs are never sent to the browser.
5. **Context hygiene.** A thread's `previous_response_id` only advances when a turn is accepted. A withheld
   or evidence-free answer never becomes context for later turns.

The alternative was a server-side retrieve-then-generate pipeline. Keeping the MCP call inside the agent
keeps Foundry as the single runtime: one call, one identity, and citations generated by the platform. It
also fixes the original 401 where it started. The gate gives the same guarantee (no unsourced company
facts) without a second retrieval path.

What the gate cannot prove is that every sentence is supported by the passage it cites. That still
depends on the agent instructions. Replies longer than about 280 characters with no valid citation are
labelled as unverified.

## Configuration (`.env`)

Every value is non-secret, and none use the `VITE_` prefix. See `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FOUNDRY_PROJECT_ENDPOINT` | recruitment-ai-lab endpoint | Foundry project endpoint |
| `FOUNDRY_AGENT_NAME` | `recruitment-source-agent` | Agent name |
| `FOUNDRY_AGENT_KIND` | `prompt` | `prompt` (grounded) or `hosted` (rollback) |
| `FOUNDRY_AGENT_VERSION` | latest | Optional version pin |
| `FOUNDRY_MODEL_DEPLOYMENT` | `gpt-5.6-luna` | Used by `agent/create_agent.py` |
| `FOUNDRY_MCP_CONNECTION_NAME` | `recruitment-source-kb-mi` | Used by `agent/*.py` |
| `FOUNDRY_API_VERSION` | `v1` | Hosted (rollback) endpoint only |
| `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_SEARCH_ENDPOINT`, `AZURE_SEARCH_KNOWLEDGE_BASE`, `AZURE_SEARCH_API_VERSION`, `AZURE_STORAGE_ACCOUNT` | existing resources | Used by `agent/*.py`. The knowledge base name also appears in Settings. |
| `AZURE_AUTH_MODE` | `cli` | `cli` = Azure CLI only; `default` = `DefaultAzureCredential` (a managed identity in Azure) |
| `AZURE_TENANT_ID` | (unset) | Optional tenant pin |
| `API_HOST` / `API_PORT` | `127.0.0.1` / `8787` | Bridge address |
| `AGENT_TIMEOUT_MS` | `120000` | Upstream timeout |
| `MAX_MESSAGE_CHARS` | `8000` | Input limit |
| `SESSION_TTL_MINUTES` | `120` | Idle lifetime of server-side conversation state |
| `DAILY_QUESTION_LIMIT` | `1000` | Questions per visitor (browser session) per UTC day. Greetings are not counted, and questions that fail upstream are refunded. |
| `DAILY_QUESTION_LIMIT_PER_IP` | `3000` | Per-IP daily backstop, so clearing cookies can't bypass the visitor limit |
| `MAX_CONCURRENT_REQUESTS` | `10` | Questions answered at the same time across the whole site |
| `MAX_QUEUED_REQUESTS` / `QUEUE_TIMEOUT_MS` | `20` / `30000` | Extra questions wait in this queue. When it's full or the wait runs out, they get `server_busy`. |

## How the agent is called

The bridge sends `POST {FOUNDRY_PROJECT_ENDPOINT}/openai/v1/responses` with an Entra ID token for
`https://ai.azure.com/.default`:

```json
{ "agent_reference": { "type": "agent_reference", "name": "recruitment-source-agent" },
  "input": [ { "type": "message", "role": "developer", "content": "Application context: … EMPLOYER journey …" },
             { "type": "message", "role": "user", "content": "…" } ],
  "tool_choice": { "type": "mcp", "server_label": "knowledge-base", "name": "knowledge_base_retrieve" },
  "previous_response_id": "resp_…" }
```

The developer message is sent once per thread, when the user picks the **Find an apprenticeship** or
**Plan a hire** starter prompt. The UI has no separate role selector, by design. An HTTP 429 is retried
once, honouring `Retry-After` up to 20 s.

### Bridge API

`POST /api/chat` — `{ "message": "…", "threadId": "thread_…", "role": "employer" | "apprentice" (optional) }`

- The bridge sets an opaque `rai_sid` cookie (HttpOnly, SameSite=Strict, Path=/api) and stores Foundry
  state in memory per session and `threadId`. It ignores any response ID the client sends, so a user can't
  continue or read another user's Foundry conversation.
- On success it returns `{ routed: "greeting" | "prompt", text, sources[], citations[], toolCalls[],
  toolIssues[], grounding: { status, documentsRetrieved, citedSources, removedCitations }, status, usage }`.
  `grounding.status` is one of `not_required` (greeting), `cited`, `uncited`, `not_found` or `no_evidence`.
- On failure it returns `{ error: { code, message, hint, retryable, retryAfter?, upstreamStatus? } }`.

`DELETE /api/threads/:threadId` forgets a thread. The app calls it when a chat is cleared or deleted.
`GET /api/health` reports the agent, agent type and knowledge base, and whether a token can be acquired.

| Error code | Meaning |
| --- | --- |
| `knowledge_unavailable` | Document search failed (MCP auth or connection error). No answer is invented. |
| `retrieval_missing` | The model didn't search, so the answer was withheld |
| `auth_failed` / `unauthorized` | `az login` is missing or expired |
| `forbidden` | No permission to invoke the agent |
| `agent_not_found` | The agent name, kind or endpoint is wrong |
| `rate_limited` | HTTP 429, still failing after one retry |
| `timeout` / `network_error` / `upstream_error` | Foundry is unreachable, too slow, or returned 5xx |
| `conversation_expired` | The context is gone (for example, the bridge restarted). The thread restarts on the next message. |
| `thread_busy` | A reply is already pending for this chat |
| `daily_limit_reached` | HTTP 429: the visitor (or their IP) has used today's questions. The UI shows no Retry button. |
| `server_busy` | HTTP 503: all concurrency slots are taken and the queue is full or timed out |
| `agent_failed` / `empty_response` | The response itself failed or had no text |

## Hosted deployment (Azure App Service)

> **Removed on 2026-11-16.** The web app `apprenticeship-assistant-3070`, its plan and its role assignment
> were deleted at the owner's request, so the public URL no longer works. The Foundry agent, knowledge base
> and Azure AI Search resources were kept. The notes below describe how it was set up, in case it needs to
> be recreated (with `az appservice plan create` and `az webapp create`, then the same settings and deploy steps).

Former public URL: https://apprenticeship-assistant-3070.azurewebsites.net

| Item | Value |
| --- | --- |
| Web app | `apprenticeship-assistant-3070` (Linux, Node 24 LTS, HTTPS only) in `rg-adwaithakumar210-3095` |
| Plan | `apprenticeship-assistant-plan`, **F1 Free**, East US 2 (the subscription has no F1 quota in North Central US) |
| Identity | System-assigned managed identity `9a95cc94-…e9b7` with **Foundry User** on the `recruitment-ai-lab` project only |
| Startup | `node server/index.js`. One process serves `dist/` and `/api` (`SERVE_STATIC_DIR=dist`). |
| App settings | `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_AGENT_NAME=recruitment-source-agent`, `FOUNDRY_AGENT_KIND=prompt`, `AZURE_SEARCH_KNOWLEDGE_BASE`, `AZURE_AUTH_MODE=default` (managed identity), `API_HOST=0.0.0.0`, `SERVE_STATIC_DIR=dist`, `SCM_DO_BUILD_DURING_DEPLOYMENT=false`. None of them are secrets. |

To redeploy after changing code:

1. Run `npm run build`.
2. Copy `server/` and `dist/` into an empty folder.
3. In that folder, add a `package.json` that lists only `express` and `@azure/identity` as dependencies,
   with `"type": "module"`.
4. Run `npm install --omit=dev` there.
5. Zip the folder contents with forward-slash paths. (Windows PowerShell 5.1 `Compress-Archive` writes
   backslashes, which breaks extraction on Linux.)
6. Deploy the zip:

```
az webapp deploy -g rg-adwaithakumar210-3095 -n apprenticeship-assistant-3070 --src-path deploy.zip --type zip --restart true
```

The site is **public, with no sign-in**. Usage is limited to 1,000 questions per visitor per day
(3,000 per IP) and 10 questions answered at once; see the `DAILY_*` and `MAX_*` app settings. To change a
limit, run `az webapp config appsettings set` (no redeploy needed). The counters are kept in memory, so
they reset when the app restarts. Every grounded question uses Azure credit and the 125k tokens/minute model quota. F1 also limits the app to 60 CPU
minutes a day and puts it to sleep when idle, so the first request after a quiet period is slow. To take
the site offline, run `az webapp stop -g rg-adwaithakumar210-3095 -n apprenticeship-assistant-3070`, or
delete the web app and plan.

## Rollback to the hosted agent

The hosted agent `recruitment-maf-test` was not modified or deleted. To switch the app back to it, set
these in `.env`:

```
FOUNDRY_AGENT_KIND=hosted
FOUNDRY_AGENT_NAME=recruitment-maf-test
```

Then restart the bridge. The greeting router still applies, but the evidence gate doesn't, because the
hosted agent handles its own tools. To go back to an earlier Prompt Agent version instead, set
`FOUNDRY_AGENT_VERSION`.

`recruitment-source-agent-outage-sim` is a test-only agent on the faulty connection. It reproduces the 401
for Test K. Delete it when it's no longer needed:
`AIProjectClient(endpoint=..., credential=DefaultAzureCredential()).agents.delete(agent_name="recruitment-source-agent-outage-sim")`

## Project structure

```
recruitment-frontend/
├─ agent/                   Foundry provisioning (Python, azure-ai-projects 2.x)
│  ├─ instructions.md       System instructions for recruitment-source-agent
│  ├─ settings.py           Shared non-secret settings (.env fallback)
│  ├─ verify_azure.py       Resource / RBAC / knowledge-base verification
│  ├─ create_connection.py  recruitment-source-kb-mi (ProjectManagedIdentity)
│  ├─ create_agent.py       New agent version with the knowledge-base MCP tool only
│  └─ smoke_test.py         MCP auth + retrieval + agent tool-call check
├─ server/                  API bridge (Node/Express)
│  ├─ index.js              Wiring + listen
│  ├─ app.js                Routes, validation, greeting route, logging without message content
│  ├─ greetings.js          Deterministic greeting classifier
│  ├─ sessions.js           Cookie session + per-thread server-side state
│  ├─ promptAgent.js        Prompt Agent request (forced MCP retrieval, previous_response_id)
│  ├─ grounding.js          Evidence gate + citation validation + source cards
│  ├─ foundryHttp.js        Authenticated POST, timeout/cancel, one 429 retry
│  ├─ hostedAgent.js        Rollback adapter for the previous hosted agent
│  ├─ auth.js               @azure/identity credential + in-memory token cache
│  ├─ errors.js             Stable error codes
│  └─ config.js             Non-secret env config
├─ scripts/                 dev.mjs (bridge + Vite), live-test.mjs (live checks)
├─ src/                     React app (design unchanged; see above)
└─ tests/                   node:test suites (Foundry mocked)
```

## Privacy and security

- Conversations live only in React state (no `localStorage`), so a refresh clears them. The bridge keeps
  Foundry context per session in memory and drops it after `SESSION_TTL_MINUTES` of inactivity.
- The bridge binds to `127.0.0.1`, validates input, limits body size and never logs message content.
  Logs record the route, grounding status, document counts, token usage, error codes and Foundry request IDs.
- The agent instructions treat retrieved documents as untrusted. Markdown is rendered without raw HTML.
- **Not production-ready yet.** Before exposing this beyond localhost, you need:
  - real user authentication in front of the bridge (the session cookie separates browsers, not people)
  - a shared session store for multiple instances
  - per-user rate limiting
  - the bridge running under a managed identity (`AZURE_AUTH_MODE=default`) with only Foundry User on the project
  - monitoring and alerting on `knowledge_unavailable`

## Known behaviour and limitations

- **Latency:** a grounded answer takes about 5–10 s (one retrieval plus generation). Greetings return instantly.
- **Quota:** each grounded turn costs about 15–25k input tokens, and that grows with conversation length
  because earlier tool results stay in context. The `gpt-5.6-luna` deployment allows 125k tokens per
  minute, so a burst of about 6 or more turns in a minute can hit HTTP 429.
- **Live vacancies:** no vacancy API is connected. The agent says it can't verify current vacancies and
  doesn't present old vacancy documents as open positions.
- **Source metadata:** the title, public URL and captured date come from the document text. A chunk
  without those header lines shows the file name and no link.
- **Restart:** restarting the bridge forgets the Foundry context, and the next message starts a fresh thread.
