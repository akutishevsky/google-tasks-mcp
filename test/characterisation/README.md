# Characterisation goldens (phase 0)

**Characterisation, not certification.** These files record what upstream did
before the GCP-deployment changes, including its bugs. They guard refactors
against unintended change. They do not say the behaviour is correct.

Each golden is deleted when the scenario that certifies the same behaviour lands:

| Golden | Deleted by |
|--------|------------|
| `<tool>_ok`, `<tool>_google_error` (28) | Task 8 tool scenarios (deleted) |
| `as_metadata` | Task 9 `discovery_documents` (deleted) |
| `token_response` | Task 10 `full_login` (deleted) |
| `initialize` | Task 6 `stateless_across_instances` (deleted) |
| `tools_list` | Kept: no scenario certifies the 14 input schemas, so this guards them |

Upstream defect these goldens captured, now fixed and certified by
`test/tools/tools.test.ts`: `delete_task`, `delete_task_list` and
`clear_completed_tasks` reported `Unexpected end of JSON input` on success because
Google's 204 has no body.
