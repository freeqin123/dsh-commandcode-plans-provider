# commandcode-plans-provider

Command Code 订阅（Go / GOAT / Pro / Max）接入插件，用于 DeepSeek Harness (dsh)。

Command Code 的订阅无法通过 OpenAI 兼容端点使用（会返回 `403 upgrade_required`），只能走其私有 CLI 网关 `/alpha/generate`。本插件把该网关桥接到 dsh 的原生 `LlmAdapter` 接缝，让你不必安装官方 CLI 就能在 dsh 里使用订阅额度。

完整技术方案见同目录的 [CommandCode订阅插件技术方案.md](./CommandCode订阅插件技术方案.md)。

## 当前进度

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 工程骨架：可安装、可启动、完整配置项 | 已完成 |
| P1 | 底部用量格子落位（`conversation.composer.dock`） | 已完成 |
| P2 | 可视化配置 API Key（写凭据 / 读状态 / 掩码指纹 / 测试连接） | 已完成 |
| P3 | 模型目录与档位过滤（双源扫描、表头驱动解析、默认 `max` 不隐藏任何模型） | 已完成 |
| P4 | 用量环 + 点击展开详情（5 小时 / 周窗口 / 余额） | 已完成 |
| P5 | CLI 版本动态获取（缓存 + 回退 + `upgrade_required` 自动重试） | 已完成 |
| P6 | 对话打通：`/alpha/generate` 流式传输、工具调用、推理等级 | 已完成 |
| P7 | 图片输入（附件物化 + 逐图/总预算 + `IMAGE_OFFLOAD_REQUIRED` 契约 + 延迟插入） | 已完成 |
| P8 | 重试策略（`resolveRetryPolicy`）+ 扫描状态面板 + `$mount` 卸载清理 | 待实现 |

## 验证

```sh
npm run verify   # typecheck + build + 两个冒烟测试
```

`smoke-client` 会在 Node 里真实加载浏览器半边（这类错误曾让整个 Web UI 起不来）；
`smoke-catalog` 覆盖表头驱动解析、"列序被调换"回归、档位策略与 `planId` 映射。
| P5 | CLI 版本动态获取 + 失败可见性自检 | 待实现 |
| P6 | 对话打通：流式输出、工具调用、逐模型推理等级 | 待实现 |

## 配置项

全部可选，默认即可用。档位默认 `all`（显示全部模型，不隐藏任何模型）。

```yaml
- id: commandcode-plans-provider
  name: '@local/commandcode-plans-provider'
  config:
    planTier: all            # all | go | goat | pro | max
    providerId: commandcode  # provider 路由 id
    apiKeyEnv: COMMANDCODE_API_KEY
    baseURL: https://api.commandcode.ai
    scanIntervalMinutes: 60
    usageIntervalSeconds: 90
```

## API Key

两种方式任选：

1. **推荐**：在 dsh Web UI 的插件卡片里粘贴保存（通过凭据服务写入，不碰配置文件）。
2. 手动写入 `~/.dsh/.credentials.yaml`：

```yaml
COMMANDCODE_API_KEY: user_xxxxxxxx
```

## 安装注意

本插件注册的 provider 路由 id 是 `commandcode`。若此前装过其他 Command Code 插件（例如 `@jiesou/dsh-commandcode-go-provider`，它使用同一个 id），**必须先卸载旧插件**，否则会因 `DUPLICATE_ADAPTER` 而注册失败。详见技术方案 6.4 节。

## 开发

```sh
npm run typecheck
npm run build
```

## License

[MIT](./LICENSE)
