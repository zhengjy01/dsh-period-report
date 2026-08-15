/**
 * dsh-period-report — free-interval session reports for DeepSeek Harness.
 *
 * Generate AI-narrated work reports (daily / weekly / monthly / any custom
 * period) over an arbitrary date range from the session corpus, and schedule
 * periodic reminders ("every N days at HH:MM, starting from an anchor date")
 * that generate the report and pop a system notification (macOS Notification
 * Center via osascript, Linux via notify-send).
 *
 * Tools:
 *   - report_generate — build a report for [startDate, endDate]; returns the
 *     full Markdown (stats + AI narrative + per-session details).
 *   - report_config   — view / update the reminder configuration, persisted
 *     in ~/.dsh/dsh-period-report.json (mode 0600).
 *
 * Reminders: every N days from `anchorDate`, at `hour:minute` the current
 * period's report is generated; `range: previous` reports the previous
 * period, `current` reports the one in progress. Full reports are also
 * written to ~/.dsh/dsh-period-report/reports/ so nothing is lost when the
 * GUI is closed.
 *
 * @module dsh-period-report
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

/** Stable cordis plugin name. */
export const name = 'period-report'

/** Services required before the plugin can mount. */
export const inject = ['tools', 'systemPrompt', 'sessionQuery', 'timer']

/** Config file location (machine-wide, mode 0600). */
const CONFIG_FILE = path.join(homedir(), '.dsh', 'dsh-period-report.json')

/** Directory where generated report Markdown files are stored. */
const REPORTS_DIR = path.join(homedir(), '.dsh', 'dsh-period-report', 'reports')

/** How often the reminder scheduler wakes up. */
const TICK_MS = 30000

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 150

/** Max sessions fed to the LLM narrator. */
const NARRATE_SESSION_LIMIT = 25

const DAY = 86400000
const pad = (n) => String(n).padStart(2, '0')
const fmtDate = (t) => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }
const parseDate = (s) => { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).getTime() }
const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

const DEFAULTS = {
  language: 'zh',
  narrate: true,
  enabled: false,
  anchorDate: null, // set to today on first save
  intervalDays: 1,
  hour: 9,
  minute: 0,
  range: 'previous',
}

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const PERIOD_REPORT_GUIDANCE =
  '本机已安装 dsh-period-report 插件（自由周期会话报告 + 定时提醒）：' +
  '可用 report_generate 生成任意日期区间的 AI 叙事工作报告（日报/周报/月报或自定义区间），' +
  'report_config 可设置「每隔 N 天 · 起始日期 · 时刻」的周期提醒（N=1 每天、N=7 每周），' +
  '到点自动生成报告并弹系统通知（macOS 通知中心 / Linux notify-send），完整报告保存于 ~/.dsh/dsh-period-report/reports/。' +
  '配置存 ~/.dsh/dsh-period-report.json（权限 0600）。' +
  '用户提到「日报/周报/月报/周期报告/定时生成报告」时即指本插件，请据此协作。'

/** Extract plain text from message content blocks. */
function extractText(content) {
  let out = ''
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b && b.type === 'text' && typeof b.text === 'string') out += b.text
    }
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** Run `fn` over items with bounded concurrency; failures become null. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++
      try { results[idx] = await fn(items[idx], idx) } catch (err) { results[idx] = null }
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Aggregate every session overlapping [start, end) into a plain-JSON report.
 * Heavy reads run concurrently; per-session failures are counted, not fatal.
 */
