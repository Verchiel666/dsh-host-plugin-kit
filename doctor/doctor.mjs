#!/usr/bin/env node
// dsh-doctor：改 profile 的 cordis.patch.yml / 装插件之前先跑一遍。
// 只读：读 patch、profile package.json、node_modules/<pkg>/package.json，不改任何文件、不跑 pnpm。
// 用法: node doctor.mjs [patch路径] [--json]
// 退出码: 0 全过（warn 不算错）/ 1 有 FAIL / 2 环境不对（找不到引擎 js-yaml）

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const HOME = process.env.HOME
const DSH_HOME = process.env.DSH_HOME || (HOME ? path.join(HOME, '..', 'dsh-home') : null)
const PROFILE_DIR = process.env.DSH_PROFILE_DIR
  || (DSH_HOME ? path.join(DSH_HOME, 'profiles', process.env.DSH_PROFILE || 'android') : null)
const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const patchPath = argv.find((a) => !a.startsWith('--'))
  || (PROFILE_DIR ? path.join(PROFILE_DIR, 'cordis.patch.yml') : null)

const R = []
const ok = (name, detail = '') => R.push({ level: 'ok', name, detail })
const warn = (name, detail = '') => R.push({ level: 'warn', name, detail })
const fail = (name, detail = '') => R.push({ level: 'fail', name, detail })

/** 引擎的 node_modules：优先环境变量，其次按 <DSH_HOME>/../engine/<hash>/node_modules 自动发现。 */
function engineModules() {
  if (process.env.DSH_ENGINE_NODE_MODULES) return process.env.DSH_ENGINE_NODE_MODULES
  if (!DSH_HOME) return null
  const root = path.join(DSH_HOME, '..', 'engine')
  let dirs = []
  try { dirs = fs.readdirSync(root) } catch { return null }
  for (const d of dirs) {
    const cand = path.join(root, d, 'node_modules')
    if (fs.existsSync(path.join(cand, 'js-yaml'))) return cand
  }
  return null
}

function bail(msg) {
  if (asJson) console.log(JSON.stringify({ ok: false, error: msg }, null, 2))
  else console.error(`dsh-doctor: ${msg}`)
  process.exit(2)
}

if (!PROFILE_DIR) bail('找不到 profile 目录：设 DSH_PROFILE_DIR 或 DSH_HOME')
if (!patchPath) bail('没给 patch 路径，也推导不出 profile 目录')
if (!fs.existsSync(patchPath)) bail(`patch 文件不存在: ${patchPath}`)

const ENGINE = engineModules()
if (!ENGINE) bail('找不到引擎 node_modules（设 DSH_ENGINE_NODE_MODULES，或保证 DSH_HOME 旁边有 engine/<hash>/node_modules）')
const isProfilePatch = path.resolve(patchPath) === path.resolve(PROFILE_DIR, 'cordis.patch.yml')
const require = createRequire(path.join(ENGINE, 'js-yaml/package.json'))
const yaml = require(path.join(ENGINE, 'js-yaml'))

// —— 引擎同款方言：JSON_SCHEMA + !!js 标量 ——
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (d) => typeof d === 'string',
  construct: (d) => ({ __jsExpr: d }),
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

const raw = fs.readFileSync(patchPath, 'utf8')
let doc
try { doc = yaml.load(raw, { schema }) } catch (e) { bail(`YAML 解析失败（引擎也会在这里起不来）: ${e.message}`) }
ok('patch 能被引擎同款方言解析', path.basename(patchPath))
if (!Array.isArray(doc)) { fail('顶层必须是数组', `实际是 ${typeof doc}`); report() }

const patches = doc
const inserts = []
for (const [i, p] of patches.entries()) {
  if (p && Array.isArray(p.insert)) for (const [j, e] of p.insert.entries()) inserts.push({ e, at: `patch[${i}].insert[${j}]` })
  else if (p && typeof p === 'object') inserts.push({ e: p, at: `patch[${i}]` })
}
ok(`读到 ${patches.length} 个 patch / ${inserts.length} 个 entry`, '')
if (!inserts.length) warn('patch 里没有 entry', '只有注释或空数组？')

