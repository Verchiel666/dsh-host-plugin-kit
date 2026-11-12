#!/usr/bin/env node
// dsh-plugin-kit —— 一条命令生成 DSH 插件骨架（host 侧：工具 + 审批钩子 + 三层验证）。
// 用法：node new.mjs <目标目录> --name dsh-hello [--desc "一句话"] [--prefix hello]
//
// 0.2.0 起生成逻辑在 lib/scaffold.mjs：CLI 与宿主插件（index.mjs 的 plugin_kit_new 工具）
// 共用同一份实现，避免"命令行能生成、插件里行为不一样"。
import { basename } from 'node:path';
import { scaffold } from './lib/scaffold.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').startsWith('--'));
const target = positional[0];
const name = arg('--name') || (target ? basename(target) : null);

if (!target || !name) {
  console.error('用法: node new.mjs <目标目录> --name dsh-hello [--desc "一句话"] [--prefix hello]');
  process.exit(2);
}

let out;
try {
  out = scaffold({ target, name, desc: arg('--desc'), prefix: arg('--prefix') });
} catch (error) {
  console.error(String(error?.message ?? error));
  process.exit(2);
}

console.log(`已生成 ${out.files.length} 个文件 → ${out.dir}`);
console.log(`\n下一步：`);
console.log(`  cd ${out.dir}`);
console.log(`  node dev/test.mjs        # 离线单测`);
console.log(`  node host-test/rt.mjs    # 真 cordis 冒烟`);
