#!/usr/bin/env node
// Contract smoke test — zero deps, Node >= 20 (global fetch).
// Exercises the 4 agentmemory REST endpoints this extension depends on.
// Green ⇒ the contract in docs/REST-CONTRACT.md still holds.
// Run: npm test

const BASE = (process.env.AGENTMEMORY_URL || "http://localhost:3111").replace(/\/+$/, "");
const SECRET = process.env.AGENTMEMORY_SECRET;

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

async function call(pathname, { method = "POST", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (SECRET) headers.Authorization = `Bearer ${SECRET}`;
  const res = await fetch(`${BASE}/agentmemory/${pathname.replace(/^\/+/, "")}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function main() {
  console.log(`agentmemory contract smoke test → ${BASE}`);

  // 1. GET /health
  console.log("\n[1/4] GET /health");
  let res;
  try {
    res = await call("health", { method: "GET" });
  } catch (e) {
    console.error(`\nFATAL: cannot reach agentmemory at ${BASE}.\nStart it with: agentmemory`);
    process.exit(1);
  }
  check("status 200", res.status === 200, `(got ${res.status})`);
  const health = await res.json().catch(() => ({}));
  const healthy =
    health.status === "healthy" ||
    health.status === "ok" ||
    health.health?.status === "healthy";
  check("reports healthy", healthy, `(status=${health.status}, health.status=${health.health?.status})`);
  if (health.version) console.log(`     (server version ${health.version})`);

  // 2. POST /smart-search
  console.log("\n[2/4] POST /smart-search");
  res = await call("smart-search", { body: { query: "smoke test probe", limit: 3 } });
  check("status 200", res.status === 200, `(got ${res.status})`);
  const search = await res.json().catch(() => ({}));
  check("returns results array", Array.isArray(search.results), `(typeof results=${typeof search.results})`);
  if (Array.isArray(search.results) && search.results.length) {
    const r = search.results[0];
    const hasScore = typeof (r.combinedScore ?? r.score) === "number";
    check("result has numeric score", hasScore, `(keys=${Object.keys(r).join(",")})`);
  }

  // 3. POST /remember  (returns 201 Created, not 200)
  console.log("\n[3/4] POST /remember");
  res = await call("remember", {
    body: { content: "pi-agentmemory smoke test — safe to delete", type: "fact" },
  });
  check("status 2xx", res.ok, `(got ${res.status})`);
  const remembered = await res.json().catch(() => null);
  check("returns non-null body", remembered !== null, "(empty/null response)");

  // 4. POST /observe
  console.log("\n[4/4] POST /observe");
  res = await call("observe", {
    body: {
      hookType: "post_tool_use",
      sessionId: `smoke-${Date.now()}`,
      project: process.cwd(),
      cwd: process.cwd(),
      timestamp: new Date().toISOString(),
      data: { tool_name: "conversation", tool_input: "smoke", tool_output: "smoke" },
    },
  });
  check("status 2xx", res.ok, `(got ${res.status})`);

  console.log(`\n${failures === 0 ? "✅ all checks passed — contract holds" : `❌ ${failures} check(s) failed — contract drifted, see docs/REST-CONTRACT.md`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
