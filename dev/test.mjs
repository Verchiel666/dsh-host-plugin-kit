// L1 离线单测：不联网、不碰真引擎。验纯逻辑 + 落盘结果 + 插件工具面。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFiles, scaffold, NAME_RE } from '../lib/scaffold.mjs';
import * as plugin from '../index.mjs';

let pass = 0;
const fails = [];
const t = async (label, fn) => {
  try { await fn(); pass++; console.log('  ok   ' + label); }
  catch (e) { fails.push(label); console.log('  FAIL ' + label + ' — ' + e.message); }
};

/** 找一个真能写的临时目录：先看环境变量，再退 home（手机上 /tmp 不可写）。 */
function mkTmp(tag) {
  const cands = [process.env.KIT_TEST_TMP, process.env.TMPDIR, os.tmpdir(), path.join(os.homedir(), 'work', 'tmpdir')].filter(Boolean);
  for (const c of cands) {
    try { fs.mkdirSync(c, { recursive: true }); return fs.mkdtempSync(path.join(c, tag)); } catch {}
  }
  throw new Error('没有可写的临时目录');
}

const ARGS = { name: 'dsh-probe', desc: '探针插件', prefix: 'probe' };

await t('buildFiles 是纯函数：同参数两次逐字节相同', () => {
  const a = buildFiles(ARGS), b = buildFiles(ARGS);
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  for (const k of Object.keys(a)) assert.equal(a[k], b[k], k + ' 不一致');
});

await t('生成 10 个文件，关键文件齐全', () => {
  const f = buildFiles(ARGS);
  assert.equal(Object.keys(f).length, 10);
  for (const k of ['package.json', 'index.mjs', 'lib/core.mjs', 'cordis.patch.yml', 'dev/test.mjs', 'host-test/rt.mjs', 'README.md', 'icon.svg', 'locale/zh-CN.json', '.gitignore']) {
    assert.ok(k in f, '缺 ' + k);
  }
});

await t('生成的 package.json 带 dsh.bundle.patch，且没有 dsh.client（手机渲染不了）', () => {
  const pkg = JSON.parse(buildFiles(ARGS)['package.json']);
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.ok(Array.isArray(pkg.dsh.capabilities) && pkg.dsh.capabilities.length > 0);
  assert.equal(pkg.dsh.client, undefined);
});

await t('scaffold 真落盘，并返回写出的文件清单', () => {
  const dir = path.join(mkTmp('kit-l1-'), 'probe');
  const r = scaffold({ target: dir, ...ARGS });
  assert.equal(r.files.length, 10);
  for (const rel of r.files) assert.ok(fs.existsSync(path.join(dir, rel)), rel + ' 没写出来');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name, 'dsh-probe');
});

await t('scaffold 拒绝覆盖已存在的插件目录', () => {
  const dir = path.join(mkTmp('kit-l1-'), 'dup');
  scaffold({ target: dir, ...ARGS });
  assert.throws(() => scaffold({ target: dir, ...ARGS }), /已经有 package.json/);
});

await t('默认 desc / prefix：dsh-hello → 工具前缀 hello', () => {
  const dir = path.join(mkTmp('kit-l1-'), 'dsh-hello');
  scaffold({ target: dir, name: 'dsh-hello' });
  const idx = fs.readFileSync(path.join(dir, 'index.mjs'), 'utf8');
  assert.match(idx, /hello_hello/);
  assert.match(idx, /hello_write/);
  assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /dsh-hello：一个 DSH 插件/);
});

await t('包名校验拒绝大写与空格', () => {
  assert.equal(NAME_RE.test('dsh-good_1.2'), true);
  assert.equal(NAME_RE.test('Bad Name'), false);
  assert.throws(() => scaffold({ target: path.join(mkTmp('kit-l1-'), 'x'), name: 'Bad Name' }), /包名只能/);
});

await t('插件导出面：name / inject / apply', () => {
  assert.equal(plugin.name, 'plugin_kit');
  assert.deepEqual(plugin.inject, ['tools']);
  assert.equal(typeof plugin.apply, 'function');
  assert.equal(plugin.Config, undefined, '不能导出 Config');
});

const makeCtx = () => {
  const registered = new Map();
  const disposers = [];
  const hooks = [];
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d || (() => {}); },
    on: (ev, fn) => { hooks.push([ev, fn]); },
    tools: { register: (d) => { registered.set(d.name, d); return () => registered.delete(d.name); }, get: (n) => registered.get(n) },
  };
  plugin.apply(ctx, {});
  return { ctx, registered, hooks, disposers };
};

await t('注册 1 个工具 plugin_kit_new，且带 risk 政策行', () => {
  const { registered } = makeCtx();
  assert.deepEqual([...registered.keys()], ['plugin_kit_new']);
  assert.match(registered.get('plugin_kit_new').description, /\[risk: write/);
});

await t('工具真能执行：写到临时目录', async () => {
  const { registered } = makeCtx();
  const dir = path.join(mkTmp('kit-l1-'), 'dsh-from-tool');
  const res = await registered.get('plugin_kit_new').execute({ dir, desc: '工具生成' });
  const out = res.content[0].text;
  assert.match(out, /已生成 10 个文件/);
  assert.match(out, /dev\/test\.mjs/);
  assert.ok(fs.existsSync(path.join(dir, 'cordis.patch.yml')));
});

await t('工具错误路径都变成可读文本，不抛', async () => {
  const { registered } = makeCtx();
  const tool = registered.get('plugin_kit_new');
  assert.match((await tool.execute({})).content[0].text, /dir 不能为空/);
  assert.match((await tool.execute({ dir: 'relative/path' })).content[0].text, /必须是绝对路径/);
  const dir = path.join(mkTmp('kit-l1-'), 'again');
  await tool.execute({ dir, desc: 'x' });
  assert.match((await tool.execute({ dir, desc: 'x' })).content[0].text, /已经有 package.json/);
});

await t('~ 展开到 home', async () => {
  const { registered } = makeCtx();
  const rel = 'kit-l1-home-' + Date.now();
  const res = await registered.get('plugin_kit_new').execute({ dir: '~/' + rel, desc: 'x' });
  const dir = path.join(os.homedir(), rel);
  assert.match(res.content[0].text, /已生成 10 个文件/);
  assert.ok(fs.existsSync(path.join(dir, 'package.json')));
  fs.rmSync(dir, { recursive: true, force: true });
});

await t('审批钩子：allow→ask（只对本工具），deny 不被动', async () => {
  const { hooks } = makeCtx();
  const [, fn] = hooks.find(([ev]) => ev === 'tools/pre-execute');
  assert.ok(fn, '没有挂 pre-execute');
  const allow = async () => ({ kind: 'allow' });
  assert.equal((await fn({ name: 'plugin_kit_new', arguments: { dir: '/x' } }, allow)).kind, 'ask');
  assert.equal((await fn({ name: 'plugin_kit_new', arguments: { dir: '/x' } }, async () => ({ kind: 'deny' }))).kind, 'deny');
  assert.equal((await fn({ name: 'other_tool', arguments: {} }, allow)).kind, 'allow');
});

await t('dispose 后工具被摘掉', () => {
  const { registered, disposers } = makeCtx();
  assert.equal(registered.size, 1);
  for (const d of disposers) d();
  assert.equal(registered.size, 0);
});

console.log(`\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项：${fails.join(' / ')}` : ''}`);
process.exit(fails.length ? 1 : 0);