async function buildReport(ctx, startDateStr, endDateStr, opts) {
  const sq = ctx.get('sessionQuery')
  if (!sq) return { ok: false, error: 'sessionQuery 服务不可用' }
  const includeSubagents = !!(opts && opts.includeSubagents)
  const withUsage = !opts || opts.withUsage !== false
  const doNarrate = !opts || opts.narrate !== false
  const lang = (opts && opts.language) === 'en' ? 'en' : 'zh'
  const start = parseDate(startDateStr)
  const end = parseDate(endDateStr) + DAY
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { ok: false, error: '日期范围无效：结束日期必须不早于开始日期' }
  }

  const records = await sq.listSessions()
  const candidates = records.filter((r) => (includeSubagents || r.header.origin !== 'subagent') && r.header.createdAt < end)

  const light = await mapLimit(candidates, 8, async (rec) => {
    const events = await sq.listEvents(rec.header.id)
    const counts = {}
    let first = null
    let last = null
    for (const e of events) {
      if (e.time < start || e.time >= end) continue
      counts[e.type] = (counts[e.type] || 0) + 1
      if (first === null || e.time < first) first = e.time
      if (last === null || e.time > last) last = e.time
    }
    const active = first !== null
    const created = rec.header.createdAt >= start && rec.header.createdAt < end
    if (!active && !created) return null
    return { rec, counts, first, last, active, created }
  })

  const involved = light.filter(Boolean)
  const ids = involved.map((x) => x.rec.header.id)
  const titles = {}
  if (ids.length) {
    const titleResults = await sq.readTitleSnapshots(ids)
    titleResults.forEach((r) => {
      if (r.status === 'fulfilled' && r.value && r.value.title) titles[r.sessionId] = r.value.title.title
    })
  }

  const usageMap = {}
  if (withUsage) {
    const activeItems = involved.filter((x) => x.active)
    const full = await mapLimit(activeItems, 4, async (x) => {
      const snap = await sq.readSession(x.rec.header.id)
      return { id: x.rec.header.id, events: snap.events }
    })
    for (const f of full) {
      if (!f) continue
      const agg = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, turnEnds: {}, toolNames: {}, firstUserText: null }
      for (const ev of f.events) {
        if (ev.time < start || ev.time >= end) continue
        if (ev.type === 'assistant/message' && ev.data && ev.data.usage) {
          const u = ev.data.usage
          agg.input += u.inputTokens || 0
          agg.output += u.outputTokens || 0
          agg.cacheRead += u.cacheReadTokens || 0
          agg.cacheWrite += u.cacheWriteTokens || 0
          agg.reasoning += u.reasoningTokens || 0
        } else if (ev.type === 'turn/end' && ev.data && ev.data.reason) {
          const k = ev.data.reason.kind
          agg.turnEnds[k] = (agg.turnEnds[k] || 0) + 1
        } else if (ev.type === 'tool/call' && ev.data && ev.data.name) {
          agg.toolNames[ev.data.name] = (agg.toolNames[ev.data.name] || 0) + 1
        } else if (ev.type === 'user/message' && agg.firstUserText === null && ev.data && ev.data.source && ev.data.source.kind === 'user') {
          agg.firstUserText = truncate(extractText(ev.data.content), 160)
        }
      }
      usageMap[f.id] = agg
    }
  }

  const sessions = involved.map((x) => {
    const u = usageMap[x.rec.header.id] || {}
    const c = x.counts
    const toolNames = u.toolNames || {}
    const topTools = Object.keys(toolNames).map((n) => ({ name: n, count: toolNames[n] })).sort((p, q) => q.count - p.count).slice(0, 8)
    const fallback = u.firstUserText ? u.firstUserText : (lang === 'en' ? 'Untitled session' : '未命名会话')
    return {
      id: x.rec.header.id,
      title: titles[x.rec.header.id] || fallback,
      cwd: x.rec.header.cwd || null,
      createdAt: x.rec.header.createdAt,
      created: x.created,
      active: x.active,
      firstActive: x.first,
      lastActive: x.last,
      userMessages: c['user/message'] || 0,
      assistantMessages: c['assistant/message'] || 0,
      toolCalls: c['tool/call'] || 0,
      turns: c['turn/start'] || 0,
      steps: c['step/start'] || 0,
      inputTokens: u.input || 0,
      outputTokens: u.output || 0,
      cacheReadTokens: u.cacheRead || 0,
      cacheWriteTokens: u.cacheWrite || 0,
      reasoningTokens: u.reasoning || 0,
      turnEnds: u.turnEnds || {},
      topTools,
      firstUserText: u.firstUserText || null,
    }
  })

  sessions.sort((p, q) => {
    if (p.active && q.active) return (q.firstActive || 0) - (p.firstActive || 0)
    if (p.active !== q.active) return p.active ? -1 : 1
    return q.createdAt - p.createdAt
  })

  const totals = { activeSessions: 0, createdSessions: 0, userMessages: 0, assistantMessages: 0, toolCalls: 0, turns: 0, steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, turnEnds: {}, topTools: [] }
  const allTools = {}
  for (const s of sessions) {
    if (s.active) totals.activeSessions++
    if (s.created) totals.createdSessions++
    totals.userMessages += s.userMessages
    totals.assistantMessages += s.assistantMessages
    totals.toolCalls += s.toolCalls
    totals.turns += s.turns
    totals.steps += s.steps
    totals.inputTokens += s.inputTokens
    totals.outputTokens += s.outputTokens
    totals.cacheReadTokens += s.cacheReadTokens
    totals.cacheWriteTokens += s.cacheWriteTokens
    totals.reasoningTokens += s.reasoningTokens
    for (const k of Object.keys(s.turnEnds)) totals.turnEnds[k] = (totals.turnEnds[k] || 0) + s.turnEnds[k]
    for (const t of s.topTools) allTools[t.name] = (allTools[t.name] || 0) + t.count
  }
  totals.topTools = Object.keys(allTools).map((n) => ({ name: n, count: allTools[n] })).sort((p, q) => q.count - p.count).slice(0, 8)

  const report = {
    start,
    end,
    label: fmtDate(start) + ' ~ ' + fmtDate(end - 1),
    totals,
    sessions,
    failedReads: light.filter((x) => x === null).length,
  }
  if (doNarrate) report.narrative = await narrate(ctx, report, lang)
  return { ok: true, report }
}

