# Test fixtures

`google/*.json` are Google API responses replayed by `test/support/google-fake.ts`
through the `fetch` seam. Each file has a `_provenance`:

* `recorded`: captured from a real account by `scripts/record-fixtures.ts`, with
  tokens, ids, etags and emails replaced by planted values (`PLANTED_*`,
  `a@example.com`).
* `docs`: hand-written from Google's published API reference, as a stand-in until
  recorded.

`fixtures_are_recorded` lists the `docs` files. It is skipped locally while any
remain, and fails when `REQUIRE_RECORDED_FIXTURES=1`, which must pass before merge.

To record: create a **Desktop** OAuth client in a test GCP project with the Tasks
API enabled, then run

    GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npx tsx scripts/record-fixtures.ts

with a throwaway Google account. Review the diff before committing.

Path segments written `{name}` match any single segment.
