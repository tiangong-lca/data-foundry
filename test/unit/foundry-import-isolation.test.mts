import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("importing the Foundry entry never discovers operator state, writes files or dispatches a CLI", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-import-isolation-"));
  try {
    const probe = `
      import fs from 'node:fs';
      import path from 'node:path';
      import {syncBuiltinESMExports} from 'node:module';
      import {pathToFileURL,fileURLToPath} from 'node:url';
      const entry=process.argv[1];
      const packageRoot=path.dirname(path.dirname(entry));
      const isolatedRoot=process.cwd();
      const attempts=[];
      function protectedPath(value) {
        if (typeof value==='number') return false;
        const raw=value instanceof URL ? fileURLToPath(value) : String(value);
        const file=path.resolve(raw).replaceAll('\\\\','/');
        const root=packageRoot.replaceAll('\\\\','/');
        const isolated=isolatedRoot.replaceAll('\\\\','/');
        return file===isolated || file.startsWith(isolated+'/') ||
          file===root+'/.env' || file.startsWith(root+'/.foundry/') ||
          file===root+'/.foundry' || file.startsWith(root+'/tasks/');
      }
      for (const method of ['existsSync','statSync','lstatSync','readFileSync','readdirSync','openSync']) {
        const original=fs[method].bind(fs);
        fs[method]=(...args)=>{
          if (!protectedPath(args[0])) return original(...args);
          attempts.push(method+':operator-state');
          if (method==='existsSync') return false;
          throw new Error('Operator-state read blocked by test before filesystem access.');
        };
      }
      for (const method of ['writeFileSync','appendFileSync','mkdirSync','renameSync','rmSync','unlinkSync']) {
        fs[method]=()=>{attempts.push(method+':write');throw new Error('Import-time write blocked by test.');};
      }
      syncBuiltinESMExports();
      const stdout=process.stdout.write.bind(process.stdout);
      const stderr=process.stderr.write.bind(process.stderr);
      const exit=process.exit;
      let outputCalls=0;
      let exitCalls=0;
      process.exit=()=>{exitCalls++;};
      process.stdout.write=()=>{outputCalls++;return true;};
      process.stderr.write=()=>{outputCalls++;return true;};
      let imported=false;
      try {await import(pathToFileURL(entry));imported=true;} catch {}
      await new Promise(resolve=>setImmediate(resolve));
      process.stdout.write=stdout;process.stderr.write=stderr;
      process.exit=exit;process.exitCode=0;
      stdout(JSON.stringify({imported,attempts,outputCalls,exitCalls})+'\\n');
    `;
    const env: NodeJS.ProcessEnv = { HOME: workspace, USERPROFILE: workspace };
    for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"]) {
      if (process.env[key]) env[key] = process.env[key];
    }
    // Deliberately omit the env-disabled test switch. Interception must prove the
    // default import is safe, while refusing any actual read of operator .env/state.
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", probe, path.join(repoRoot, "scripts/foundry.ts")],
      { cwd: workspace, env, encoding: "utf8", timeout: 15_000, maxBuffer: 512 * 1024 },
    );
    assert.equal(result.status, 0, "Import probe must complete without terminating the host.");
    const observed = JSON.parse(result.stdout) as {
      imported: boolean;
      attempts: string[];
      outputCalls: number;
      exitCalls: number;
    };
    assert.equal(observed.imported, true, JSON.stringify(observed));
    assert.deepEqual(observed.attempts, []);
    assert.equal(observed.outputCalls, 0);
    assert.equal(observed.exitCalls, 0);
    assert.deepEqual(fs.readdirSync(workspace), []);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