/** Ask the deployment's default model to write a narrative digest. */
async function narrate(ctx, report, lang) {
  try {
    const llm = ctx.get('llm')
    const adm = ctx.get('agentDefaultModel')
    if (!llm || !adm) return null
    const sel = adm.currentSelection()
    if (!sel || !sel.provider || !sel.model) return null
    const lines = report.sessions.slice(0, NARRATE_SESSION_LIMIT).map((s) => {
      const d = new Date(s.firstActive || s.createdAt)
      const hm = pad(d.getHours()) + ':' + pad(d.getMinutes())
      return '[' + hm + '] ' + s.title + (s.firstUserText ? ' — ' + s.firstUserText : '')
    }).join('\n')
    const zh = lang !== 'en'
    const system = zh
      ? '你是用户的人工智能工作日报撰写助手。根据给定的会话数据，用自然、精炼的中文写一份像人写的工作日报摘要。不要客套话，不要一级标题。'
      : 'You are an AI assistant that writes daily work-report summaries. Based on the session data, write a natural, concise English daily digest. No pleasantries, no top-level heading.'
    const prompt = zh
      ? '时间范围：' + report.label + '\n' +
        '统计数据：活跃会话 ' + report.totals.activeSessions + ' 个、用户消息 ' + report.totals.userMessages + ' 条、助手消息 ' + report.totals.assistantMessages + ' 条、工具调用 ' + report.totals.toolCalls + ' 次、Token 输入 ' + report.totals.inputTokens + '、输出 ' + report.totals.outputTokens + '。\n\n' +
        '会话列表（时间 — 标题 — 首条请求）：\n' + lines + '\n\n' +
        '请只输出以下 Markdown 结构（不要输出 # 一级标题，不要引言）：\n' +
        '**今日数据**：一句话，格式如「9 个活跃会话 · 65 条用户消息 · 971 次工具调用 · 约 204 万/68 万 tokens」。\n' +
        '**今日主线**：每个会话一行，格式「标题（HH:MM）— 根据首条请求概括一句话做的事」，用句号结尾。\n' +
        '**今日回顾**：3-5 条要点，概括今天的主要进展与成果。\n' +
        '**明日建议**：2-4 条建议，基于今天进行中或未完成的工作。'
      : 'Period: ' + report.label + '\n' +
        'Stats: ' + report.totals.activeSessions + ' active sessions, ' + report.totals.userMessages + ' user messages, ' + report.totals.assistantMessages + ' assistant messages, ' + report.totals.toolCalls + ' tool calls, ' + report.totals.inputTokens + ' input tokens, ' + report.totals.outputTokens + ' output tokens.\n\n' +
        'Sessions (time — title — first request):\n' + lines + '\n\n' +
        'Output ONLY this Markdown structure (no # heading, no intro):\n' +
        '**Today at a glance**: one sentence, e.g. "9 active sessions · 65 user messages · 971 tool calls · ~2.04M/0.68M tokens".\n' +
        '**Highlights**: one line per session, format "Title (HH:MM) — one sentence summarizing what was done based on the first request", ending with a period.\n' +
        '**Review**: 3-5 bullets summarizing key progress and outcomes.\n' +
        '**Suggestions**: 2-4 bullets based on ongoing or unfinished work.'
    const messages = [{
      id: 'dshr-period-report-narrate-1',
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    }]
    let out = ''
    for await (const chunk of llm.stream({
      provider: sel.provider,
      model: sel.model,
      messages,
      system,
      maxTokens: 900,
      reasoningEffort: sel.reasoningEffort,
    })) {
      if (chunk.type === 'text-delta') out += chunk.text
    }
    out = out.trim()
    return out.length > 20 ? out : null
  } catch (err) {
    ctx.logger?.info ? ctx.logger.info(`[dsh-period-report] narrate failed: ${String(err)}`) : null
    return null
  }
}

