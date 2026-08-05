// A real MCP client for the DataHub OSS MCP server.
//
// canon talks to DataHub the way the hackathon's hero integration intends: over
// the Model Context Protocol, against `acryldata/mcp-server-datahub` running
// locally via uvx, pointed at a `datahub docker quickstart`.
//
// Two things this file is careful about, both learned the hard way:
//
//   1. DATAHUB_TELEMETRY_ENABLED=false is set on the child process, always.
//      Upstream issue #152: the telemetry ping is synchronous and on the
//      request path, so every single tool call blocks for ~54 seconds without
//      it. It is not an optimisation, it is the difference between a demo and
//      a hang.
//
//   2. Mutation tools are OFF by default in the server (`Mutation Tools
//      DISABLED` in its own startup log). TOOLS_IS_MUTATION_ENABLED=true is
//      required before `add_structured_properties` or `save_document` exist at
//      all — and when a mutation fails, the OSS server RAISES rather than
//      returning success:false, so failures arrive as thrown errors.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type McpOptions = {
  gmsUrl: string;
  token?: string | undefined;
  /** Sets TOOLS_IS_MUTATION_ENABLED. Without it the write tools are not registered. */
  mutations?: boolean;
  /** Override the command. Defaults to `uvx --from mcp-server-datahub mcp-server-datahub`. */
  command?: string;
  args?: string[];
};

/**
 * Per-call ceiling. The SDK default is 60s, which is not enough headroom when a
 * cold OpenSearch index makes the first few graph queries slow — and a demo that
 * dies on its first run is worse than one that waits.
 */
const MCP_TIMEOUT_MS = Number(process.env.CANON_MCP_TIMEOUT_MS ?? 120_000);

/**
 * Tools that exhaust something per session.
 *
 * Measured against mcp-server-datahub 3.4.5 on a local DataHub OSS v1.7.0
 * quickstart: `get_entities` and `get_lineage` each succeed exactly 6 times in a
 * session and then hang indefinitely on the 7th — reproducibly, from a fresh
 * session, on the same URN, with the server idle and GMS reporting no error.
 * `search` in the same session is unaffected (20/20 calls fine), which points at
 * a leaked pooled connection on the graph-read path rather than anything to do
 * with the query.
 *
 * canon needs roughly 20 of these per resolution — one get_entities plus two
 * get_lineage per candidate — so this is not an edge case for us, it is the
 * whole read path. The session is therefore recycled before the budget is
 * reached, and a hang is treated as a recoverable event rather than a crash.
 *
 * Reproducer and full timings: docs/UPSTREAM-NOTES.md.
 */
const POOLED_TOOLS = new Set([
  "get_entities",
  "get_lineage",
  "add_structured_properties",
  "save_document",
  "add_tags",
  "add_terms",
  "update_description",
]);
const POOLED_BUDGET = Number(process.env.CANON_MCP_POOL_BUDGET ?? 5);

export type McpTool = {
  name: string;
  description?: string | undefined;
  inputSchema?: unknown;
};

export class McpSession {
  #client: Client;
  #transport: StdioClientTransport;
  #info: { name: string; version: string };
  readonly #opts: McpOptions;
  /** Calls made to POOLED_TOOLS since this child process started. */
  #pooledCalls = 0;
  /** How many times the child has been restarted to dodge the leak. */
  #recycles = 0;
  /** Superseded sessions, kept alive until close() so the event loop survives. */
  readonly #retired: Array<{ client: Client; transport: StdioClientTransport }> = [];

  private constructor(
    client: Client,
    transport: StdioClientTransport,
    info: { name: string; version: string },
    opts: McpOptions,
  ) {
    this.#client = client;
    this.#transport = transport;
    this.#info = info;
    this.#opts = opts;
  }

  static async open(opts: McpOptions): Promise<McpSession> {
    const { client, transport, info } = await connect(opts);
    return new McpSession(client, transport, info, opts);
  }

  /**
   * Starts a fresh server process and switches to it.
   *
   * The retired one is parked rather than closed, and everything is torn down
   * together in close(). Closing mid-run turned out to end the host process:
   * tearing down a StdioClientTransport drains the last thing keeping the event
   * loop alive, and node exits before the replacement has finished spawning.
   * Parking costs a few idle child processes for the length of one run and is
   * the difference between a demo that completes and one that vanishes.
   */
  async #recycle(): Promise<void> {
    this.#retired.push({ client: this.#client, transport: this.#transport });
    const { client, transport, info } = await connect(this.#opts);
    this.#client = client;
    this.#transport = transport;
    this.#info = info;
    this.#pooledCalls = 0;
    this.#recycles++;
    if (process.env.CANON_MCP_DEBUG) {
      process.stderr.write(`  mcp session recycled (#${this.#recycles}) — pooled-call budget reached\n`);
    }
  }

