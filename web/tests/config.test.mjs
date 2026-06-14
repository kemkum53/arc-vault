import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const nextConfigSource = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8");

test("Next config proxies API and health requests to the API service", () => {
  assert.match(nextConfigSource, /source:\s*"\/api\/:path\*"/);
  assert.match(nextConfigSource, /destination:\s*"http:\/\/api:8000\/api\/:path\*"/);
  assert.match(nextConfigSource, /source:\s*"\/health"/);
  assert.match(nextConfigSource, /destination:\s*"http:\/\/api:8000\/health"/);
});

test("web API helper uses the public API base env and checks /health", () => {
  assert.match(apiSource, /NEXT_PUBLIC_API_BASE_URL/);
  assert.match(apiSource, /fetchJSON\("\/health"\)/);
});