/** Escape a value for use inside a double-quoted AppleScript string literal. */
function escapeAppleScript(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
}

/** Build the system-notification helper bound to a cordis context. */
function createNotifier(ctx, log) {
  const spawnDetached = (command, args) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true })
      child.unref()
      child.on('error', (error) => log(`${command} spawn failed: ${error.message}`))
    } catch (error) {
      log(`${command} spawn error: ${String(error)}`)
    }
  }
  return (title, message) => {
    log(`notify: ${title} — ${message}`)
    if (process.platform === 'darwin') {
      const script =
        `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"` +
        ' sound name "Glass"'
      spawnDetached('osascript', ['-e', script])
    } else if (process.platform === 'linux') {
      spawnDetached('notify-send', [title, message])
    }
  }
}

/** Durable reminder + report configuration store (mode 0600). */
class ReportStore {
  constructor() {
    this.config = null
  }

  async load() {
    if (this.config !== null) return this.config
    let raw = null
    try {
      raw = await readFile(CONFIG_FILE, 'utf8')
    } catch (err) {
      raw = null
    }
    const parsed = raw ? JSON.parse(raw) : {}
    const c = { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) }
    if (!isDateStr(c.anchorDate)) c.anchorDate = fmtDate(Date.now())
    this.config = {
      language: c.language === 'en' ? 'en' : 'zh',
      narrate: c.narrate !== false,
      enabled: !!c.enabled,
      anchorDate: c.anchorDate,
      intervalDays: Math.max(1, Math.min(90, Math.floor(Number(c.intervalDays) || 1))),
      hour: Math.max(0, Math.min(23, Math.floor(Number(c.hour) || 0))),
      minute: Math.max(0, Math.min(59, Math.floor(Number(c.minute) || 0))),
      range: c.range === 'current' ? 'current' : 'previous',
    }
    return this.config
  }

  async save(next) {
    this.config = next
    await mkdir(path.dirname(CONFIG_FILE), { recursive: true })
    await writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 })
  }

  async patch(args) {
    const c = await this.load()
    const next = { ...c }
    if (args && typeof args.enabled === 'boolean') next.enabled = args.enabled
    if (args && typeof args.language === 'string') next.language = args.language === 'en' ? 'en' : 'zh'
    if (args && typeof args.narrate === 'boolean') next.narrate = args.narrate
    if (args && isDateStr(args.anchorDate)) next.anchorDate = args.anchorDate
    if (args && args.intervalDays !== undefined) next.intervalDays = Math.max(1, Math.min(90, Math.floor(Number(args.intervalDays) || 1)))
    if (args && args.hour !== undefined) next.hour = Math.max(0, Math.min(23, Math.floor(Number(args.hour) || 0)))
    if (args && args.minute !== undefined) next.minute = Math.max(0, Math.min(59, Math.floor(Number(args.minute) || 0)))
    if (args && typeof args.range === 'string') next.range = args.range === 'current' ? 'current' : 'previous'
    await this.save(next)
    return next
  }

  view() {
    return this.config ?? DEFAULTS
  }
}

