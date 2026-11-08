// Replays recorded Google responses through the fetch seam. Google is a
// third-party network edge (testing rules: replay, never call live).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Fixture = {
  _provenance: "recorded" | "docs";
  request: { method: string; path: string; query?: Record<string, string>; bodyContains?: string };
  response: { status: number; headers?: Record<string, string>; body: unknown };
};

export type GoogleCall = { url: URL; method: string; headers: Headers; body: string };

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/google/", import.meta.url));

export function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}${name}.json`, "utf-8")) as Fixture;
}

// `{x}` in a fixture path matches exactly one path segment.
function pathMatches(pattern: string, actual: string): boolean {
  const p = pattern.split("/");
  const a = actual.split("/");
  return p.length === a.length && p.every((seg, i) => (seg.startsWith("{") && seg.endsWith("}")) || seg === a[i]);
}

export class GoogleFake {
  readonly calls: GoogleCall[] = [];
  private readonly queued: Fixture[] = [];

  queue(name: string, overrides?: Partial<Fixture["response"]>): void {
    const f = loadFixture(name);
    this.queued.push({ ...f, response: { ...f.response, ...overrides } });
  }

  pending(): number {
    return this.queued.length;
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const body = await req.text();
    const next = this.queued[0];
    const sig = `${req.method} ${decodeURIComponent(url.pathname)}`;
    if (!next || next.request.method !== req.method || !pathMatches(next.request.path, decodeURIComponent(url.pathname))) {
      throw new Error(`Unexpected Google call: ${sig}`);
    }
    if (next.request.bodyContains && !body.includes(next.request.bodyContains)) {
      throw new Error(`Unexpected Google call body for ${sig}`);
    }
    this.queued.shift();
    this.calls.push({ url, method: req.method, headers: req.headers, body });
    const { status, headers, body: resBody } = next.response;
    const text = status === 204 || resBody === undefined || resBody === null ? null : JSON.stringify(resBody);
    return new Response(text, { status, headers: { "content-type": "application/json", ...headers } });
  };
}
