import assert from "node:assert/strict";
import test from "node:test";

import {
  assertBucketIdentifier,
  assertDatabaseIdentifier,
  assertDrillTargets,
  parseNamedArguments,
  stableFingerprint,
} from "./backup-restore-lib.mjs";

test("drill target validation rejects primary and injectable targets", () => {
  assert.equal(
    assertDatabaseIdentifier("repairflow_restore_drill_1"),
    "repairflow_restore_drill_1",
  );
  assert.equal(assertBucketIdentifier("repairflow-restore-drill-1"), "repairflow-restore-drill-1");
  assert.throws(() => assertDatabaseIdentifier("repairflow;drop database"));
  assert.throws(() => assertBucketIdentifier("repairflow/unsafe"));
  assert.throws(() =>
    assertDrillTargets(
      "repairflow",
      "repairflow-restore-drill-1",
      "repairflow",
      "repairflow-private",
    ),
  );
  assert.throws(() =>
    assertDrillTargets(
      "repairflow_restore_drill_1",
      "repairflow-private",
      "repairflow",
      "repairflow-private",
    ),
  );
});

test("fingerprints are deterministic without returning source entries", () => {
  const first = stableFingerprint(["public.Shop\t2", "public.User\t3"]);
  const second = stableFingerprint(["public.User\t3", "public.Shop\t2"]);
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(first, /Shop|User/u);
});

test("named arguments reject unknown and incomplete values", () => {
  assert.deepEqual(parseNamedArguments(["--bundle", ".local/backup"], ["bundle"]), {
    bundle: ".local/backup",
  });
  assert.deepEqual(parseNamedArguments(["--", "--bundle", ".local/backup"], ["bundle"]), {
    bundle: ".local/backup",
  });
  assert.throws(() => parseNamedArguments(["--target", "production"], ["bundle"]));
  assert.throws(() => parseNamedArguments(["--bundle"], ["bundle"]));
});