/** Compute which period index `now` falls into (null when before the anchor). */
function currentPeriodIndex(cfg, now) {
  const anchor = parseDate(cfg.anchorDate)
  if (now < anchor) return null
  const span = Math.max(1, cfg.intervalDays) * DAY
  return Math.floor((now - anchor) / span)
}

/** Report range for period k: previous or current, per config. */
function reportRangeFor(cfg, k) {
  const anchor = parseDate(cfg.anchorDate)
  const span = Math.max(1, cfg.intervalDays) * DAY
  const currentStart = anchor + k * span
  if (cfg.range === 'current') return { start: currentStart, end: currentStart + span }
  return { start: currentStart - span, end: currentStart }
}

/** The generate-report tool. */
export function reportGenerateTool(ctx) {
  return defineTool({
    name: 'report_generate',
    description: '生成任意日期区间的 DSH 会话工作报告（日报/周报/月报/自定义区间）。默认调用 AI 生成叙事摘要（今日数据/今日主线/今日回顾/明日建议），并包含完整统计数据与会话明细。返回完整 Markdown。',
    parameters: {
      startDate: { type: 'string', required: true, description: '开始日期，格式 YYYY-MM-DD（含当天）' },
      endDate: { type: 'string', required: true, description: '结束日期，格式 YYYY-MM-DD（含当天），不能早于开始日期' },
      includeSubagents: { type: 'boolean', description: '是否包含子代理会话（默认 false）' },
      withUsage: { type: 'boolean', description: '是否统计 Token 用量（默认 true；关闭可加快生成）' },
      language: { type: 'string', description: '报告语言：zh（中文）或 en（English），默认 zh' },
      narrate: { type: 'boolean', description: '是否生成 AI 叙事摘要（默认 true；关闭则用模板主线，更快）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          label: { type: 'string' },
          markdown: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `# 报告已生成（${value.label}）\n\n${value.markdown}`
          : `[failed] ${value.error || '生成失败'}`,
      }],
    },
    async execute(args) {
      const a = args || {}
      const startDate = isDateStr(a.startDate) ? a.startDate : fmtDate(Date.now())
      const endDate = isDateStr(a.endDate) ? a.endDate : startDate
      const res = await buildReport(ctx, startDate, endDate, {
        includeSubagents: !!a.includeSubagents,
        withUsage: a.withUsage !== false,
        narrate: a.narrate !== false,
        language: a.language,
      })
      if (!res.ok) return { ok: false, error: res.error }
      return { ok: true, label: res.report.label, markdown: res.report.narrative || '' }
    },
  })
}

