# dsh-host-plugin-kit

一条命令生成 **DSH host 侧插件骨架**，自带三层验证（离线单测 / 真 cordis 冒烟 / 发布路径说明）与审批钩子模板。

面向 **Android 上的 DSH**（没有 Web Client 层，插件只能贡献 host 侧：工具、服务、事件、SKILL、MCP 桥）。

> 名字里的 host 是刻意的：npm 上的 `dsh-host-plugin-kit` 是另一套（客户端 bundle 生成 + verify），
> 与这套「host 侧工具插件骨架 + 三层测试」不是一回事。

## 用法

```sh
node new.mjs ~/work/my-plugin --name dsh-hello --desc "示例插件" [--prefix hello]

cd ~/work/my-plugin
node dev/test.mjs         # 6 项离线单测
node host-test/rt.mjs     # 5 项真 cordis 冒烟（用引擎自带的那份 cordis）
```

生成物：

| 文件 | 作用 |
|---|---|
| `index.mjs` | 注册工具（`ctx.effect` 内）、挂 `tools/pre-execute` 审批钩子 |
| `lib/core.mjs` | 业务逻辑，纯函数好测 |
| `cordis.patch.yml` | profile 的 insert 片段 |
| `package.json` | `dsh.bundle.patch` + 最小 `capabilities` |
| `dev/test.mjs` | 假 ctx 单测：注册、execute、审批 allow→ask、deny 不改写 |
| `host-test/rt.mjs` | 真 `@deepseek-ai/cordis`：inject、注册、execute、钩子、`dispose` 清理 |
| `locale/`、`icon.svg`、`README.md` | 插件三件套 |

## 生成的骨架遵守的约定

1. `export const name / inject / apply`；
2. 工具在 `ctx.effect` 里注册并返回 dispose（卸载要干净，有测试）；
3. 写类工具把 `allow` 升级为 `ask`，**上游 `deny` 不许改写**（有测试）；
4. 纯逻辑放 `lib/`，`index.mjs` 只做协议适配。

## 在这台手机上发布

```sh
# npm：新包首发先进 staged 状态，40–120 s 后才可见；发完务必下载 tarball 实际加载验证
node $HOME/tools/npm/bin/npm-cli.js publish

# GitHub：本机没有 git，走 REST API 一次成 commit
node $HOME/work/gitpub/publish-github.mjs --dir . --owner <you> --repo dsh-hello --token-file $HOME/.gh_token
```

装插件时**带版本号**（`dsh-hello@0.1.0`），否则会遇到「裸名字 spec 永远没有更新徽标」的坑。

## 自测

```sh
node dev/bin-selftest.mjs   # 生成一个临时插件并跑它的两套测试
```

MIT
