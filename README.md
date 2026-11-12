# dsh-host-plugin-kit

DSH（DeepSeek Harness）**host 侧插件脚手架**，0.2.0 起是 **CLI + 宿主插件双形态**：
一条命令生成带三层验证的插件骨架；装进 DSH 后还能让 agent 直接用 `plugin_kit_new` 工具搭骨架，不用开 shell。

## 为什么要插件形态

市场（awesome-dsh-plugin.com）的收录门槛是 `package.json` 里的 `dsh.bundle.patch`（2026-11-11 查 contributing 核实）。
0.1.x 只有 `bin`，是脚手架 CLI、不是插件形态，市场收不了。0.2.0 把同一份生成逻辑包成 host 侧工具：

- 没有 `dsh.client` —— 不依赖任何 UI slot（Android 引擎没有 Web Client 层，带 client 的装了不渲染）；
- `inject` 只有 `['tools']` —— 不碰本机没有的 `webServer`（否则 cordis 会静默挂起插件）；
- 数据源是本地 fs —— 生成的是源码文件，不靠 git / 端口 / 外部服务。

## 工具（插件形态）

| 工具 | 风险 | 作用 |
|---|---|---|
| `plugin_kit_new` | 写盘（走审批） | 在指定目录生成插件骨架（10 个文件），返回三层验证的跑法 |

写类工具在 `tools/pre-execute` 里把 `allow` 升级成 `ask`，**不改写上游 `deny`**。

```yaml
# 装好后写进 profile 的 cordis.patch.yml（name 用包名或绝对路径，不要写 !!js）
- insert:
    - id: plugin_kit
      name: dsh-host-plugin-kit
      config: {}
```

## CLI 形态

```sh
node new.mjs <目标目录> --name dsh-hello [--desc "一句话"] [--prefix hello]
# 或装到干净目录后：node node_modules/dsh-host-plugin-kit/new.mjs <目标目录> --name dsh-hello
```

生成的 10 个文件：`package.json`（含 `dsh.bundle`）/ `index.mjs`（工具注册 + 审批钩子）/ `lib/core.mjs` /
`cordis.patch.yml` / `icon.svg` / `locale/zh-CN.json` / `dev/test.mjs` / `host-test/rt.mjs` / `README.md` / `.gitignore`。

生成内容只由 `{name, desc, prefix}` 决定 → **同参数必然同字节**，回归测试直接比文件。

## 三层验证（本包自己也按这个跑）

| 层 | 文件 | 验什么 |
|---|---|---|
| L1 离线单测 | `node dev/test.mjs` | 纯逻辑、落盘结果、工具面、审批钩子、dispose（14 项） |
| L2 真 cordis | `node $HOME/work/host-test/rt-plugin-kit.mjs` | 用引擎那份 cordis 加载：注册 / 执行 / 钩子 / dispose（5 项） |
| L3 部署检查 | `node dev/verify-patch.mjs [patch]` | 引擎同款解析器（js-yaml + `!!js` 标量）读 patch，断言 `name` 是普通字符串、引用文件都在（7 项） |
| 脚手架自测 | `node dev/bin-selftest.mjs` | 生成一个临时插件，再跑它自己的 L1 / L2（4 项） |

## 已知检查器偏差（别为绿灯改声明）

`dsh-standards` 的 `C-11.5` 只认 `ctx.fs` 触发的 capability 声明，本包写盘走 `node:fs`（在 `lib/scaffold.mjs`），
所以 `fs:write` / `fs:read` **必然报 WARN**。实测：`--scope entry --entry-claim runtime` 下 10 项 PASS、
2 项 WARN（C-11.5 上述盲点 + C-8.2 的 cordis 版本错位，本机 cordis 4.0.5 没有 `_revision` 字段）、0 项 FAIL。
真实声明保留，不为了让检查器变绿而删。

## 契约

- `inject: ['tools']`，工具在 `ctx.effect` 里注册并返回 dispose（写成 `() => off()` 会当场卸载）；
- 写类工具只把 `allow` 升级成 `ask`，不改写 `deny`；
- `dsh.capabilities` 按实际用到的最小集合声明；
- `name` 必须是普通字符串，`!!js` 只能用在 entry 的 `config` 里求值。

MIT
