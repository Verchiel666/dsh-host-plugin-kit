// dsh-plugin-kit · 脚手架核心（纯逻辑，CLI 与宿主插件共用同一份）
//
// 生成内容只由 { name, desc, prefix } 决定 → 同参数必然同字节，回归测试直接比文件。
// 这里只 import 两个 fs 函数，不读环境变量、不联网、不碰引擎，便于单测。

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** 只拼内容不落盘：返回 { 相对路径: 内容 }。 */
export function buildFiles({ name, desc, prefix }) {
const P = prefix;
const files = {};

files['package.json'] = JSON.stringify({
  name, version: '0.1.0', description: desc, type: 'module', main: 'index.mjs',
  exports: { '.': './index.mjs', './cordis.patch.yml': './cordis.patch.yml', './icon': './icon.svg', './package.json': './package.json' },
  files: ['index.mjs', 'lib/', 'cordis.patch.yml', 'icon.svg', 'locale/', 'README.md'],
  engines: { dsh: '>=0.2.0' },
  license: 'MIT',
  dsh: {
    bundle: { patch: './cordis.patch.yml' },
    capabilities: ['tools:register'],
    labels: [],
  },
}, null, 2) + '\n';

files['lib/core.mjs'] = `// 业务逻辑放这里，index.mjs 只做注册与协议适配（方便单测）。
export function hello(who = 'world') {
  return \`hello, \${who}!\`;
}

export function echo(text) {
  if (!text) throw new Error('text 不能为空');
  return { echoed: String(text), length: String(text).length };
}
`;

files['index.mjs'] = `// ${name} —— 由 dsh-plugin-kit 生成。
//
// 约定（三层验证都靠它）：
//   1. 导出 name / inject / apply；
//   2. 工具在 ctx.effect 里注册，返回 dispose 才能卸载干净；
//   3. 写类工具挂 tools/pre-execute 钩子，把 allow 升级成 ask（上游 deny 不许改写）。
import { hello, echo } from './lib/core.mjs';

export const name = '${P}';
export const inject = ['tools'];

const READ = 'risk: read (read-only)';
const WRITE = 'risk: write (changes the phone)';

const text = (t) => [{ type: 'text', text: t }];
const renderer = (_args, value) => (Array.isArray(value?.content) ? value.content : text(JSON.stringify(value, null, 2)));

export function apply(ctx, config = {}) {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('${P}') : { info() {}, warn() {} };
  const who = config.who || 'world';

  const tools = [
    {
      name: '${P}_hello',
      description: \`打个招呼（只读）。\\n[\${READ}]\`,
      parameters: {
        type: 'object',
        properties: { who: { type: 'string', description: '称呼，默认取配置 who' } },
      },
      timeoutMs: 10_000,
      isConcurrencySafe: () => true,
      output: { schema: {}, render: renderer },
      async execute(args) {
        return { content: text(hello(args?.who || who)) };
      },
    },
    {
      name: '${P}_write',
      description: \`示例写类工具：回显输入（真实插件里这里才真的写盘）。\\n[\${WRITE}]\`,
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '要写入的文本' } },
        required: ['text'],
      },
      timeoutMs: 30_000,
      isConcurrencySafe: () => false,
      output: { schema: {}, render: renderer },
      async execute(args) {
        const r = echo(args?.text);
        return { content: text(\`写入 \${r.length} 字符：\${r.echoed}\`) };
      },
    },
  ];

  const disposeFns = [];
  ctx.effect(() => {
    for (const def of tools) {
      if (ctx.tools.get?.(def.name) !== undefined) { logger.warn?.(\`\${def.name} 已存在，跳过\`); continue; }
      try { disposeFns.push(ctx.tools.register(def)); }
      catch (error) { logger.warn?.(\`注册 \${def.name} 失败：\${error?.message ?? error}\`); }
    }
    logger.info?.(\`${P}: 注册 \${disposeFns.length} 个工具\`);
    return () => { for (const dispose of disposeFns.splice(0)) { try { dispose(); } catch {} } };
  }, '${P}.tools');

  const WRITE_TOOLS = new Set(['${P}_write']);
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next();
    if (!WRITE_TOOLS.has(exec.name) || decision?.kind !== 'allow') return decision;
    let argsText = '';
    try { argsText = JSON.stringify(exec.arguments ?? {}); } catch {}
    if (argsText.length > 200) argsText = argsText.slice(0, 200) + '…';
    return { kind: 'ask', reason: \`${P} 的写类工具 \${exec.name} 要改东西：\${argsText}\` };
  });
}
`;

files['cordis.patch.yml'] = `# 把本插件插进 profile 的层栈。安装后重启引擎生效。
- insert:
    - id: ${P}
      name: ${name}
      config:
        who: ''
`;

files['icon.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#2f6f4f"/>
  <circle cx="32" cy="32" r="13" fill="none" stroke="#fff" stroke-width="5"/>
  <circle cx="32" cy="32" r="4" fill="#fff"/>
</svg>
`;

files['locale/zh-CN.json'] = JSON.stringify({
  [`${P}.name`]: desc,
  [`${P}.hello`]: '打个招呼',
  [`${P}.write`]: '示例写类工具',
}, null, 2) + '\n';

files['dev/test.mjs'] = `// 离线单测：不碰网络、不碰真引擎。\nimport assert from 'node:assert/strict';
import * as plugin from '../index.mjs';
import { hello, echo } from '../lib/core.mjs';

let pass = 0; const fails = [];
const t = async (label, fn) => {
  try { await fn(); pass++; console.log('  ok   ' + label); }
  catch (e) { fails.push(label); console.log('  FAIL ' + label + ' — ' + e.message); }
};

const makeCtx = () => {
  const registered = new Map();
  const hooks = [];
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    effect: (fn) => { const d = fn(); return d || (() => {}); },
    on: (ev, fn) => { hooks.push([ev, fn]); },
    tools: { register: (d) => { registered.set(d.name, d); return () => registered.delete(d.name); }, get: (n) => registered.get(n) },
  };
  plugin.apply(ctx, {});
  return { ctx, registered, hooks };
};

await t('导出 name / inject / apply', () => {
  assert.equal(plugin.name, '${P}');
  assert.deepEqual(plugin.inject, ['tools']);
  assert.equal(typeof plugin.apply, 'function');
});

await t('纯函数可测（hello / echo）', () => {
  assert.equal(hello('kit'), 'hello, kit!');
  assert.deepEqual(echo('ab'), { echoed: 'ab', length: 2 });
  assert.throws(() => echo(''), /不能为空/);
});

await t('注册 2 个工具', () => {
  const { registered } = makeCtx();
  assert.deepEqual([...registered.keys()].sort(), ['${P}_hello', '${P}_write']);
});

await t('hello 工具真能执行', async () => {
  const { registered } = makeCtx();
  const res = await registered.get('${P}_hello').execute({ who: 'world' });
  assert.match(res.content[0].text, /hello, world!/);
});

await t('write 工具真能执行（含校验）', async () => {
  const { registered } = makeCtx();
  const res = await registered.get('${P}_write').execute({ text: 'abc' });
  assert.match(res.content[0].text, /写入 3 字符/);
  await assert.rejects(() => registered.get('${P}_write').execute({}), /不能为空/);
});

await t('写类工具走审批：allow → ask，deny 不被动', async () => {
  const { hooks } = makeCtx();
  const [, fn] = hooks.find(([ev]) => ev === 'tools/pre-execute');
  assert.ok(fn, '没有挂 pre-execute');
  assert.equal((await fn({ name: '${P}_write', arguments: { text: 'x' } }, async () => ({ kind: 'allow' }))).kind, 'ask');
  assert.equal((await fn({ name: '${P}_hello', arguments: {} }, async () => ({ kind: 'allow' }))).kind, 'allow');
  assert.equal((await fn({ name: '${P}_write', arguments: {} }, async () => ({ kind: 'deny' }))).kind, 'deny');
});

console.log(\`\\n通过 \${pass} 项\${fails.length ? \`，失败 \${fails.length} 项：\${fails.join(' / ')}\` : ''}\`);
process.exit(fails.length ? 1 : 0);
`;

files['host-test/rt.mjs'] = `// 真 cordis 冒烟：验证 inject 满足、注册、execute、审批钩子、dispose 清理。
// cordis 从引擎自带的 host-test 目录解析（可用 DSH_HOST_TEST_DIR 覆盖）。
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import * as plugin from '../index.mjs';

const base = process.env.DSH_HOST_TEST_DIR || \`\${process.env.HOME}/work/host-test\`;
const require = createRequire(base + '/package.json');
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = async (label, fn) => {
  try { await fn(); pass++; console.log('PASS  ' + label); }
  catch (e) { fail++; console.log('FAIL  ' + label + '\\n      ' + e.message); }
};

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
await t('真 cordis 加载插件', async () => {
  fiber = ctx.plugin(plugin, {});
  await sleep(120);
  assert.ok(fiber);
  assert.equal(plugin.inject[0], 'tools');
});

await t('2 个工具注册进 ctx.tools', () => {
  assert.deepEqual([...registered.keys()].sort(), ['${P}_hello', '${P}_write']);
});

await t('hello 经 cordis 调 execute', async () => {
  const res = await registered.get('${P}_hello').execute({});
  assert.match(res.content[0].text, /hello,/);
});

await t('审批钩子生效', async () => {
  const [, fn] = hooks.find(([ev]) => ev === 'tools/pre-execute');
  assert.equal((await fn({ name: '${P}_write', arguments: { text: 'y' } }, async () => ({ kind: 'allow' }))).kind, 'ask');
});

await t('dispose 后工具被摘掉', async () => {
  await fiber.dispose();
  await sleep(60);
  assert.equal(registered.size, 0);
});

console.log(\`\\n\${fail ? '❌' : '✅'} 通过 \${pass} 项\${fail ? \`, 失败 \${fail} 项\` : ''}\`);
process.exit(fail ? 1 : 0);
`;

files['README.md'] = `# ${name}

${desc}

## 工具

| 工具 | 风险 | 作用 |
|---|---|---|
| \`${P}_hello\` | 只读 | 打个招呼 |
| \`${P}_write\` | 写盘（走审批） | 示例写类工具 |

## 开发流程（在手机上也能跑）

\`\`\`sh
node dev/test.mjs          # 离线单测（不碰网络）
node host-test/rt.mjs      # 真 cordis 冒烟（用引擎自带的那份 cordis）
\`\`\`

发布：

\`\`\`sh
# npm（新包首发会先进 staged 状态，约 40–120 s 后可见；发完务必下载 tarball 实际加载验证）
node \$HOME/tools/npm/bin/npm-cli.js publish
# GitHub（本机没有 git，走 REST API）
node \$HOME/work/gitpub/publish-github.mjs --dir . --owner <you> --repo ${name} --token-file \$HOME/.gh_token
\`\`\`

## 配置

\`\`\`yaml
- insert:
    - id: ${P}
      name: ${name}
      config:
        who: ''
\`\`\`

## 契约

- \`inject: ['tools']\`；工具在 \`ctx.effect\` 里注册并返回 dispose；
- 写类工具在 \`tools/pre-execute\` 里把 \`allow\` 升级成 \`ask\`，**不改写上游 deny**；
- 包内 \`dsh.capabilities\` 按实际用到的最小集合声明。

MIT
`;

files['.gitignore'] = `node_modules/\n*.tgz\n`;
  return files;
}

/** 校验 + 落盘。抛 Error 而不是 process.exit，好让工具层包成可读结果。 */
export function scaffold({ target, name, desc, prefix } = {}) {
  if (!target || !name) throw new Error('用法: scaffold({ target, name, desc?, prefix? })');
  if (!NAME_RE.test(name)) throw new Error('包名只能小写字母/数字/. _ -');
  if (existsSync(join(target, 'package.json'))) throw new Error(`目标目录已经有 package.json：${target}`);
  const P = prefix || name.replace(/^dsh[-/]?/, '').replace(/[-.]/g, '_') || 'demo';
  const D = desc || `${name}：一个 DSH 插件`;
  const files = buildFiles({ name, desc: D, prefix: P });
  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(target, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
    written.push(rel);
  }
  return { dir: target, packageName: name, prefix: P, files: written };
}
