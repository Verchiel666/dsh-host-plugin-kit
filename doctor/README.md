# dsh-doctor

改 profile 的 `cordis.patch.yml`、或装插件之前先跑一遍的**只读自检**。
专门盯本机历史上炸过引擎的三条：`name` 写成 `!!js`、`!!js` 写错位置、装了带 `dsh.client` 的插件却不渲染。

不改任何文件、不跑 pnpm、不重启引擎 —— 只读 patch / profile `package.json` / `node_modules/<pkg>/package.json`。

## 用法

```sh
node ~/work/dsh-plugin-kit/doctor/doctor.mjs                 # 检查本 profile 的 cordis.patch.yml
node ~/work/dsh-plugin-kit/doctor/doctor.mjs path/to/p.yml   # 检查指定 patch（只跑 patch 自身规则）
node ~/work/dsh-plugin-kit/doctor/doctor.mjs --json          # 机器可读
node ~/work/dsh-plugin-kit/doctor/selftest.mjs               # 16 项自测（正例/反例/真实 patch）
```

退出码：`0` 全过（warn 不算错）/ `1` 有 FAIL（别重启引擎）/ `2` 环境不对（找不到引擎 `js-yaml`）。

依赖环境变量 `DSH_HOME`、`DSH_PROFILE_DIR`（引擎起的 shell 里本来就有）；没有时按 `$HOME/../dsh-home` 和 `profiles/android` 推导。

## 检查项

| 级别 | 检查 | 为什么 |
|---|---|---|
| FAIL | patch 能被引擎同款方言解析（`JSON_SCHEMA` + `!!js` 标量） | 解析不了 = 引擎起不来 |
| FAIL | 顶层是数组 | 引擎只认 loader patch 数组 |
| FAIL | `id` 存在且不重复 | 撞 id 时 loader 只留一个，静默丢插件 |
| FAIL | `name` 是字符串（不是 `!!js` 表达式对象） | 表达式对象被当模块名 → 启动即炸 |
| FAIL | `name` 为绝对路径时必须存在；相对路径直接拒 | 解释器 cwd 不是 profile 目录 |
| OK/FAIL | 包名能解析：profile `node_modules` → 引擎内置 `node_modules` | 内置桥（如 `@deepseek-ai/dsh-mcp-client`）本来就只在引擎里 |
| FAIL | `!!js` 只允许有 `config` 祖先 | 引擎只对 `entry.config` 求值，其余位置是死值 |
| FAIL | 依赖都已安装、bundle 引用的 patch 文件存在 | lock 与 `node_modules` 不一致会起不来 |
| FAIL | `bundles` 里非内置包必须在 `node_modules` | 少一个 bundle → 启动失败 |
| warn | 依赖版本钉死（无 `^ ~ * latest`） | 装插件必须带精确版本 |
| warn | 带 `dsh.client` 的插件（Android 不渲染） | host 工具仍生效，但别期待面板/侧栏 |
| warn | patch 最后修改时间（HMR 在 android 是 disabled） | 改了 patch 就得重启引擎 |
| warn | 最近 3 次插件安装日志里的报错 | 安装失败常被静默吞掉 |

## 实测

- 本机真实 patch：`10 ok · 2 warn · 0 fail`（warn = web-search 带 `dsh.client`、patch 已改 1074 分钟未重启）
- 反例 `fixtures/bad.yml`：`9 fail`，六类错误一条不漏
- `selftest.mjs`：16/16 通过

## 还没覆盖

- 不检查插件导出是否真有 `apply` / `inject`（那要真 import，交给 `$HOME/work/dsh-usage/dev/verify-patch.mjs` 这种逐插件检查）
- 不读 HMR 运行时状态，只按「patch mtime + HMR 关闭」给静态提醒
- 发布到 npm 前要把 `doctor/` 加进 `package.json` 的 `files`/`bin` 并升版本（这一步故意没做，避免改了清单还没发版）
