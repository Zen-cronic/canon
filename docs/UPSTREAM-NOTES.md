# Upstream notes

Things that bit us building against DataHub OSS, written down because the next
person will hit them too. Both were found by running the thing, and both are
worked around in this repo rather than hidden.

Environment for everything below:

```
DataHub OSS          v1.7.0 (datahub docker quickstart)
mcp-server-datahub   3.4.5 (uvx --from mcp-server-datahub mcp-server-datahub)
acryl-datahub CLI    1.7.0
host                 Linux, 16 CPU / 58 GB, Docker 29.7.1
```

---

## 1. Pooled connections leak on the graph-read and mutation tools

**Symptom.** `get_entities` and `get_lineage` succeed a handful of times per
server process and then hang forever. Not slowly — indefinitely. The MCP client
eventually reports `MCP error -32001: Request timed out`, GMS logs nothing, and
`docker stats` shows the whole stack idle.

**The shape of it.** `search` is unaffected in the same session, which is what
points at a pooled resource on the graph-read path rather than anything about
the query:

```
searches ok:      20/20
get_entities ok:   6/20    <- hangs on the 7th
get_lineage  ok:   6/14    <- hangs on the 7th, fresh session, same URN
```

The budget is spent **per URN, not per call**. One `get_entities` over 20 URNs
wedges a brand-new session on its own — which is how we first hit it, because
the write-back verification re-reads every search hit in one go.

Mutation tools spend from the same budget: two `add_structured_properties` calls
carrying four and one property respectively were enough, i.e. five.

**Reproducer.**

```js
import { spawnMcpServer } from "./src/datahub/mcp.ts";
const m = await spawnMcpServer({ gmsUrl: "http://localhost:8081", mutations: true });
const U = "urn:li:dataset:(urn:li:dataPlatform:snowflake,ANALYTICS.STAGING.STG_ORDERS,PROD)";
for (let i = 1; i <= 12; i++) {
  const t0 = performance.now();
  await m.call("get_lineage", { urn: U, upstream: i % 2 === 0, max_hops: 4, max_results: 50 });
  console.log(`call ${i}: ${Math.round(performance.now() - t0)}ms`);
}
// call 1: 88ms ... call 7: 75ms, call 8: never returns
```

**Workaround, in `src/datahub/mcp.ts`.** Charge every call a measured cost
(one per URN; properties × entities for a structured-property write; three for
`save_document`), and start a fresh server process before the budget runs out.
A restart costs ~900 ms because uvx caches the environment, and a full canon
resolution needs about five of them. `src/datahub/live.ts` also chunks
`get_entities` to `CANON_ENTITY_CHUNK` (default 5) URNs per call so a wide
question cannot blow the budget in a single call.

One wrinkle worth knowing: **closing the old session mid-run kills the host
process.** Tearing down a `StdioClientTransport` drains the last handle keeping
node's event loop alive, and the process exits before the replacement finishes
spawning — silently, with only an "unsettled top-level await" warning. Retired
sessions are therefore parked and all torn down together at the end.

**Not reported upstream yet.** Opening issues and PRs is operator-scheduled for
this project; this note is the writeup that would go with one.

---

## 2. `get_entities` returns a curated subset of aspects

**Symptom.** canon's ruling was structurally right against live DataHub but
scored 102 where the same catalog offline scored 149, and the staging copy came
back as a `warning` instead of the `blocker` that triggers deprecation.

**Cause.** The MCP `get_entities` response carries `properties`,
`editableProperties`, `ownership`, `tags`, `glossaryTerms`, `subTypes`,
`schemaMetadata`, `health` and `relatedDocuments`. It does **not** carry:

| Aspect | What canon needs it for |
|---|---|
| `upstreamLineage` | the edge **type** — `COPY` vs `TRANSFORMED` is the difference between a landing copy and a modelled table |
| `siblings` | naming the dbt model as the definition and its warehouse table as the thing to query |
| `operation` | freshness |
| `datasetProfile` | row counts |
| `datasetUsageStatistics` | who actually queries it |

Four of canon's rules read exactly those, and `isTrulyDead` — the test that
gates deprecation — needs the `COPY` edge specifically.

**Workaround.** Supplement from the platform's own aspect endpoint on the same
GMS:

```
GET /openapi/v3/entity/dataset/{urn}?aspects=upstreamLineage&aspects=siblings
    &aspects=operation&aspects=datasetProfile&aspects=datasetUsageStatistics
    &aspects=deprecation&aspects=structuredProperties
```

This is still DataHub OSS and still no Cloud surface, but it is a **second read
surface**, and the README names it as one rather than folding it into the MCP
claim.

**Gotcha in the response.** Structured property values come back tagged by type:

```json
{"propertyUrn": "urn:li:structuredProperty:canon.status",
 "values": [{"string": "canonical"}]}
```

Reading `values[0]` as a string yields `[object Object]` and the ruling silently
fails to read back. Unwrap `.string` / `.double`.

---

## 3. Telemetry blocks every MCP call

Already known upstream (`acryldata/mcp-server-datahub` #152) but worth repeating
because it is the difference between a demo and a hang: the telemetry ping is
synchronous and on the request path, so every tool call costs ~54 s without

```
DATAHUB_TELEMETRY_ENABLED=false
```

`src/datahub/mcp.ts` sets it on the child process unconditionally rather than
relying on the shell.

---

## 4. Mutation tools are off by default

The OSS server logs `Mutation Tools DISABLED MCP Server.` at startup and simply
does not register `add_structured_properties`, `save_document`, `add_tags` or
`add_terms`. `TOOLS_IS_MUTATION_ENABLED=true` is required before write-back has
anything to call. When a mutation does fail it **raises** rather than returning
`success: false`, so failures arrive as thrown errors.

---

## 5. Quickstart port 8080 may already be taken

`datahub docker quickstart` maps GMS to host port 8080 and fails outright if
something else holds it:

```
Error response from daemon: ports are not available: exposing port TCP
0.0.0.0:8080 -> 127.0.0.1:0: listen tcp 0.0.0.0:8080: bind: address already in use
```

`DATAHUB_MAPPED_GMS_PORT=8081 datahub docker quickstart` works and is what this
repo's docs assume. Run it through the CLI, not raw `docker compose` — the CLI
supplies `DATAHUB_VERSION` and friends, without which compose fails on
`invalid reference format`.
