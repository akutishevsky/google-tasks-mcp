import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DenoKvStore } from "../../src/store/denokv.ts";
import { runStoreSuite } from "./store.suite.ts";

runStoreSuite("DenoKvStore (in memory)", (clock) => DenoKvStore.open({ clock: clock.now }), {
  persistent: false,
  reopen: (clock) => DenoKvStore.open({ clock: clock.now }),
});

let dir = "";
const pathFor = () => {
  dir = mkdtempSync(join(tmpdir(), "gtasks-kv-"));
  return join(dir, "kv.sqlite");
};
let lastPath = "";
runStoreSuite(
  "DenoKvStore (KV_PATH)",
  (clock) => {
    lastPath = pathFor();
    return DenoKvStore.open({ path: lastPath, clock: clock.now });
  },
  { persistent: true, reopen: (clock) => DenoKvStore.open({ path: lastPath, clock: clock.now }) },
);
