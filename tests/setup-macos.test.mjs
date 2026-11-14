import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, writeFile, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
async function fixture(t,{platform='Darwin',arch='arm64',node='v24.11.1',curlFail=false,badHash=false}={}) {
 const root=await mkdtemp(path.join(os.tmpdir(),'setup with spaces '));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(path.join(root,'scripts'));await mkdir(path.join(root,'bin'));
 await copyFile(new URL('../scripts/setup-macos.sh',import.meta.url),path.join(root,'scripts/setup-macos.sh'));
 const put=async(name,body)=>writeFile(path.join(root,'bin',name),'#!/bin/bash\n'+body,{mode:0o755});
 await put('uname',`if [[ "$1" == -s ]]; then echo ${platform}; else echo ${arch}; fi`);
 await put('npm','exit 0');
 await put('node',`echo "$*" >> "$TEST_ROOT/calls"\n echo "$PATH" >> "$TEST_ROOT/paths"\nif [[ "$1" == --version ]]; then echo ${node}; elif [[ "$1" == -e ]]; then exec "$REAL_NODE" "$@"; elif [[ "$2" == install && "$1" == */npm ]]; then mkdir -p "$TEST_ROOT/.tools/pnpm/node_modules/pnpm/bin"; echo '{"version":"11.15.1","bin":{"pnpm":"bin/pnpm.mjs"}}' > "$TEST_ROOT/.tools/pnpm/node_modules/pnpm/package.json"; touch "$TEST_ROOT/.tools/pnpm/node_modules/pnpm/bin/pnpm.mjs"; elif [[ "$2" == --version ]]; then if [[ "$1" == *pnpm.mjs ]]; then echo 11.15.1; else echo 11.0.0; fi; fi`);
 await put('curl',curlFail?'exit 22':`while [[ "$1" != -o ]]; do shift; done\ncase "$2" in *SHASUMS256.txt) printf '${'a'.repeat(64)}  node-v24.11.1-darwin-${arch==='x86_64'?'x64':arch}.tar.gz\\n' > "$2";; *) echo fake > "$2";; esac`);
 await put('shasum',`echo '${(badHash?'b':'a').repeat(64)}  fixture'`);
 await put('tar','echo UNEXPECTED_TAR >> "$TEST_ROOT/calls"; exit 99');
 return {root,run:(args=[])=>spawnSync('/bin/bash',[path.join(root,'scripts/setup-macos.sh'),...args],{encoding:'utf8',env:{...process.env,PATH:path.join(root,'bin')+':/usr/bin:/bin',TEST_ROOT:root,REAL_NODE:process.execPath}})};
}
test('dry run supports both architectures and space-containing project paths without installing',async t=>{
 for(const arch of ['arm64','x86_64']){const f=await fixture(t,{arch});const r=f.run(['--dry-run']);assert.equal(r.status,0,r.stderr);assert.ok(r.stdout.includes(f.root));assert.match(r.stdout,/11\.15\.1/);await assert.rejects(readFile(path.join(f.root,'calls')));}
});
test('existing compatible Node uses local pnpm prefix and frozen install',async t=>{
 const f=await fixture(t);const r=f.run();assert.equal(r.status,0,r.stderr);const calls=await readFile(path.join(f.root,'calls'),'utf8');assert.match(calls,/pnpm@11\.15\.1/);assert.match(calls,/--frozen-lockfile/);assert.match(calls,/build:ui/);assert.ok(calls.includes(path.join(f.root,'.tools/pnpm')));assert.doesNotMatch(calls,/UNEXPECTED_TAR|--global/);const paths=(await readFile(path.join(f.root,'paths'),'utf8')).trim().split('\n');assert.ok(paths.at(-1).startsWith(path.join(f.root,'.tools/pnpm/node_modules/.bin')+':')); 
});
test('unsupported OS, architecture and arguments stop immediately',async t=>{
 for(const options of [{platform:'Linux'},{arch:'sparc'}]){const f=await fixture(t,options);assert.notEqual(f.run().status,0)}
 const f=await fixture(t);assert.notEqual(f.run(['--unknown']).status,0);
});
test('failed curl stops before extraction or package installation',async t=>{
 const f=await fixture(t,{node:'v20.0.0',curlFail:true});const r=f.run();assert.notEqual(r.status,0);const calls=await readFile(path.join(f.root,'calls'),'utf8');assert.doesNotMatch(calls,/UNEXPECTED_TAR|pnpm@/);
});
test('SHA256 mismatch never extracts or runs the downloaded binary',async t=>{
 const f=await fixture(t,{node:'v20.0.0',badHash:true});const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/SHA256 校验失败/);const calls=await readFile(path.join(f.root,'calls'),'utf8');assert.doesNotMatch(calls,/UNEXPECTED_TAR|pnpm@/);
});
test('real Node resolves the package-declared mjs entry and rejects version drift or traversal',async t=>{
 const f=await fixture(t);const source=await readFile(new URL('../scripts/setup-macos.sh',import.meta.url),'utf8');
 const code=source.match(/PNPM_CLI="\$\("\$NODE_BIN" -e '\n([\s\S]*?)\n' /)[1];
 const dir=path.join(f.root,'package');await mkdir(path.join(dir,'bin'),{recursive:true});await writeFile(path.join(dir,'bin/pnpm.mjs'),'');
 const run=()=>spawnSync(process.execPath,['-e',code,dir,'11.15.1'],{encoding:'utf8'});
 await writeFile(path.join(dir,'package.json'),JSON.stringify({version:'11.15.1',bin:{pnpm:'bin/pnpm.mjs'}}));assert.equal(run().stdout,path.join(dir,'bin/pnpm.mjs'));
 for(const pkg of [{version:'11.25.0',bin:{pnpm:'bin/pnpm.mjs'}},{version:'11.15.1',bin:{pnpm:'../escape.mjs'}}]){
  await writeFile(path.join(dir,'package.json'),JSON.stringify(pkg));assert.notEqual(run().status,0);
 }
});
