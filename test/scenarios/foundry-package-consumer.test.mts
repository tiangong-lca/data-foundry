import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { resolvePackageManagerCommand } from "../../scripts/lib/package-manager-command.ts";
import { verifyManagedPackageCache } from "../helpers/managed-package-cache.mts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const stageRoot = path.join(repoRoot, "package-stage");
const sourceManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  version: string;
  packageManager: string;
};
const sourcePackageVersion = sourceManifest.version;
const secretKey = /(?:PASSWORD|PASSWD|TOKEN|SECRET|COOKIE|CREDENTIAL|API_?KEY|PRIVATE_?KEY)/iu;

function isolatedEnvironment(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    NPM_CONFIG_CACHE: path.join(home, "npm-cache"),
    NPM_CONFIG_USERCONFIG: path.join(home, "npmrc"),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_AUDIT: "false",
    COREPACK_HOME: path.join(path.dirname(home), "corepack-cache"),
    COREPACK_DEFAULT_TO_LATEST: "0",
    COREPACK_ENABLE_NETWORK: "0",
    ...extra,
  };
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "windir",
    "ComSpec",
    "COMSPEC",
    "PATHEXT",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
  ]) {
    const value = process.env[key];
    if (value !== undefined && !secretKey.test(key)) {
      if (/proxy/iu.test(key)) {
        const proxy = new URL(value);
        assert.equal(proxy.username, "", `${key} cannot carry a username`);
        assert.equal(proxy.password, "", `${key} cannot carry a password`);
      }
      environment[key] = value;
    }
  }
  assert.deepEqual(
    Object.keys(environment).filter((key) => secretKey.test(key)),
    [],
  );
  return environment;
}

function command(
  executable: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeout = 120_000,
) {
  const result = spawnSync(executable, args, {
    shell: false,
    cwd,
    env: environment,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout,
  });
  if (result.error) throw result.error;
  return result;
}

function packageManagerCommand(
  manager: "npm" | "pnpm",
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeout = 120_000,
) {
  const invocation = resolvePackageManagerCommand(manager, args);
  return command(invocation.executable, invocation.argv, cwd, environment, timeout);
}

function packageFiles(root: string): Array<{ path: string; bytes: number; sha256: string }> {
  const files: Array<{ path: string; bytes: number; sha256: string }> = [];
  const walk = (directory: string, relativeDirectory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (relativeDirectory === "" && entry.name === "node_modules") continue;
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target, relative);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(target);
        files.push({
          path: relative,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      } else throw new Error(`Unexpected package entry ${relative}`);
    }
  };
  walk(root, "");
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function setReadOnly(root: string): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      setReadOnly(target);
      fs.chmodSync(target, 0o555);
    } else if (entry.isFile()) fs.chmodSync(target, 0o444);
  }
  fs.chmodSync(root, 0o555);
}

function restoreWritable(root: string): void {
  if (!fs.existsSync(root)) return;
  fs.chmodSync(root, 0o755);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) restoreWritable(target);
    else if (entry.isFile()) fs.chmodSync(target, 0o644);
  }
}

function runFacade(entry: string, cwd: string, args: string[], expectedExit: number) {
  const result = command(process.execPath, [entry, ...args], cwd, isolatedEnvironment(cwd));
  assert.equal(result.status, expectedExit, result.stderr || result.stdout);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1, result.stdout);
  return JSON.parse(lines[0]) as Record<string, unknown>;
}

function installConsumer(
  root: string,
  tarball: string,
  cacheHome: string,
  offline: boolean,
): string {
  const project = path.join(root, "project");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    path.join(project, "package.json"),
    '{"name":"foundry-package-consumer","version":"1.0.0","private":true,"type":"module"}\n',
  );
  const result = packageManagerCommand(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      ...(offline ? ["--offline"] : []),
      tarball,
    ],
    project,
    isolatedEnvironment(cacheHome),
    offline ? 120_000 : 300_000,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return project;
}

