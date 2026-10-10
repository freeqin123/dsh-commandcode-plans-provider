# dsh-commandcode-plans-provider

[English](README.en.md) · [第三方声明](THIRD-PARTY-NOTICES.md)

让 **DeepSeek Harness (dsh)** 直接使用 **Command Code 订阅**（Go / GOAT / Pro / Max）里的模型 —— **不需要安装 Command Code CLI**，也不需要 Provider API。

- **实时模型目录**：启动时拉取，按档位过滤，**默认不隐藏任何模型**
- **模型名标注上下文容量**：`Claude Sonnet 5.5 [1M]`、`GPT-5.5 [400K]`、`Kimi K2.7 Code [256K]`
- **逐模型「推理等级」**：只列出该模型真实支持的档位
- **可视化配置 API Key**：在插件卡片里粘贴保存即可，不用手改任何配置文件
- **底部用量环**：5 小时窗口占用 + 重置倒计时（≥90% 转红），点击展开周窗口与余额
- **图片输入、工具调用、流式输出**

---

## 为什么需要这个插件

Command Code 的订阅分两类：

| 类型 | 接入方式 |
| --- | --- |
| **Provider API** 计划 | 提供标准 OpenAI 兼容端点，dsh 原生就能接，**不需要本插件** |
| **Go / GOAT / Pro / Max 订阅** | 调用 OpenAI 兼容端点会返回 `403 upgrade_required`，**只能走私有 CLI 网关** `POST /alpha/generate` |

本插件复刻那个私有网关的协议 —— 请求信封、逐行 JSON 流、事件映射 —— 把订阅变成一个 dsh 原生 provider。

**所以不需要额外安装任何东西**：那个网关就是普通的 HTTP + JSON，官方 CLI 只是它的一个客户端而已。

---

## 安装

```sh
dsh plugin --profile web add github:freeqin123/dsh-commandcode-plans-provider
```

> 如果报 `ERR_PNPM_ADDING_TO_ROOT`，说明你的 profile 目录是一个 pnpm 工作区，加上 `-w` 即可：
>
> ```sh
> dsh plugin --profile web add -w github:freeqin123/dsh-commandcode-plans-provider
> ```

装完**重启 dsh**。插件列表里会出现本插件（bundle id 为 `commandcode-plans-provider`）。

---

## 配置 API Key

在 dsh 里进入 **插件 → 本插件 → 配置**：

```
API 密钥   [粘贴你的 key]                    [保存] [清除]
           ● 已保存（来源：file）· user_xxxx…ABCD

套餐档位   ( Go ) ( GOAT ) ( Pro ) ( ●Max )
           显示该档位及更低档位 · 配置状态 ready

           [测试连接]   网关可达 · 5 小时用量 0%
```

几点说明：

- 密钥写进 dsh 的**凭据库**（引用名 `COMMANDCODE_API_KEY`），不写进设置文档
- **读路径不返回明文** —— 这是 dsh 凭据服务的设计（*"Secret values cross in one direction only"*）。所以界面只显示**掩码指纹** `user_xxxx…ABCD`，用来确认"当前用的到底是哪把 key"，而不是把密钥显示出来
- **测试连接**会真的拿你的 key 打一次计费接口，成功/失败都给出原文（例如 key 失效会显示上游的 `401`）
- 不想用界面也可以：把 `COMMANDCODE_API_KEY` 写进 `~/.dsh/.credentials.yaml`，或设为环境变量

---

## 使用

### 1. 选模型

**设置 → 模型 → Command Code**，然后选一个模型。名字后面的 `[1M]` 就是它的上下文容量，取自模型列表接口的 `context_length`（真实逐模型值，不是固定值）。

### 2. 选档位

在插件卡片里点档位按钮。语义是「**显示该档位及以下包含的全部模型**」：

| 档位 | 显示范围 |
| --- | --- |
| Go | 所有 Go 模型 |
| GOAT | 所有 Go + GOAT 模型 |
| Pro | 所有 Go + GOAT + Pro 模型 |
| **Max（默认）** | 全部（凡 catalog 标了已知档位的模型） |

**默认 `max` + 「档位未知的模型也显示」两者合起来 = 开箱不隐藏任何模型。**

这是刻意的设计：不少同类实现默认档位是 `go`，导致 GOAT 用户看不到自己有权使用的模型。

### 3. 推理等级

模型选择器里的「推理等级」由本插件**逐模型**填充，列出**该模型真实支持的档位**（来自官方 CLI catalog 的 `Efforts` 列，比如 `Low / Medium / High / X-High / Max`）。

另有 `Off` —— 它表示**不发送** `reasoning_effort` 字段，也就是让模型自己决定。

如果某个模型没有推理等级可选，选择器会显示"当前模型未提供推理等级"，这也是真实情况。

### 4. 用量

