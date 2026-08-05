// Prints the tool list the OSS DataHub MCP server actually exposes.
//
// This exists because the difference between DataHub OSS and DataHub Cloud is
// the single easiest thing to get wrong in this hackathon, and the cost of
// getting it wrong is a demo that cannot be run by a judge. `set_deprecation`,
// the proposal tools and the lifecycle tools are Cloud-only; a project that
// claims them has claimed something the sanctioned local quickstart cannot do.
//
// So rather than assert a tool list in the README, canon prints one:
//
//     npm run mcp:probe
//
// The output is committed under examples/ and the README links to it.

import { spawnMcpServer } from "../src/datahub/mcp.ts";

const args = process.argv.slice(2);
const asJson = args.includes("--json");

const mcp = await spawnMcpServer({
  gmsUrl: process.env.DATAHUB_GMS_URL ?? "http://localhost:8081",
  token: process.env.DATAHUB_GMS_TOKEN,
  mutations: process.env.TOOLS_IS_MUTATION_ENABLED !== "false",
});

try {
  const tools = await mcp.listTools();
  const version = mcp.serverInfo();

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          server: version,
          mutationsEnabled: process.env.TOOLS_IS_MUTATION_ENABLED !== "false",
          gms: process.env.DATAHUB_GMS_URL ?? "http://localhost:8081",
          tools: tools.map((t) => ({ name: t.name, description: (t.description ?? "").split("\n")[0] })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`server:    ${version.name} ${version.version}`);
    console.log(`gms:       ${process.env.DATAHUB_GMS_URL ?? "http://localhost:8081"}`);
    console.log(`mutations: ${process.env.TOOLS_IS_MUTATION_ENABLED !== "false" ? "enabled" : "disabled"}`);
    console.log(`tools:     ${tools.length}\n`);
    for (const t of tools.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  ${t.name.padEnd(30)} ${((t.description ?? "").split("\n")[0] ?? "").slice(0, 90)}`);
    }

    // The Cloud-only tools canon must never claim. Printing their absence is
    // more convincing than a sentence saying they are absent.
    const cloudOnly = [
      "set_deprecation",
      "list_pending_proposals",
      "propose_tags",
      "propose_terms",
      "accept_or_reject_proposals",
      "list_lifecycle_stages",
      "find_sql_context",
      "draft_sql_for_tables",
    ];
    const present = new Set(tools.map((t) => t.name));
    console.log("\nCloud-only tools, confirmed absent from this OSS server:");
    for (const name of cloudOnly) {
      console.log(`  ${present.has(name) ? "PRESENT (!)" : "absent     "}  ${name}`);
    }
  }
} finally {
  await mcp.close();
}
