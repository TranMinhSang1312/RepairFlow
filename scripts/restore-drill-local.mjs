import { parseNamedArguments, runRestoreDrill } from "./backup-restore-lib.mjs";

const arguments_ = parseNamedArguments(process.argv.slice(2), ["bundle", "evidence"]);
const bundle = arguments_.bundle;
if (!bundle) throw new Error("--bundle is required.");
const evidence = arguments_.evidence ?? `${bundle}/restore-drill-evidence.json`;

try {
  const result = await runRestoreDrill(bundle, evidence);
  console.log(JSON.stringify({ result: "PASS", ...result.evidence }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Restore drill failed.");
  process.exitCode = 1;
}