// 1) id 唯一
const ids = new Map()
for (const { e, at } of inserts) {
  const id = e?.id
  if (typeof id !== 'string' || !id) { fail(`${at} 缺 id`, 'entry 必须有字符串 id'); continue }
  if (ids.has(id)) fail(`id 重复: ${id}`, `${ids.get(id)} 与 ${at} 撞了，loader 只会保留一个`)
  else ids.set(id, at)
}
if (ids.size) ok(`${ids.size} 个 id 各不相同`, [...ids.keys()].join(', '))

// 2) name 必须是字面绝对路径（或包名），不能是 !!js
const isExpr = (v) => v && typeof v === 'object' && typeof v.__jsExpr === 'string'
for (const { e, at } of inserts) {
  if (!e || typeof e !== 'object' || !('name' in e)) continue
  const n = e.name
  if (isExpr(n)) { fail(`${at} 的 name 是 !!js 表达式`, '引擎会把表达式对象当模块名 → 启动即炸；name 必须写字面绝对路径或包名'); continue }
  if (typeof n !== 'string' || !n) { fail(`${at} 的 name 不是字符串`, JSON.stringify(n).slice(0, 80)); continue }
  if (n.startsWith('/')) {
    if (!fs.existsSync(n)) { fail(`${at} 的 name 指向不存在的路径`, n); continue }
    ok(`${at} name 是存在绝对路径`, n)
  } else if (n.startsWith('.')) {
    fail(`${at} 的 name 是相对路径`, `${n} —— 用绝对路径，解释器 cwd 不是 profile 目录`)
  } else {
    const tryResolve = (base) => { try { return createRequire(path.join(base, 'x.js')).resolve(n) } catch { return null } }
    const inProfile = tryResolve(PROFILE_DIR)
    const inEngine = inProfile ? null : tryResolve(ENGINE)
    if (inProfile) ok(`${at} name 是包名且能解析`, `${n} → ${path.relative(PROFILE_DIR, inProfile)}`)
    else if (inEngine) ok(`${at} name 指向引擎内置包`, `${n} → engine/node_modules（版本跟引擎走，别自己装）`)
    else fail(`${at} name 是包名但解析不到`, `${n} 既不在 profile node_modules 也不在 engine node_modules`)
  }
}

// 3) !!js 只能出现在 config 子树里
let exprTotal = 0
const badExpr = []
;(function walk(v, p, inCfg) {
  if (isExpr(v)) { exprTotal++; if (!inCfg) badExpr.push(p.join('.') || '<root>'); return }
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...p, i], inCfg))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...p, k], inCfg || k === 'config')
})(doc, [], false)
if (badExpr.length) fail('!!js 出现在 config 之外', `${badExpr.length} 处: ${badExpr.slice(0, 5).join(' | ')} —— 只在 entry.config 里求值`)
else ok(`!!js 位置合法（${exprTotal} 处，全在 config 内）`, '')

if (!isProfilePatch) ok('非本 profile 的 patch：只跑 patch 自身规则', path.basename(patchPath))

