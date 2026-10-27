// node --test src/lib/oauth/

import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRedirect } from "./destination.ts";

const APP = "https://app.splyce.me";

test("Splyce's own callback and Claude's are known", () => {
  assert.equal(classifyRedirect(`${APP}/api/channels/link/callback`, APP).kind, "known");
  assert.equal(classifyRedirect("https://claude.ai/api/mcp/auth_callback", APP).kind, "known");
  assert.equal(classifyRedirect("https://www.claude.com/callback", APP).kind, "known");
});

test("look-alike hosts are unknown", () => {
  assert.equal(classifyRedirect("https://claude.ai.evil.example/cb", APP).kind, "unknown");
  assert.equal(classifyRedirect("https://splyce-app.com/cb", APP).kind, "unknown");
  assert.equal(classifyRedirect("https://notclaude.ai/cb", APP).kind, "unknown");
});

test("an app on this computer is local", () => {
  assert.deepEqual(classifyRedirect("http://localhost:33418/callback", APP), { kind: "local", host: "localhost:33418" });
  assert.equal(classifyRedirect("http://127.0.0.1:5000/cb", APP).kind, "local");
});

test("plain http elsewhere, or garbage, is invalid", () => {
  assert.equal(classifyRedirect("http://claude.ai/cb", APP).kind, "invalid");
  assert.equal(classifyRedirect("not a url", APP).kind, "invalid");
});
