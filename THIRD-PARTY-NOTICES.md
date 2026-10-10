# Third-party notices / 第三方声明

本项目包含源自以下项目的部分内容。

## opencode-commandcode-provider

- 项目：[brent-weatherall/opencode-commandcode-provider](https://github.com/brent-weatherall/opencode-commandcode-provider)
- 许可证：MIT
- 版权：Copyright (c) 2026 Brent Weatherall

### 派生关系

本项目的协议层是上述项目在 DeepSeek Harness 上的重写。以下部分沿用其契约与实现逻辑：

- `/alpha/generate` 请求信封结构（`config` / `params` 形状）
- 逐行 JSON（LDJSON）流的事件词汇与 `StreamChunk` 映射规则，包括
  `-end` 事件不带内容与 block id 时的累积处理、`finish-step` 与 `finish` 的用量去重
- 工具调用的转换规则：可选参数在传输层表示为可空（`anyOf` + `null`）、回程丢弃这些 null
- 工具调用 id 的规整规则（复合 id 取头部、长度上限）
- 图片处理契约：单图重编码上限、内联 base64 总量预算、`IMAGE_OFFLOAD_REQUIRED` 语义、
  已 offload 的图片以占位文本替代、纯图片 user turn 需延迟到工具轮之后
- 纯文本模型名单（来源为官方 CLI 自身的分类）
- 网关错误体与流内错误事件的解析方式

### 许可证全文

```
MIT License

Copyright (c) 2026 Brent Weatherall

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 说明 / Notes

本项目自身的代码以 MIT 许可发布（见 [LICENSE](LICENSE)）。上面保留的上游声明是 MIT 的强制要求，
不构成对上游项目的任何担保或背书。

This project is not affiliated with, endorsed by, or sponsored by Command Code.
It speaks an undocumented private gateway, which the operator may change at any
time.