// 4) profile package.json：依赖钉版本 / 装上没 / 有没有 dsh.client
const pkgPath = path.join(PROFILE_DIR, 'package.json')
let pkg = null
try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) } catch (e) { warn('读不到 profile package.json', e.message) }
if (pkg && isProfilePatch) {
  const deps = pkg.dependencies || {}
  const loose = Object.entries(deps).filter(([, v]) => /^[\^~]|\*|latest/.test(String(v)))
  if (loose.length) warn('依赖版本没钉死', loose.map(([k, v]) => `${k}@${v}`).join(', ') + ' —— 装插件务必带精确版本')
  else ok(`依赖全部钉死版本（${Object.keys(deps).length} 个）`, Object.entries(deps).map(([k, v]) => `${k}@${v}`).join(', '))

  const clientRows = []
  for (const name of Object.keys(deps)) {
    const pj = path.join(PROFILE_DIR, 'node_modules', name, 'package.json')
    if (!fs.existsSync(pj)) { fail(`依赖未安装: ${name}`, 'pnpm-lock 与 node_modules 不一致，引擎会起不来'); continue }
    let p = null
    try { p = JSON.parse(fs.readFileSync(pj, 'utf8')) } catch { continue }
    if (p?.dsh?.client) clientRows.push(`${name}（platform=${p.dsh.client.platform || '?'}）`)
    const bp = p?.dsh?.bundle?.patch
    if (bp) {
      const abs = path.resolve(path.dirname(pj), bp)
      if (!fs.existsSync(abs)) fail(`${name} 的 bundle patch 不存在`, abs)
    }
  }
  if (clientRows.length) warn(`带 dsh.client 的插件 ${clientRows.length} 个：手机上不渲染`, clientRows.join(', ') + ' —— host 侧工具仍可用，别期待面板/侧栏')
  else ok('已装插件都没有 dsh.client 字段', '即手机端不存在「装了不渲染」的坑')

  // 5) bundles 里的非引擎内置包必须真的在 node_modules
  const bundles = pkg?.dsh?.profile?.bundles || []
  const builtin = (n) => n.startsWith('@deepseek-ai/') || n.startsWith('@dsh-android/')
  const missing = bundles.filter((n) => !builtin(n) && !fs.existsSync(path.join(PROFILE_DIR, 'node_modules', n)))
  if (missing.length) fail('bundles 引用了没安装的包', missing.join(', '))
  else ok(`bundles ${bundles.length} 个（${bundles.filter(builtin).length} 个引擎内置 + ${bundles.filter((n) => !builtin(n)).length} 个本地装）`, '')
}

// 6) patch 改动时间 → HMR 提示（android profile 是 disabled）
if (isProfilePatch) try {
  const st = fs.statSync(patchPath)
  const ageMin = Math.round((Date.now() - st.mtimeMs) / 60000)
  warn('patch 最后修改于 ' + new Date(st.mtimeMs).toLocaleString('zh-CN'), `${ageMin} 分钟前 —— android profile 的 hmr 是 disabled，改了就得重启引擎才生效`)
} catch {}

// 7) 最近几次插件安装日志里的失败痕迹
if (isProfilePatch) try {
  const logRoot = path.join(PROFILE_DIR, '.plugin-manager', 'logs')
  const dirs = fs.readdirSync(logRoot).map((d) => ({ d, t: fs.statSync(path.join(logRoot, d)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 3)
  const hits = []
  for (const { d } of dirs) {
    const f = path.join(logRoot, d, 'pnpm.log')
    if (!fs.existsSync(f)) continue
    const txt = fs.readFileSync(f, 'utf8')
    const bad = txt.split('\n').filter((l) => /ERR_|ERROR|Failed to resolve|EACCES/.test(l)).slice(0, 3)
    if (bad.length) hits.push(`${d}: ${bad[0].slice(0, 120)}`)
  }
  if (hits.length) warn('最近安装日志里有报错', hits.join(' | '))
  else ok('最近 3 次插件安装日志无报错', '')
} catch {}

report()

function report() {
  const order = { fail: 0, warn: 1, ok: 2 }
  R.sort((a, b) => order[a.level] - order[b.level])
  const n = { fail: 0, warn: 0, ok: 0 }
  for (const r of R) n[r.level]++
  if (asJson) {
    console.log(JSON.stringify({ patch: patchPath, counts: n, results: R }, null, 2))
  } else {
    const tag = { fail: 'FAIL', warn: 'warn', ok: '  ok' }
    console.log(`\ndsh-doctor · ${patchPath}\n`)
    for (const r of R) console.log(`${tag[r.level]}  ${r.name}${r.detail ? '\n        ' + r.detail : ''}`)
    console.log(`\n${n.ok} ok · ${n.warn} warn · ${n.fail} fail${n.fail ? ' → 别重启引擎，先修 FAIL' : n.warn ? ' → 可以走，注意 warn' : ' → 放心重启'}`)
  }
  process.exit(n.fail ? 1 : 0)
}