底部 composer 那一行会多出一个环：

```
Command Code ◯ 34%  2h13m
```

- 环 = **5 小时窗口**的占用比例
- **≥90% 转红**，用于提前发现"快用满了"
- 后面跟**重置倒计时**
- **点击展开**：5 小时 / 周窗口 / 余额，以及各自的已用值与上限

> 注意：5 小时窗口用了 0% 时环是空的一圈，这是正常的，不是坏了。

### 5. 图片

支持视觉的模型可以直接贴图。

按官方 CLI 的分类，**DeepSeek / GLM / Qwen / MiniMax / Grok 4.6 等是纯文本模型**，给它们贴图会被**明确拒绝**（不是静默丢弃 —— 静默丢图会让你以为模型"看不见"是它笨）。换 Claude 或 Grok 4.5 这类模型即可。

关于图片有两个设计事实值得知道：

1. **网关是无状态的**：不保存图片，也没有上传接口。所以**每轮都要把整段历史里的图片重新内联发送**（官方 CLI 同样是这个行为）。这意味着同一张图在第 3 轮对话里仍要再付一次开销。
2. **有总预算**：一轮里内联的 base64 总量超过 `maxRequestImageBytes`（默认 2 MiB）时，插件**不发请求**，而是要求 dsh 先把**最旧的**图片 offload 掉再重试。所以没有图片会被无声地丢弃。

---

## 已知限制

- **用的是未公开接口**：`/alpha/generate` 是 Command Code 的私有网关，官方随时可能改动或封禁。本项目与 Command Code 无任何关联。
- **必须有订阅**：没有订阅的话 Provider API 那条路本来就够用，不需要本插件。
- **单账号**：不支持多账号并行。
- **暂无自动重试**：遇到 `RATE_LIMIT` 会直接把错误报出来，不会自动退避重试（网关前面有 Cloudflare 并发限流，多开几个会话可能触发）。
- **图片重复内联**：见上文，长对话里图片多会明显增加开销。

---

## 故障排查

| 现象 | 先看哪里 |
| --- | --- |
| 底部环一直是 `—` | 宿主日志里 `[commandcode-plans-provider]` 开头的行 |
| 模型列表为空 | 日志里的扫描结果。模型列表接口失败时会**保留上次目录**而不是清空 |
| `401` | key 失效了，重新贴一把 |
| `403 upgrade_required` | 版本头过期。插件会自动失效缓存并重试一次；仍失败请提 issue |
| `RATE_LIMIT` | 网关限流，稍后再试 |
| 贴图被拒 | 该模型按官方分类是纯文本，换支持视觉的模型 |
| `Command Code 对话接入尚未完成` | dsh 没重启 —— 宿主代码改动必须重启进程才生效 |

日志位置：`~/.dsh/logs/`，或者直接看你启动 dsh 的那个终端窗口。

---

## 开发

```sh
npm install
npm run verify   # 类型检查 + 编译 + 三个冒烟测试
```

```
src/                宿主半边
  index.ts            配置、目录扫描、定时重扫、注册 provider / 适配器 / 用量命名空间
  catalog.ts          双源模型目录、档位策略、图片能力判定、上下文标签
  plan-tier.ts        档位定义与 planId 映射
  protocol.ts         /alpha/generate 信封、逐行 JSON 解析、事件 → StreamChunk 映射
  adapter.ts          LlmAdapter 实现（listModels / resolveModel / stream）
  cli-version.ts      x-command-code-version 动态解析（缓存 + 回退 + 过期重试）
  usage.ts            用量与限额接口
  remote.ts           Remote 服务控制器
  typert.ts           把命名空间注册到 Typert 注册表
client/index.js     浏览器半边：底部用量环 + 插件配置卡
scripts/            三个离线冒烟测试（客户端加载 / 目录解析 / 协议映射）
```

**`lib/` 是故意提交进仓库的** —— dsh 直接从 `lib/index.js` 加载，而从 `github:` 安装不会执行构建步骤。改完源码记得跑一次 `npm run build` 再提交。

三个冒烟测试都不联网，但覆盖的是真会出错的契约：客户端半边能否加载（曾经有一版错误让整个 Web UI 起不来）、catalog 列序被调换后档位是否仍正确、流式映射的块开闭与用量去重不变量。

---

## Credit

协议层源自 **[brent-weatherall/opencode-commandcode-provider](https://github.com/brent-weatherall/opencode-commandcode-provider)**（MIT，Copyright © 2026 Brent Weatherall）。那是一个给 opencode 实现同样能力的项目。

本项目是它在 dsh 上的重写：请求信封结构、逐行 JSON 流的事件映射、工具调用与图片的转换规则、纯文本模型名单等，均沿用其契约。按 MIT 要求，上游版权声明已保留在 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 中。

## License

[MIT](LICENSE)