/** The configure tool. */
export function reportConfigTool(store) {
  return defineTool({
    name: 'report_config',
    description: '查看或修改 dsh-period-report 定时提醒配置。参数：enabled（开关）、anchorDate（起始日期 YYYY-MM-DD，周期从该日起算）、intervalDays（每隔 N 天提醒一次，1-90，7 即每周）、hour/minute（提醒时刻）、range（previous=提醒时报告上一周期，current=当前周期）、language（zh/en）、narrate（AI 叙事摘要开关）。不带参数时返回当前配置。配置持久化到 ~/.dsh/dsh-period-report.json。',
    parameters: {
      enabled: { type: 'boolean', description: '启用/停用定时提醒' },
      anchorDate: { type: 'string', description: '起始日期 YYYY-MM-DD' },
      intervalDays: { type: 'number', description: '每隔 N 天提醒一次（1-90）' },
      hour: { type: 'number', description: '提醒时刻：小时（0-23）' },
      minute: { type: 'number', description: '提醒时刻：分钟（0-59）' },
      range: { type: 'string', description: 'previous（上一周期，默认）或 current（当前周期）' },
      language: { type: 'string', description: '报告语言 zh/en' },
      narrate: { type: 'boolean', description: 'AI 叙事摘要开关' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          config: { type: 'object' },
          configPath: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const c = value.config || {}
        if (!value.ok) return [{ type: 'text', text: '[failed] 配置读写失败' }]
        const clock = pad(c.hour) + ':' + pad(c.minute)
        const summary = c.enabled
          ? `提醒已启用：每隔 ${c.intervalDays} 天 · ${clock}（自 ${c.anchorDate} 起，统计${c.range === 'previous' ? '上一周期' : '当前周期'}，语言 ${c.language === 'en' ? 'English' : '中文'}，AI 叙事${c.narrate ? '开' : '关'}）`
          : '提醒未启用'
        return [{ type: 'text', text: summary + '。配置保存于 ' + (value.configPath || CONFIG_FILE) }]
      },
    },
    async execute(args) {
      const next = await store.patch(args || {})
      return { ok: true, config: next, configPath: CONFIG_FILE }
    },
  })
}

