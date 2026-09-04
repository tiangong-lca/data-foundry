import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("command applications return results without loading env, exiting or sharing workspace bindings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-application-"));
  try {
    for (const label of ["left", "right"]) {
      const directory = path.join(root, label);
      fs.mkdirSync(path.join(directory, "specs"), { recursive: true });
      fs.writeFileSync(
        path.join(directory, "specs", "import-profiles.json"),
        JSON.stringify({
          schema_version: 2,
          default_profile: "generic",
          profiles: { generic: { description: label } },
        }),
      );
      fs.writeFileSync(path.join(directory, "rows.jsonl"), "");
    }
    const probe = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import path from 'node:path';
      import {syncBuiltinESMExports} from 'node:module';
      import {pathToFileURL,fileURLToPath} from 'node:url';
      const beforeEnv={...process.env};
      const attempts=[];
      let phase='construct';
      const root=process.cwd();
      const stdout=process.stdout.write.bind(process.stdout);
      const stderr=process.stderr.write.bind(process.stderr);
      const exit=process.exit;
      let outputCalls=0, exitCalls=0;
      for (const method of ['existsSync','statSync','lstatSync','readFileSync','readdirSync','openSync']) {
        const original=fs[method].bind(fs);
        fs[method]=(...args)=>{
          const raw=args[0] instanceof URL ? fileURLToPath(args[0]) : String(args[0]);
          const value=path.resolve(raw).replaceAll('\\\\','/');
          if (/(?:^|\\/)\\.env(?:[.\\/]|$)/u.test(value) ||
            (phase==='construct' && (value.startsWith(root.replaceAll('\\\\','/')+'/') || /\\/(?:\\.foundry|tasks)(?:\\/|$)/u.test(value)))) {
            attempts.push(method+':operator-state');
            throw new Error('Unexpected operator state access.');
          }
          return original(...args);
        };
      }
      syncBuiltinESMExports();
      process.stdout.write=()=>{outputCalls++;return true;};
      process.stderr.write=()=>{outputCalls++;return true;};
      process.exit=()=>{exitCalls++;throw new Error('Host exit forbidden.');};
      let created=false, failure=null, labels=[];
      try {
        const entry=await import(pathToFileURL(process.argv[1]));
        if (typeof entry.createFoundryApplication!=='function') {
          // Exercise the former only composition path. Reads are intercepted before
          // any real operator .env/state can be accessed, including on RED.
          entry.main([process.execPath,process.argv[1],'profiles-list']);
          throw new Error('Only the process-owning entry is available.');
        }
        const left=entry.createFoundryApplication({repoRoot:path.join(root,'left')});
        const right=entry.createFoundryApplication({repoRoot:path.join(root,'right')});
        created=true;phase='execute';
        for(const app of [left,right,left]) {
          const result=await app.execute('profiles-list');
          labels.push(result.profiles.generic.description);
        }
        const results=await Promise.all([left,right].map(app=>app.execute('dataset-curation-cleanup', {
          type:'flow', rowsFile:'rows.jsonl', outDir:'outputs/cleanup'
        })));
        assert.ok(results.every(result=>result.status==='completed'));
        await assert.rejects(left.execute('constructor'),/Unknown Foundry command/u);
        await assert.rejects(right.execute('definitely-unknown'),/Unknown Foundry command/u);
        assert.deepEqual({...process.env},beforeEnv);
      } catch(error) {failure=error instanceof Error ? error.message : 'failure';}
      await new Promise(resolve=>setImmediate(resolve));
      process.stdout.write=stdout;process.stderr.write=stderr;process.exit=exit;process.exitCode=0;
      stdout(JSON.stringify({created,failure,attempts,labels,outputCalls,exitCalls})+'\\n');
    `;
    const env: NodeJS.ProcessEnv = { HOME: root, USERPROFILE: root };
    for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"]) {
      if (process.env[key]) env[key] = process.env[key];
    }
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", probe, path.join(repoRoot, "scripts/foundry.ts")],
      { cwd: root, env, encoding: "utf8", timeout: 15_000, maxBuffer: 512 * 1024 },
    );
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.deepEqual(observed, {
      created: true,
      failure: null,
      attempts: [],
      labels: ["left", "right", "left"],
      outputCalls: 0,
      exitCalls: 0,
    });
    for (const label of ["left", "right"]) {
      assert.ok(fs.statSync(path.join(root, label, "outputs", "cleanup")).isDirectory());
      assert.equal(fs.existsSync(path.join(root, label, ".foundry")), false);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
