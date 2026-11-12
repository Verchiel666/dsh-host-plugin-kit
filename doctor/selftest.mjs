#!/usr/bin/env node
// dsh-doctor 自测：正例必须全过、反例必须逐条拦下、本机真实 patch 必须 0 FAIL。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const run = (file) => {
  const r = spawnSync(process.execPath, [path.join(DIR, 'doctor.mjs'), ...(file ? [file] : []), '--json'], { encoding: 'utf8' })
  let j = null
  try { j = JSON.parse(r.stdout) } catch { j = null }
  return { code: r.status, out: r.stdout + r.stderr, j }
}
const msgs = (j) => (j?.results || []).map((x) => `${x.level}:${x.name}`)
let pass = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok', name) } else { console.log('  FAIL', name, extra); process.exitCode = 1 }
}

// 1) 正例：fixture 里的 name 路径换成「本机真存在的文件」，仓库里只留通用占位路径
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir() || os.homedir(), 'doctor-self-'))
const fakePlugin = path.join(TMP, 'plugin.mjs')
fs.writeFileSync(fakePlugin, '// fixture\n')
const goodPath = path.join(TMP, 'good.yml')
fs.writeFileSync(goodPath, fs.readFileSync(path.join(DIR, 'fixtures/good.yml'), 'utf8').replace('/opt/dsh/plugins/dsh-usage/index.mjs', fakePlugin))
const good = run(goodPath)
check('正例 exit=0', good.code === 0, `exit=${good.code} ${good.out.slice(0, 200)}`)
check('正例 0 fail', (good.j?.counts?.fail ?? -1) === 0)
check('正例识别出 name 绝对路径', msgs(good.j).some((m) => m.includes('name 是存在绝对路径')))
check('正例 !!js 位置合法', msgs(good.j).some((m) => m.includes('!!js 位置合法')))

// 2) 反例：六类错误一条不少
const bad = run(path.join(DIR, 'fixtures/bad.yml'))
check('反例 exit=1', bad.code === 1, `exit=${bad.code}`)
const bm = msgs(bad.j).join(' | ')
check('拦下 name 是 !!js', bm.includes('name 是 !!js 表达式'))
check('拦下相对路径 name', bm.includes('name 是相对路径'))
check('拦下不存在绝对路径', bm.includes('name 指向不存在的路径'))
check('拦下解析不到的包名', bm.includes('包名但解析不到'))
check('拦下 config 外的 !!js', bm.includes('!!js 出现在 config 之外'))
check('拦下重复 id', bm.includes('id 重复'))
check('反例 fail 数 >= 8', (bad.j?.counts?.fail ?? 0) >= 8, `fail=${bad.j?.counts?.fail}`)

// 3) 本机真实 profile
const real = run(null)
check('真实 patch exit=0', real.code === 0, `exit=${real.code} ${real.out.slice(0, 300)}`)
check('真实 patch 0 fail', (real.j?.counts?.fail ?? -1) === 0, JSON.stringify(real.j?.counts))
check('真实 patch 检查了依赖版本', msgs(real.j).some((m) => m.includes('依赖全部钉死') || m.includes('依赖版本没钉死')))
check('真实 patch 读到了 insert 行', msgs(real.j).some((m) => m.includes('读到')))

fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\n${pass} 项自测通过`)
