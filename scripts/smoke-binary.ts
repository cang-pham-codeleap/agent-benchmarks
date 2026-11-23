import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const work = mkdtempSync(join(tmpdir(), "agent-benchmarks-smoke-"));
const port = 47900;

function fail(message: string): never {
  console.error(`smoke-binary: ${message}`);
  process.exit(1);
}

try {
  const build = Bun.spawnSync(
    [
      "bun",
      "run",
      "scripts/build-binaries.ts",
      "--target",
      "native",
      "--out-dir",
      work,
      "--version",
      "0.0.0-smoke",
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if (build.exitCode !== 0) fail("scripts/build-binaries.ts failed");
  const target = readdirSync(work).find((entry) => !entry.endsWith(".db"));
  if (target == null) fail(`no binary in ${work}`);
  const server = Bun.spawn(
    [
      join(work, target, "agent-benchmarks"),
      "serve",
      "--no-sync",
      "--db",
      join(work, "smoke.db"),
      "--port",
      String(port),
    ],
    {
      cwd: work,
      env: { ...process.env, AGENT_BENCHMARKS_NO_SYNC: "1" },
      stdout: "ignore",
      stderr: "inherit",
    },
  );
  try {
    const base = `http://127.0.0.1:${port}`;
    let catalog: { augments: { problem: string | null }[] } | null = null;
    for (let attempt = 0; attempt < 30 && catalog == null; attempt += 1) {
      catalog = await fetch(`${base}/api/evals/catalog`)
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      if (catalog == null) await Bun.sleep(1000);
    }
    if (catalog == null) fail("the compiled binary never answered /api/evals/catalog");

    const html = await (await fetch(`${base}/`)).text();
    const stylesheet = /href="(\/[^"]+\.css)"/.exec(html)?.[1];
    if (stylesheet == null) fail("the compiled binary's UI links no stylesheet");
    const css = await (await fetch(`${base}${stylesheet}`)).text();
    if (/@(tailwind|theme)\b/.test(css) || !css.includes(".flex{display:flex}")) {
      fail(
        `compiled binary serves unprocessed Tailwind CSS at ${stylesheet}; scripts/build-binaries.ts must pass bun-plugin-tailwind to Bun.build`,
      );
    }

    const expected = readdirSync(join(root, "evals", "augments")).filter((name) =>
      name.endsWith(".json"),
    ).length;
    const bundled = catalog.augments.filter(
      (augment) => augment.problem == null || augment.problem.endsWith("is not on PATH"),
    ).length;
    if (bundled !== expected)
      fail(`compiled binary bundles ${bundled} of ${expected} evals/augments`);
  } finally {
    server.kill();
    await server.exited;
  }
  console.log("smoke-binary: ok");
} finally {
  rmSync(work, { recursive: true, force: true });
}
