// L2 真 cordis 冒烟：用「引擎里那份真 cordis」加载本插件，验注册 / 执行 / 审批钩子 / dispose。
//
// cordis 从哪来：优先环境变量 DSH_HOST_TEST_DIR（一个装了 @deepseek-ai/cordis 的目录），
// 其次 <HOME>/work/host-test，最后从本目录的 node_modules 找。都没有就明确失败，不做静默降级。
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as plugin from '../index.mjs';

const ROOT = path.dirname(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname));
const cands = [
  process.env.DSH_HOST_TEST_DIR,
  process.env.HOME ? path.join(process.env.HOME, 'work', 'host-test') : null,
  ROOT,
].filter(Boolean);
const base = cands.find((d) => {
  try { return fs.existsSync(createRequire(path.join(d, 'package.json')).resolve('@deepseek-ai/cordis')); } catch { return false; }
});
if (!base) {
  console.error('dev/rt.mjs: 找不到 @deepseek-ai/cordis。设 DSH_HOST_TEST_DIR 指向一个装了它的目录（例如引擎的 node_modules 上层）。');
  process.exit(2);
}
const require = createRequire(path.join(base, 'package.json'));
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = async (label, fn) => {
  try { await fn(); pass++; console.log('PASS  ' + label); }
  catch (e) { fail++; console.log('FAIL  ' + label + '\n      ' + (e?.message ?? e)); }
};

const tmpBase = process.env.TMPDIR || os.tmpdir() || os.homedir();
fs.mkdirSync(tmpBase, { recursive: true });
const tmp = fs.mkdtempSync(path.join(tmpBase, 'rt-plugin-kit-'));

const ctx = new Context();
const registered = new Map();
ctx.provide('tools', {
  register(def) { registered.set(def.name, def); return () => registered.delete(def.name); },
  get(n) { return registered.get(n); },
});
const hooks = [];
const origOn = ctx.on.bind(ctx);
ctx.on = (ev, fn, prepend) => { hooks.push([ev, fn]); return origOn(ev, fn, prepend); };

let fiber;
await t('真 cordis 加载插件（inject 满足）', async () => {
  fiber = ctx.plugin(plugin, {});
  await sleep(150);
  assert.ok(fiber);
  assert.deepEqual(plugin.inject, ['tools']);
});

await t('plugin_kit_new 注册进 ctx.tools', () => {
  assert.deepEqual([...registered.keys()], ['plugin_kit_new']);
  assert.equal(registered.get('plugin_kit_new').isConcurrencySafe(), false);
});

await t('经 cordis 调 execute 真落盘', async () => {
  const dir = path.join(tmp, 'dsh-rt');
  const res = await registered.get('plugin_kit_new').execute({ dir, desc: 'L2 冒烟' });
  assert.match(res.content[0].text, /已生成 10 个文件/);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
});

await t('审批钩子生效：allow → ask', async () => {
  const [, fn] = hooks.find(([ev]) => ev === 'tools/pre-execute');
  assert.ok(fn, '没有挂 tools/pre-execute');
  const d = await fn({ name: 'plugin_kit_new', arguments: { dir: '/data/x' } }, async () => ({ kind: 'allow' }));
  assert.equal(d.kind, 'ask');
  assert.match(d.reason, /plugin_kit/);
});

await t('dispose 后工具被摘掉', async () => {
  await fiber.dispose();
  await sleep(80);
  assert.equal(registered.size, 0);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项${fail ? `，失败 ${fail} 项` : ''}`);
process.exit(fail ? 1 : 0);
