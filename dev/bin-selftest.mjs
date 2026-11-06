// 脚手架自测：生成一个临时插件，跑它的两套测试，断言全绿。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'kit-selftest-'));
let pass = 0, fail = 0;
const t = (label, fn) => {
  try { fn(); pass++; console.log('PASS  ' + label); }
  catch (e) { fail++; console.log('FAIL  ' + label + '\n      ' + e.message); }
};

t('生成骨架', () => {
  const r = spawnSync(process.execPath, [join(import.meta.dirname, '..', 'new.mjs'), dir, '--name', 'dsh-kitdemo'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
});

t('生成的 dev/test.mjs 全绿', () => {
  const r = spawnSync(process.execPath, [join(dir, 'dev', 'test.mjs')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stdout || '') + (r.stderr || ''));
  if (!/通过 6 项/.test(r.stdout)) throw new Error('输出不含「通过 6 项」：' + r.stdout.slice(-200));
});

t('生成的 host-test/rt.mjs 全绿（真 cordis）', () => {
  const r = spawnSync(process.execPath, [join(dir, 'host-test', 'rt.mjs')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stdout || '') + (r.stderr || ''));
  if (!/通过 5 项/.test(r.stdout)) throw new Error('输出不含「通过 5 项」：' + r.stdout.slice(-200));
});

t('拒绝覆盖已有插件目录', () => {
  const r = spawnSync(process.execPath, [join(import.meta.dirname, '..', 'new.mjs'), dir, '--name', 'dsh-kitdemo'], { encoding: 'utf8' });
  if (r.status === 0) throw new Error('第二次生成应当失败');
  if (!/已经有 package.json/.test(r.stderr || '')) throw new Error('错误信息不对：' + r.stderr);
});

rmSync(dir, { recursive: true, force: true });
console.log(`\n通过 ${pass} 项${fail ? `，失败 ${fail} 项` : ''}`);
process.exit(fail ? 1 : 0);
