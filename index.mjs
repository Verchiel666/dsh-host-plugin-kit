// dsh-host-plugin-kit —— 宿主插件形态（0.2.0 起）。
//
// 为什么要有这一层：市场收录的门槛是 package.json 里的 dsh.bundle.patch
// （2026-11-11 查 awesome-dsh-plugin 的 contributing 核实）。只有 bin CLI 的包不是插件形态，
// 市场收不了；插件化之后同一个能力在 agent 侧变成工具——不开 shell 也能"搭个插件骨架"。
//
// 为什么手机上能跑（Android 引擎没有 Web Client 层）：
//   · 没有 dsh.client —— 不依赖任何 UI slot，装了不会"看不见"；
//   · inject 只有 ['tools'] —— 不碰本机没有的 webServer（否则 cordis 会静默挂起）；
//   · 数据源是本地 fs —— 生成的是源码文件，不靠 git / 端口 / 外部服务。
import os from 'node:os'
import path from 'node:path'
import { scaffold } from './lib/scaffold.mjs'

export const name = 'plugin_kit'
export const inject = ['tools']

const WRITE = 'risk: write (creates files on the phone)'
const text = (t) => [{ type: 'text', text: t }]
const renderer = (_args, value) => (Array.isArray(value?.content) ? value.content : text(JSON.stringify(value, null, 2)))

/** 允许 ~ 展开；其余要求绝对路径（相对路径在引擎进程里落到哪儿不可预测）。 */
export function resolveDir(input) {
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error('dir 不能为空（给绝对路径，或 ~/work/plugins/dsh-hello）')
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2))
  if (!path.isAbsolute(raw)) throw new Error(`dir 必须是绝对路径或以 ~/ 开头（收到：${raw}）`)
  return raw
}

export function apply(ctx, config = {}) {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('plugin_kit') : { info() {}, warn() {} }
  // 不导出 Config / Schema：大写的会被 cordis 当配置 schema，注册会被静默拦下

  const tool = {
    name: 'plugin_kit_new',
    description: `生成一个 DSH host 侧插件骨架：index.mjs（工具注册 + tools/pre-execute 审批钩子）、lib/core.mjs、cordis.patch.yml、package.json（含 dsh.bundle）、icon.svg、locale、dev/test.mjs、host-test/rt.mjs，并把三层验证的跑法打出来。\n[${WRITE}]`,
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '目标目录：绝对路径或 ~/ 开头；目录里不能已有 package.json' },
        packageName: { type: 'string', description: 'npm 包名（小写字母/数字/._-），默认取目录名' },
        desc: { type: 'string', description: '一句话描述，写进 package.json 与 README' },
        prefix: { type: 'string', description: '工具名前缀（生成 <prefix>_hello / <prefix>_write），默认从包名推' },
      },
      required: ['dir'],
    },
    timeoutMs: 60_000,
    isConcurrencySafe: () => false,
    output: { schema: {}, render: renderer },
    async execute(args) {
      try {
        const dir = resolveDir(args?.dir)
        const packageName = String(args?.packageName ?? '').trim() || path.basename(dir)
        const r = scaffold({
          target: dir,
          name: packageName,
          desc: args?.desc || undefined,
          prefix: args?.prefix || undefined,
        })
        return {
          content: text([
            `已生成 ${r.files.length} 个文件 → ${r.dir}`,
            `包名 ${r.packageName} · 工具前缀 ${r.prefix}`,
            '',
            '下一步（三层验证，缺一层就会在真机上炸）：',
            `  node ${r.dir}/dev/test.mjs        # L1 离线单测`,
            `  node ${r.dir}/host-test/rt.mjs    # L2 真 cordis 冒烟`,
            '  L3 改 profile patch 前跑一遍部署检查（parser 要引擎同款 js-yaml）',
          ].join('\n')),
        }
      } catch (error) {
        return { content: text(`生成失败：${error?.message ?? error}`) }
      }
    },
  }

  ctx.effect(() => {
    if (ctx.tools.get?.(tool.name) !== undefined) {
      logger.warn?.(`${tool.name} 已存在，跳过`)
      return () => {}
    }
    const off = ctx.tools.register(tool)
    logger.info?.(`plugin_kit: 注册 1 个工具（${tool.name}）`)
    return () => { try { off?.() } catch {} }
  }, 'plugin_kit.tools')

  // 写类工具一律走审批：只把 allow 升级成 ask，上游 deny 不许改写。
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (exec?.name !== tool.name || decision?.kind !== 'allow') return decision
    let argsText = ''
    try { argsText = JSON.stringify(exec.arguments ?? {}) } catch {}
    if (argsText.length > 200) argsText = argsText.slice(0, 200) + '…'
    return { kind: 'ask', reason: `plugin_kit 要在手机上生成插件骨架：${argsText}` }
  })
}
