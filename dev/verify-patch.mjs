// L3 部署检查：用引擎同款解析器（js-yaml + !!js 标量）读本包的 cordis.patch.yml，
// 断言行里的 name 是普通字符串（写成 !!js 表达式会让引擎起不来）、引用的文件都在。
// 只读，不改任何文件。退出码：0 全过 / 1 有 FAIL / 2 环境不对（找不到引擎 js-yaml）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const PKG = import.meta.dirname ? path.join(import.meta.dirname, '..') : process.cwd();
const HOME = process.env.HOME;
const DSH_HOME = process.env.DSH_HOME || (HOME ? path.join(HOME, '..', 'dsh-home') : null);
const patchPath = process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(PKG, 'cordis.patch.yml');

function engineModules() {
  if (process.env.DSH_ENGINE_NODE_MODULES) return process.env.DSH_ENGINE_NODE_MODULES;
  if (!DSH_HOME) return null;
  const root = path.join(DSH_HOME, '..', 'engine');
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch { return null; }
  for (const d of dirs) {
    const cand = path.join(root, d, 'node_modules');
    if (fs.existsSync(path.join(cand, 'js-yaml'))) return cand;
  }
  return null;
}

const ENGINE = engineModules();
if (!ENGINE) {
  console.error('verify-patch: 找不到引擎 node_modules（设 DSH_ENGINE_NODE_MODULES，或保证 DSH_HOME 旁边有 engine/<hash>/node_modules）');
  process.exit(2);
}
const require = createRequire(path.join(ENGINE, 'js-yaml/package.json'));
const yaml = require(path.join(ENGINE, 'js-yaml'));

const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (d) => typeof d === 'string',
  construct: (d) => ({ __jsExpr: d }),
});

const R = [];
const ok = (name, detail = '') => R.push({ level: 'ok', name, detail });
const fail = (name, detail = '') => R.push({ level: 'fail', name, detail });

let doc = null;
try {
  doc = yaml.load(fs.readFileSync(patchPath, 'utf8'), { schema: yaml.JSON_SCHEMA.extend(JsExpr) });
  ok('patch 能被引擎同款解析器解析', path.basename(patchPath));
} catch (error) {
  fail('patch 解析失败', String(error?.message ?? error));
}

const pkgPath = path.join(PKG, 'package.json');
let pkg = null;
try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); ok('package.json 可解析'); }
catch (error) { fail('package.json 解析失败', String(error?.message ?? error)); }

if (doc) {
  if (!Array.isArray(doc)) fail('顶层必须是数组');
  const rows = (Array.isArray(doc) ? doc : []).flatMap((e) => e?.insert ?? []);
  if (!rows.length) fail('没有任何 insert 行');
  for (const row of rows) {
    const name = row?.name;
    if (typeof name !== 'string') fail(`行 ${row?.id ?? '?'} 的 name 不是字符串`, JSON.stringify(name)?.slice(0, 40));
    else ok(`行 ${row.id ?? '?'} 的 name 是字符串`, name);
    if (row?.config && typeof row.config !== 'object') fail(`行 ${row?.id ?? '?'} 的 config 不是对象`);
  }
}

if (pkg) {
  const bundle = pkg.dsh?.bundle?.patch;
  if (!bundle) fail('package.json 缺 dsh.bundle.patch（市场收录门槛）');
  else if (!fs.existsSync(path.join(PKG, bundle))) fail('dsh.bundle.patch 指向的文件不存在', bundle);
  else ok('dsh.bundle.patch 指向的文件存在', bundle);
  if (pkg.dsh?.client) fail('dsh.client 存在：Android 引擎没有 Web Client 层，装了不渲染', JSON.stringify(pkg.dsh.client));
  else ok('没有 dsh.client（手机侧纯 host）');
  const entry = pkg.exports?.['.'] ?? pkg.main;
  if (!entry) fail('没有 main / exports["."]');
  else if (!fs.existsSync(path.join(PKG, entry))) fail('入口文件不存在', entry);
  else ok('入口文件存在', entry);
  for (const [k, v] of Object.entries(pkg.exports ?? {})) {
    if (typeof v !== 'string' || k === '.' || v.startsWith('./package.json')) continue;
    if (!fs.existsSync(path.join(PKG, v))) fail(`exports["${k}"] 指向的文件不存在`, v);
  }
  if (Array.isArray(pkg.dsh?.capabilities) && pkg.dsh.capabilities.includes('fs:write')) {
    const src = fs.readFileSync(path.join(PKG, entry || 'index.mjs'), 'utf8');
    if (!/writeFileSync|writeFile/.test(src) && !/writeFileSync/.test(fs.readFileSync(path.join(PKG, 'lib/scaffold.mjs'), 'utf8'))) {
      fail('声明了 fs:write 但入口没看到写盘调用');
    } else ok('fs:write 声明与实现一致');
  }
}

for (const r of R) console.log(`${r.level === 'ok' ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? ' · ' + r.detail : ''}`);
const bad = R.filter((r) => r.level === 'fail').length;
console.log(`\n${bad ? '❌' : '✅'} ${R.length - bad} 过 / ${bad} 挂`);
process.exit(bad ? 1 : 0);
