import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("./google/", import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const read = (f: string) => readFileSync(`${DIR}${f}`, "utf-8");

describe("Google fixtures", () => {
  it("every_fixture_parses", () => {
    expect(files.length).toBeGreaterThanOrEqual(34);
    for (const f of files) {
      const j = JSON.parse(read(f));
      expect(["recorded", "docs"], f).toContain(j._provenance);
      expect(typeof j.request.method, f).toBe("string");
      expect(j.request.path, f).toMatch(/^\//);
      expect(typeof j.response.status, f).toBe("number");
      expect(j.response, f).toHaveProperty("body");
    }
  });

  it("no_unplanted_secrets", () => {
    for (const f of files) {
      const text = read(f);
      expect(text, f).not.toMatch(/ya29\.|"1\/\/|@gmail\.com/);
    }
  });

  const docsSourced = files.filter((f) => JSON.parse(read(f))._provenance === "docs");
  const required = process.env.REQUIRE_RECORDED_FIXTURES === "1";
  if (docsSourced.length > 0 && !required) {
    console.warn(`fixtures_are_recorded: ${docsSourced.length} fixture(s) still docs-sourced: ${docsSourced.join(", ")}`);
  }
  it.skipIf(docsSourced.length > 0 && !required)("fixtures_are_recorded", () => {
    expect(docsSourced).toEqual([]);
  });
});