  /** How many times the session had to be restarted. Reported in the demo. */
  recycles(): number {
    return this.#recycles;
  }

  serverInfo(): { name: string; version: string } {
    return this.#info;
  }

  async listTools(): Promise<McpTool[]> {
    const res = await this.#client.listTools();
    return res.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  }

  /** Calls a tool and returns its text content, parsed as JSON when it parses. */
  async call<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const pooled = POOLED_TOOLS.has(name);
    // The budget is spent per URN, not per call: get_entities over six URNs
    // consumes six of whatever it is that leaks, which is why a batched read
    // followed by two lineage walks was enough to wedge a fresh session.
    const cost = pooled ? poolCost(args) : 0;
    if (pooled && this.#pooledCalls + cost > POOLED_BUDGET) await this.#recycle();

    try {
      return await this.#callOnce<T>(name, args, cost);
    } catch (err) {
      // A hang is the documented failure mode of the leak, and it can still be
      // hit if the budget is set too high. Recycle and give it exactly one more
      // go, so a demo does not die on a known-recoverable condition.
      if (pooled && isTimeout(err)) {
        await this.#recycle();
        return this.#callOnce<T>(name, args, cost);
      }
      throw err;
    }
  }

  async #callOnce<T>(name: string, args: Record<string, unknown>, cost: number): Promise<T> {
    const t0 = performance.now();
    this.#pooledCalls += cost;
    const res = await this.#client
      .callTool({ name, arguments: args }, undefined, { timeout: MCP_TIMEOUT_MS })
      .finally(() => {
        if (process.env.CANON_MCP_DEBUG) {
          process.stderr.write(`  mcp ${name} ${Math.round(performance.now() - t0)}ms\n`);
        }
      });
    if (res.isError) {
      const text = extractText(res.content);
      throw new McpToolError(name, text || "tool reported an error with no message");
    }
    const text = extractText(res.content);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  async close(): Promise<void> {
    for (const s of [...this.#retired, { client: this.#client, transport: this.#transport }]) {
      await s.client.close().catch(() => {});
      await s.transport.close().catch(() => {});
    }
    this.#retired.length = 0;
  }
}

export class McpToolError extends Error {
  readonly tool: string;

  constructor(tool: string, message: string) {
    super(`MCP tool ${tool} failed: ${message}`);
    this.name = "McpToolError";
    this.tool = tool;
  }
}

/**
 * What one call costs against the leaking pool.
 *
 * Measured, not guessed: a read costs one per URN it touches, and a structured
 * property write costs one per (property x entity) pair — two writes carrying
 * four and one property respectively were enough to wedge a session, which is
 * five. save_document is charged three because it reads its related assets
 * before writing and there is no way to see how many connections that takes.
 */
function poolCost(args: Record<string, unknown>): number {
  const urns = args["urns"];
  if (Array.isArray(urns)) return Math.max(1, urns.length);

  const entityUrns = args["entity_urns"];
  const propertyValues = args["property_values"];
  if (Array.isArray(entityUrns)) {
    const properties = propertyValues && typeof propertyValues === "object" ? Object.keys(propertyValues).length : 1;
    return Math.max(1, entityUrns.length * Math.max(1, properties));
  }

  if (args["document_type"]) return 3;
  return 1;
}

/** MCP request-timeout error code, per the protocol spec. */
function isTimeout(err: unknown): boolean {
  const code = (err as { code?: number } | null)?.code;
  return code === -32001 || /timed out/i.test(err instanceof Error ? err.message : "");
}

async function connect(
  opts: McpOptions,
): Promise<{ client: Client; transport: StdioClientTransport; info: { name: string; version: string } }> {
  const command = opts.command ?? "uvx";
  const args = opts.args ?? ["--from", "mcp-server-datahub", "mcp-server-datahub", "--transport", "stdio"];

  const transport = new StdioClientTransport({
    command,
    args,
    env: {
      ...(process.env as Record<string, string>),
      DATAHUB_GMS_URL: opts.gmsUrl,
      ...(opts.token ? { DATAHUB_GMS_TOKEN: opts.token } : {}),
      // Upstream #152. Without this every call costs ~54s.
      DATAHUB_TELEMETRY_ENABLED: "false",
      TOOLS_IS_MUTATION_ENABLED: opts.mutations === false ? "false" : "true",
    },
    stderr: "pipe",
  });

  const client = new Client({ name: "canon", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  const v = client.getServerVersion();
  return {
    client,
    transport,
    info: { name: v?.name ?? "mcp-server-datahub", version: v?.version ?? "unknown" },
  };
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: "text"; text: string } => typeof c === "object" && c !== null && (c as { type?: string }).type === "text")
    .map((c) => c.text)
    .join("\n");
}

export async function spawnMcpServer(opts: McpOptions): Promise<McpSession> {
  return McpSession.open(opts);
}
