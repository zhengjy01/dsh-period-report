# dsh-period-report

> [**English**](README.md) | **中文**

DeepSeek Harness 的自由周期会话报告插件：从会话库生成**AI 叙事工作报告**（日报 / 周报 / 月报 / 任意自定义时间段），并可设置**周期提醒**（“每隔 N 天 · HH:MM · 自起始日期起”），到点自动生成报告并弹**系统通知**。

## 功能

- **可视化界面（v0.2.0）** —— 设置页新增 **Session Report** 入口（报告生成器 + 提醒配置），提醒以右下角卡片弹出并支持大窗口阅读全文。

- **任意日期区间** —— 选择开始/结束日期，报告精确覆盖该时间段（单日、2 天、7 天、整月……自由设定）
- **AI 叙事摘要** —— 调用部署默认模型生成自然语言摘要（今日数据 / 今日主线 / 今日回顾 / 明日建议），像人写的日报；关闭 AI 或不可用时自动回退为模板主线
- **完整统计** —— 活跃/新建会话、用户/助手消息、工具调用、轮次、步骤、Token 用量（输入/输出/缓存读/缓存写/推理）、轮次结果、常用工具
- **逐会话明细** —— 标题、id、工作目录、活跃时间段、消息/工具/轮次数、首条请求
- **周期提醒** —— 周期长度自由：`intervalDays: 1` = 每天、`7` = 每周、`2` = 每隔两天……以 `anchorDate` 为锚点，在 `hour:minute` 触发，每个周期只提醒一次；`range: previous` 报告已结束的上一周期（如 09:00 看昨日日报），`current` 报告进行中的周期
- **系统通知** —— macOS 通知中心横幅（osascript）/ Linux notify-send；完整报告同时保存到 `~/.dsh/dsh-period-report/reports/`，GUI 关闭也不丢
- **中英双语** —— 报告支持中文（zh）与英文（en）
- **配置持久化** —— `~/.dsh/dsh-period-report.json`（权限 0600）

## 安装

```bash
dsh plugin --profile web add github:zhengjy01/dsh-period-report
```

本地开发：

```bash
dsh plugin --profile web add link:/path/to/dsh-period-report
```

## 工具

### `report_generate`

生成任意日期区间的报告。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `startDate` | string（必填） | 开始日期 `YYYY-MM-DD`（含当天） |
| `endDate` | string（必填） | 结束日期 `YYYY-MM-DD`（含当天） |
| `includeSubagents` | boolean | 是否包含子代理会话（默认 false） |
| `withUsage` | boolean | 是否统计 Token 用量（默认 true；关闭可加快生成） |
| `language` | string | `zh` 或 `en`（默认 zh） |
| `narrate` | boolean | AI 叙事摘要（默认 true；关闭用模板，更快） |

返回完整 Markdown 报告。

### `report_config`

查看或修改定时提醒配置（持久化于 `~/.dsh/dsh-period-report.json`）。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `enabled` | boolean | 启用/停用定时提醒 |
| `anchorDate` | string | 起始日期 `YYYY-MM-DD`，周期从该日起算 |
| `intervalDays` | number | 每隔 N 天提醒一次（1-90，7 即每周） |
| `hour` / `minute` | number | 提醒时刻 |
| `range` | string | `previous`（报告上一周期，默认）或 `current` |
| `language` | string | 报告语言 `zh` / `en` |
| `narrate` | boolean | AI 叙事摘要开关 |

不带参数调用即返回当前配置。

## 示例

> “从 2026-06-01 起每隔 2 天早上 9 点提醒我，中文日报。”
>
> → `report_config`：`{ "enabled": true, "anchorDate": "2026-06-01", "intervalDays": 2, "hour": 9, "minute": 0, "range": "previous" }`
>
> 06-01、06-03、06-05 … 的 09:00 各提醒一次，每次报告上一个 2 天周期；系统通知显示摘要与报告文件路径。

## 许可

MIT