/** Render the report markdown (stats + narrative + per-session details). */
function renderMarkdown(report, lang) {
  const zh = lang !== 'en'
  const t = report.totals
  const multi = (report.end - report.start) > DAY
  const fmtNum = (n) => { if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'; if (n >= 1000) return (n / 1000).toFixed(1) + 'k'; return String(n) }
  const fmtTime = (ts) => { const d = new Date(ts); const hm = pad(d.getHours()) + ':' + pad(d.getMinutes()); return multi ? pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm : hm }
  const fmtDur = (ms) => { if (ms < 60000) return Math.round(ms / 1000) + 's'; const h = Math.floor(ms / 3600000); const m = Math.round((ms % 3600000) / 60000); return h > 0 ? h + 'h ' + m + 'm' : m + 'm' }
  const L = zh
    ? {
        title: 'DSH 会话报告',
        overview: '概览',
        active: '活跃会话',
        created: '新建会话',
        user: '用户消息',
        assistant: '助手消息',
        tools: '工具调用',
        turns: '轮次',
        steps: '步骤',
        tokIn: 'Token 输入',
        tokOut: 'Token 输出',
        cacheRead: '缓存读',
        cacheWrite: '缓存写',
        reasoning: '推理 Token',
        turnRes: '轮次结果',
        topTools: '常用工具',
        sessions: '会话明细',
        createdOn: '新建于',
        activeOn: '活跃',
        cwd: '目录',
        msg: (u, a) => '消息 ' + u + '/' + a,
        tt: (tc, tu) => '工具 ' + tc + ' · 轮次 ' + tu,
        req: '首条请求',
        untitled: '未命名会话',
        turnChip: (k, n) => '轮次' + k + '：' + n,
      }
    : {
        title: 'DSH Session Report',
        overview: 'Overview',
        active: 'Active sessions',
        created: 'New sessions',
        user: 'User messages',
        assistant: 'Assistant messages',
        tools: 'Tool calls',
        turns: 'Turns',
        steps: 'Steps',
        tokIn: 'Token input',
        tokOut: 'Token output',
        cacheRead: 'Cache read',
        cacheWrite: 'Cache write',
        reasoning: 'Reasoning',
        turnRes: 'Turn results',
        topTools: 'Top tools',
        sessions: 'Sessions',
        createdOn: 'created',
        activeOn: 'active',
        cwd: 'cwd',
        msg: (u, a) => 'Messages ' + u + '/' + a,
        tt: (tc, tu) => 'Tools ' + tc + ' · Turns ' + tu,
        req: 'First request',
        untitled: 'Untitled session',
        turnChip: (k, n) => k + ': ' + n,
      }

  const lines = []
  lines.push('# ' + L.title + ' · ' + report.label)
  lines.push('')
  if (report.narrative) {
    lines.push(report.narrative)
  } else {
    // Template fallback narrative.
    lines.push('**' + (zh ? '今日数据' : 'Today at a glance') + '** ' +
      (zh
        ? t.activeSessions + ' 个活跃会话 · ' + t.userMessages + ' 条用户消息 · ' + t.toolCalls + ' 次工具调用 · 约 ' +
          (t.inputTokens >= 10000 ? (t.inputTokens / 10000).toFixed(0) + ' 万' : t.inputTokens) + '/' +
          (t.outputTokens >= 10000 ? (t.outputTokens / 10000).toFixed(0) + ' 万' : t.outputTokens) + ' tokens'
        : t.activeSessions + ' active sessions · ' + t.userMessages + ' user messages · ' + t.toolCalls + ' tool calls · ~' + fmtNum(t.inputTokens) + '/' + fmtNum(t.outputTokens) + ' tokens'))
    lines.push('')
    lines.push('**' + (zh ? '今日主线' : 'Highlights') + '**')
    const active = report.sessions.filter((s) => s.active)
    if (!active.length) {
      lines.push(zh ? '_该时间段内没有活跃会话。_' : '_No active sessions in this period._')
    } else {
      active.forEach((s) => {
        const d = new Date(s.firstActive)
        lines.push('· ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' ' + s.title + (s.firstUserText ? ' — ' + s.firstUserText : ''))
      })
    }
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## ' + L.overview)
  lines.push('- ' + L.active + ' ' + t.activeSessions + ' · ' + L.created + ' ' + t.createdSessions)
  lines.push('- ' + L.user + ' ' + t.userMessages + ' · ' + L.assistant + ' ' + t.assistantMessages + ' · ' + L.tools + ' ' + t.toolCalls + ' · ' + L.turns + ' ' + t.turns + ' · ' + L.steps + ' ' + t.steps)
  lines.push('- ' + L.tokIn + ' ' + fmtNum(t.inputTokens) + ' · ' + L.tokOut + ' ' + fmtNum(t.outputTokens) + ' · ' + L.cacheRead + ' ' + fmtNum(t.cacheReadTokens) + ' · ' + L.cacheWrite + ' ' + fmtNum(t.cacheWriteTokens) + ' · ' + L.reasoning + ' ' + fmtNum(t.reasoningTokens))
  const endKinds = Object.keys(t.turnEnds).map((k) => L.turnChip(k, t.turnEnds[k]))
  if (endKinds.length) lines.push('- ' + L.turnRes + '：' + endKinds.join(' · '))
  if (t.topTools.length) lines.push('- ' + L.topTools + '：' + t.topTools.map((x) => x.name + '×' + x.count).join('、'))
  lines.push('')
  lines.push('## ' + L.sessions)
  report.sessions.forEach((s, i) => {
    lines.push('')
    lines.push('### ' + (i + 1) + '. ' + s.title + ' (' + s.id + ')')
    const meta = []
    if (s.created) meta.push(L.createdOn + ' ' + fmtDate(s.createdAt))
    if (s.active) meta.push(L.activeOn + ' ' + fmtTime(s.firstActive) + ' ~ ' + fmtTime(s.lastActive) + ' (' + fmtDur(s.lastActive - s.firstActive) + ')')
    if (s.cwd) meta.push(L.cwd + ' ' + s.cwd)
    if (meta.length) lines.push('- ' + meta.join(' · '))
    lines.push('- ' + L.msg(s.userMessages, s.assistantMessages) + ' · ' + L.tt(s.toolCalls, s.turns))
    if (s.inputTokens || s.outputTokens) lines.push('- ' + L.tokIn + ' ' + fmtNum(s.inputTokens) + ' · ' + L.tokOut + ' ' + fmtNum(s.outputTokens) + ' · ' + L.cacheRead + ' ' + fmtNum(s.cacheReadTokens))
    if (s.topTools.length) lines.push('- ' + L.topTools + '：' + s.topTools.map((x) => x.name + '×' + x.count).join('、'))
    if (s.firstUserText) lines.push('- ' + L.req + '：' + s.firstUserText)
  })
  return lines.join('\n')
}

/** One reminder firing: build, save to disk, notify, and return a summary. */
async function fireReminder(ctx, store, notify) {
  const cfg = await store.load()
  const k = currentPeriodIndex(cfg, Date.now())
  if (k === null) return null
  const r = reportRangeFor(cfg, k)
  const res = await buildReport(ctx, fmtDate(r.start), fmtDate(r.end - 1), {
    includeSubagents: false,
    withUsage: true,
    narrate: cfg.narrate,
    language: cfg.language,
  })
  if (!res.ok) return null
  const md = renderMarkdown(res.report, cfg.language)
  const safe = res.report.label.replace(/[^\w-]+/g, '_')
  const file = path.join(REPORTS_DIR, safe + '.md')
  await mkdir(REPORTS_DIR, { recursive: true })
  await writeFile(file, md, 'utf8')
  const zh = cfg.language !== 'en'
  const t = res.report.totals
  const summary = zh
    ? t.activeSessions + ' 个活跃会话 · ' + t.userMessages + ' 条用户消息 · ' + t.toolCalls + ' 次工具调用 · 完整报告：' + file
    : t.activeSessions + ' active sessions · ' + t.userMessages + ' user messages · ' + t.toolCalls + ' tool calls · full report: ' + file
  notify(zh ? 'DSH 周期报告 · ' + res.report.label : 'DSH Period Report · ' + res.report.label, summary)
  return { label: res.report.label, file }
}

/**
 * Plugin entry: register the tools, the announcement section, and the
 * reminder scheduler.
 * @param ctx - host plugin context.
 * @param config - plugin configuration from the composition row.
 */
export function apply(ctx, config = {}) {
  const announceToAgent = config.announceToAgent !== false
  const enabled = config.enabled !== false
  const store = new ReportStore()
  const log = (message) => {
    if (ctx.logger?.info) ctx.logger.info(`[dsh-period-report] ${message}`)
    else console.log(`[dsh-period-report] ${message}`)
  }
  const notify = createNotifier(ctx, log)

  let disposeTools
  let disposeSection
  let disposeTimer

  const sync = () => {
    if (disposeTools !== undefined) { disposeTools(); disposeTools = undefined }
    if (disposeSection !== undefined) { disposeSection(); disposeSection = undefined }
    if (disposeTimer !== undefined) { disposeTimer(); disposeTimer = undefined }
    if (!enabled) return
    disposeTools = ctx.effect(
      () => {
        const disposers = [reportGenerateTool(ctx), reportConfigTool(store)].map((tool) => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-period-report: tools',
    )
    if (announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-period-report',
        order: SECTION_ORDER,
        text: PERIOD_REPORT_GUIDANCE,
      })
    }
    const firedKeys = new Set()
    disposeTimer = ctx.effect(
      () => {
        const timer = ctx.get('timer')
        if (!timer || typeof timer.interval !== 'function') return () => {}
        let ticking = false
        return timer.interval(async () => {
          if (ticking) return
          ticking = true
          try {
            const cfg = await store.load()
            if (!cfg.enabled) return
            const now = Date.now()
            const k = currentPeriodIndex(cfg, now)
            if (k === null) return
            const key = 'k:' + k
            if (firedKeys.has(key)) return
            const anchor = parseDate(cfg.anchorDate)
            const span = Math.max(1, cfg.intervalDays) * DAY
            const remindAt = anchor + k * span + (cfg.hour * 3600000 + cfg.minute * 60000)
            if (now < remindAt) return
            firedKeys.add(key)
            const fired = await fireReminder(ctx, store, notify)
            if (fired) log(`reminder fired: ${fired.label} → ${fired.file}`)
          } catch (err) {
            log(`reminder tick failed: ${String(err)}`)
          } finally {
            ticking = false
          }
        }, TICK_MS)
      },
      'dsh-period-report: reminder scheduler',
    )
  }

  sync()
}