test("packed Foundry installs twice and runs only the public facade from a read-only closure", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-package-consumer-"));
  const installedRoots: string[] = [];
  t.after(() => {
    for (const installed of installedRoots) restoreWritable(installed);
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, packageManager: sourceManifest.packageManager }),
  );
  const packageManager = packageManagerCommand(
    "pnpm",
    ["--version"],
    root,
    isolatedEnvironment(path.join(root, "toolchain-home"), { COREPACK_ENABLE_NETWORK: "1" }),
    300_000,
  );
  assert.equal(packageManager.status, 0, packageManager.stderr || packageManager.stdout);
  assert.equal(`pnpm@${packageManager.stdout.trim()}`, sourceManifest.packageManager);
  const build = command(
    process.execPath,
    [path.join(repoRoot, "scripts", "build-foundry-package.ts")],
    repoRoot,
    isolatedEnvironment(path.join(root, "build-home")),
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const firstBuild = packageFiles(stageRoot);
  const rebuilt = command(
    process.execPath,
    [path.join(repoRoot, "scripts", "build-foundry-package.ts")],
    repoRoot,
    isolatedEnvironment(path.join(root, "rebuild-home")),
  );
  assert.equal(rebuilt.status, 0, rebuilt.stderr || rebuilt.stdout);
  assert.deepEqual(packageFiles(stageRoot), firstBuild);
  const artifacts = path.join(root, "artifacts");
  fs.mkdirSync(artifacts);
  const packed = packageManagerCommand(
    "pnpm",
    ["pack", "--json", "--pack-destination", artifacts],
    stageRoot,
    isolatedEnvironment(path.join(root, "pack-home")),
  );
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const packValue = JSON.parse(packed.stdout) as
    | {
        filename: string;
        files: Array<{ path: string }>;
      }
    | Array<{
        filename: string;
        files: Array<{ path: string }>;
      }>;
  const packReport = Array.isArray(packValue) ? packValue : [packValue];
  assert.equal(packReport.length, 1);
  const tarball = path.isAbsolute(packReport[0].filename)
    ? packReport[0].filename
    : path.join(artifacts, packReport[0].filename);
  assert.equal(fs.existsSync(tarball), true);
  const secondArtifacts = path.join(root, "artifacts-second");
  fs.mkdirSync(secondArtifacts);
  const secondPack = packageManagerCommand(
    "pnpm",
    ["pack", "--json", "--pack-destination", secondArtifacts],
    stageRoot,
    isolatedEnvironment(path.join(root, "second-pack-home")),
  );
  assert.equal(secondPack.status, 0, secondPack.stderr || secondPack.stdout);
  const secondTarball = path.join(secondArtifacts, path.basename(packReport[0].filename));
  assert.deepEqual(fs.readFileSync(secondTarball), fs.readFileSync(tarball));
  const verified = command(
    process.execPath,
    [path.join(repoRoot, "scripts/verify-foundry-package.ts")],
    repoRoot,
    isolatedEnvironment(path.join(root, "verify-home")),
  );
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);
  assert.equal(JSON.parse(verified.stdout).status, "passed");
  const packDriver = pathToFileURL(path.join(repoRoot, "scripts/pack-foundry-package.ts")).href;
  const driverDestination = path.join(root, "pack driver 中文");
  for (const attempt of ["first", "reuse"]) {
    const archived = command(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { packFoundryPackage } from ${JSON.stringify(packDriver)}; const packed = packFoundryPackage(${JSON.stringify(driverDestination)}); process.stdout.write(packed.path);`,
      ],
      repoRoot,
      isolatedEnvironment(path.join(root, `archive-${attempt}-home`)),
    );
    assert.equal(archived.status, 0, archived.stderr || archived.stdout);
    assert.deepEqual(fs.readFileSync(archived.stdout.trim()), fs.readFileSync(tarball));
  }
  assert.equal(
    packReport[0].files.some(
      (file) =>
        file.path.endsWith(".map") ||
        (file.path.endsWith(".ts") && !file.path.endsWith(".d.ts")) ||
        /(?:^|\/)(?:test|\.github|\.agents|\.env|scripts\/cases)(?:\/|\.|$)/iu.test(file.path),
    ),
    false,
  );

  const sharedCache = path.join(root, "shared-npm-home");
  const firstProject = installConsumer(path.join(root, "first"), tarball, sharedCache, false);
  const secondProject = installConsumer(path.join(root, "second"), tarball, sharedCache, true);
  const firstPackage = path.join(firstProject, "node_modules", "@tiangong-lca", "foundry");
  const secondPackage = path.join(secondProject, "node_modules", "@tiangong-lca", "foundry");
  installedRoots.push(firstPackage, secondPackage);
  const installedManifest = JSON.parse(
    fs.readFileSync(path.join(firstPackage, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  for (const forbidden of [
    "scripts",
    "devDependencies",
    "packageManager",
    "lint-staged",
    "private",
  ])
    assert.equal(Object.hasOwn(installedManifest, forbidden), false, forbidden);
  const api = (await import(
    pathToFileURL(path.join(firstPackage, "package-dist/scripts/public-api.js")).href
  )) as {
    assertFoundryPackage: (root: string) => {
      package: { name: string; version: string };
      runtime: { supported_platforms: string[] };
    };
    assertFoundryPackageDescriptor: (value: unknown) => unknown;
  };
  assert.equal(api.assertFoundryPackage(firstPackage).package.name, "@tiangong-lca/foundry");
  assert.equal(api.assertFoundryPackage(secondPackage).package.version, sourcePackageVersion);
  await verifyManagedPackageCache(firstPackage, root);
  const consumerModule = path.join(firstProject, "consumer.mjs");
  const apiWorkspace = path.join(root, "api workspace");
  fs.writeFileSync(
    consumerModule,
    `import * as foundry from '@tiangong-lca/foundry';\nimport { describeCliRuntime } from '@tiangong-lca/cli/runtime';\nconst cli = describeCliRuntime();\nconst doctor = foundry.createFoundryFacade({workspace:${JSON.stringify(apiWorkspace)}}).doctor();\nprocess.stdout.write(JSON.stringify({exports:Object.keys(foundry).sort(),cli:{name:cli.package.name,version:cli.package.version},doctor:doctor.status}));\n`,
  );
  const imported = command(
    process.execPath,
    [consumerModule],
    firstProject,
    isolatedEnvironment(path.join(root, "consumer-home")),
  );
  assert.equal(imported.status, 0, imported.stderr);
  const importedResult = JSON.parse(imported.stdout) as {
    exports: string[];
    cli: { name: string; version: string };
    doctor: string;
  };
  assert.deepEqual(importedResult.exports, [
    "FOUNDRY_COMMAND_NEXT_ACTION_BINDING_SCHEMA",
    "FOUNDRY_MIGRATED_WORKSPACE_SCHEMA",
    "FOUNDRY_MIGRATION_ACTIVATION_SCHEMA",
    "FOUNDRY_MIGRATION_ADOPTION_PLAN_SCHEMA",
    "FOUNDRY_MIGRATION_TRANSFER_PLAN_SCHEMA",
    "FOUNDRY_MIGRATION_TRANSFER_RECEIPT_SCHEMA",
    "FOUNDRY_OPERATION_RESULT_SCHEMA",
    "FOUNDRY_PACKAGE_DESCRIPTOR_SCHEMA",
    "FOUNDRY_RUNTIME_SELECTION_SCHEMA",
    "FOUNDRY_TASK_START_SPEC_SCHEMA",
    "FOUNDRY_WORKSPACE_MIGRATION_PLAN_SCHEMA",
    "FoundryPackageError",
    "assertFoundryOperationResult",
    "assertFoundryPackage",
    "assertFoundryPackageDescriptor",
    "commandNextActionBindingSha256",
    "createFoundryFacade",
    "createFoundryWorkspaceAccess",
    "exitCodeForFoundryOperationResult",
    "foundryOperationPermissionStates",
    "foundryOperationStatuses",
    "foundryPublicOperations",
    "parseFoundryTaskStartSpec",
    "runFoundryPublicCommand",
  ]);
  assert.deepEqual(importedResult.cli, { name: "@tiangong-lca/cli", version: "0.1.11" });
  assert.equal(importedResult.doctor, "ready");

  const typeSource = path.join(firstProject, "consumer.ts");
  fs.writeFileSync(
    typeSource,
    "import { createFoundryFacade, type FoundryOperationResult } from '@tiangong-lca/foundry';\nconst facade = createFoundryFacade({ workspace: '/tmp/example' });\nconst result: FoundryOperationResult = facade.doctor();\nvoid result;\n",
  );
  const typeConfig = path.join(firstProject, "tsconfig.json");
  fs.writeFileSync(
    typeConfig,
    JSON.stringify({
      compilerOptions: {
        target: "ES2024",
        lib: ["ES2024"],
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ["node"],
        typeRoots: [path.join(repoRoot, "node_modules/@types")],
      },
      files: [typeSource],
    }),
  );
  const typed = command(
    process.execPath,
    [path.join(repoRoot, "node_modules/typescript/bin/tsc"), "-p", typeConfig],
    firstProject,
    isolatedEnvironment(path.join(root, "type-home")),
  );
  assert.equal(typed.status, 0, typed.stderr || typed.stdout);

  const before = packageFiles(firstPackage);
  setReadOnly(firstPackage);
  const entry = path.join(firstPackage, "package-dist/scripts/package-entry.js");
  const cwd = path.join(root, "unrelated 中文 cwd");
  const workspace = path.join(root, "用户 workspace");
  fs.mkdirSync(cwd, { recursive: true });
  const initialized = runFacade(
    entry,
    cwd,
    ["workspace", "init", "--workspace", workspace, "--json"],
    0,
  );
  assert.equal(initialized.operation, "workspace.init");
  const doctor = runFacade(entry, cwd, ["doctor", "--workspace", workspace, "--json"], 0);
  assert.equal(doctor.status, "ready");
  const input = path.join(root, "flow.jsonl");
  const spec = path.join(root, "task.json");
  fs.writeFileSync(input, '{"flowDataSet":{}}\n');
  fs.writeFileSync(
    spec,
    `${JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "package-case",
      actor_id: "package-consumer",
      lane: "external-dataset-curated-import",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: input }],
      seed: null,
      account_intent: null,
      preparation: {
        operation: "dataset-curation-cleanup",
        type: "flow",
        input,
        source_input: null,
        output_directory: "outputs/cleanup",
      },
    })}\n`,
  );
  const started = runFacade(
    entry,
    cwd,
    ["task", "start", "--workspace", workspace, "--spec", spec, "--json"],
    0,
  );
  const taskId = String(started.task_id);
  assert.match(taskId, /^task-[0-9a-f]{64}-r0001$/u);
  const status = runFacade(
    entry,
    cwd,
    [
      "task",
      "status",
      "--workspace",
      workspace,
      "--task",
      taskId,
      "--actor",
      "package-consumer",
      "--json",
    ],
    0,
  );
  assert.equal(status.status, "ready");
  const resumed = runFacade(
    entry,
    cwd,
    [
      "task",
      "resume",
      "--workspace",
      workspace,
      "--task",
      taskId,
      "--actor",
      "package-consumer",
      "--json",
    ],
    0,
  );
  assert.equal(resumed.status, "ready");
  const migration = runFacade(
    entry,
    cwd,
    ["workspace", "migrate", "--workspace", workspace, "--dry-run", "--json"],
    0,
  );
  assert.equal(migration.operation, "workspace.migrate");
  const internal = runFacade(entry, cwd, ["profiles-list", "--workspace", workspace, "--json"], 2);
  assert.equal(internal.operation, "unknown");
  assert.deepEqual(packageFiles(firstPackage), before);

  const sourceWorkspace = path.join(root, "source workspace");
  const source = runFacade(
    path.join(repoRoot, "scripts/package-entry.ts"),
    cwd,
    ["workspace", "init", "--workspace", sourceWorkspace, "--json"],
    0,
  );
  assert.deepEqual(
    [source.schema, source.operation, source.status],
    [initialized.schema, initialized.operation, initialized.status],
  );

  const tampered = path.join(root, "tampered-package");
  fs.cpSync(firstPackage, tampered, { recursive: true });
  restoreWritable(tampered);
  fs.appendFileSync(path.join(tampered, "README.md"), "changed\n");
  assert.throws(
    () => api.assertFoundryPackage(tampered),
    (error: unknown) =>
      Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "package_file_changed",
      ),
  );
  fs.copyFileSync(path.join(firstPackage, "README.md"), path.join(tampered, "README.md"));
  fs.writeFileSync(path.join(tampered, "unexpected.txt"), "extra\n");
  assert.throws(
    () => api.assertFoundryPackage(tampered),
    (error: unknown) =>
      Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "package_file_set_changed",
      ),
  );
  fs.unlinkSync(path.join(tampered, "unexpected.txt"));
  const tamperedManifest = JSON.parse(fs.readFileSync(path.join(tampered, "package.json"), "utf8"));
  tamperedManifest.scripts = { postinstall: "must-never-run" };
  fs.writeFileSync(path.join(tampered, "package.json"), JSON.stringify(tamperedManifest));
  assert.throws(
    () => api.assertFoundryPackage(tampered),
    (error: unknown) =>
      Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "package_manifest_changed",
      ),
  );
  fs.copyFileSync(path.join(firstPackage, "package.json"), path.join(tampered, "package.json"));
  if (process.platform !== "win32") {
    fs.symlinkSync("README.md", path.join(tampered, "linked-readme"));
    assert.throws(
      () => api.assertFoundryPackage(tampered),
      (error: unknown) =>
        Boolean(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "package_file_invalid",
        ),
    );
    fs.unlinkSync(path.join(tampered, "linked-readme"));
    fs.symlinkSync(root, path.join(tampered, "node_modules"));
    assert.throws(
      () => api.assertFoundryPackage(tampered),
      (error: unknown) =>
        Boolean(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "package_file_invalid",
        ),
    );
    fs.unlinkSync(path.join(tampered, "node_modules"));
  }
  const descriptor = JSON.parse(
    fs.readFileSync(
      path.join(firstPackage, "package-dist/assets/foundry-package-descriptor.json"),
      "utf8",
    ),
  );
  assert.throws(() =>
    api.assertFoundryPackageDescriptor({
      ...descriptor,
      runtime: {
        ...descriptor.runtime,
        supported_platforms: [...descriptor.runtime.supported_platforms, "darwin-x64"],
      },
    }),
  );

  const orphan = path.join(root, "orphan-foundry");
  fs.cpSync(firstPackage, orphan, { recursive: true });
  restoreWritable(orphan);
  const forbiddenWorkspace = path.join(root, "must-not-exist");
  const absentCli = command(
    process.execPath,
    [
      path.join(orphan, "package-dist/scripts/package-entry.js"),
      "workspace",
      "init",
      "--workspace",
      forbiddenWorkspace,
      "--json",
    ],
    root,
    isolatedEnvironment(path.join(root, "orphan-home")),
  );
  assert.notEqual(absentCli.status, 0);
  assert.equal(fs.existsSync(forbiddenWorkspace), false);
  const tarballSha256 = createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
  assert.match(tarballSha256, /^[0-9a-f]{64}$/u);
});
