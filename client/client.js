window.__ModuleLoader__.load({ id: "dsh-period-report", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
'use strict'

/**
 * dsh-period-report client: settings section (report generator + reminder
 * configuration) and the shell-overlay reminder toasts with a large reading
 * window. Hand-authored CJS bundle (no build step); the only external is the
 * loader module table's `react`.
 */

const React = require('react')
const h = React.createElement
const { useState, useEffect } = React

const pad = (n) => String(n).padStart(2, '0')
const fmtDate = (t) => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }
const todayStr = () => fmtDate(Date.now())
const clock = (c) => pad(c.hour) + ':' + pad(c.minute)
const timePatch = (v) => { const p = String(v).split(':'); return { hour: Number(p[0]) || 0, minute: Number(p[1]) || 0 } }
const fmtNum = (n) => { if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'; if (n >= 1000) return (n / 1000).toFixed(1) + 'k'; return String(n) }
const fmtWan = (n) => { if (n >= 100000000) return (n / 100000000).toFixed(0) + ' 亿'; if (n >= 10000) return (n / 10000).toFixed(0) + ' 万'; return String(n) }
const fmtTime = (t, multiDay) => { const d = new Date(t); const hm = pad(d.getHours()) + ':' + pad(d.getMinutes()); return multiDay ? pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm : hm }
const fmtDur = (ms) => { if (ms < 60000) return Math.round(ms / 1000) + 's'; const hh = Math.floor(ms / 3600000); const m = Math.round((ms % 3600000) / 60000); return hh > 0 ? hh + 'h ' + m + 'm' : m + 'm' }

const ZH = {
  reportTitle: 'DSH 会话报告',
  reminderTitle: '📊 DSH 报告提醒',
  overview: '概览',
  activeSessions: '活跃会话',
  newSessions: '新建会话',
  userMessages: '用户消息',
  assistantMessages: '助手消息',
  toolCalls: '工具调用',
  turns: '轮次',
  steps: '步骤',
  tokenInput: 'Token 输入',
  tokenOutput: 'Token 输出',
  cacheRead: '缓存读',
  cacheWrite: '缓存写',
  reasoning: '推理 Token',
  turnResults: '轮次结果',
  topTools: '常用工具',
  sessionsSection: '会话明细',
  created: '新建于',
  active: '活跃',
  cwd: '目录',
  messages: (u, a) => '消息 ' + u + '/' + a,
  toolsTurns: (tc, tu) => '工具 ' + tc + ' · 轮次 ' + tu,
  tokensLine: (i, o) => 'Token 输入 ' + i + ' / 输出 ' + o,
  firstRequest: '首条请求',
  activeBadge: '活跃',
  createdBadge: '新建',
  noSessions: '该时间段内没有任务会话',
  markdownHint: 'Markdown 报告（可全选复制）',
  viewFull: '查看完整报告',
  gotIt: '知道了',
  close: '✕ 关闭',
  turnChip: (k, n) => '轮次' + k + '：' + n,
  createAt: (d) => '创建 ' + d,
  errorRange: '结束日期不能早于开始日期',
  dataLine: '今日数据',
  mainline: '今日主线',
  dataText: (t) => t.activeSessions + ' 个活跃会话 · ' + t.userMessages + ' 条用户消息 · ' + t.assistantMessages + ' 条助手消息 · ' + t.toolCalls + ' 次工具调用 · 约 ' + fmtWan(t.inputTokens) + '/' + fmtWan(t.outputTokens) + ' tokens',
}
const EN = {
  reportTitle: 'DSH Session Report',
  reminderTitle: '📊 DSH Report Reminder',
  overview: 'Overview',
  activeSessions: 'Active sessions',
  newSessions: 'New sessions',
  userMessages: 'User messages',
  assistantMessages: 'Assistant messages',
  toolCalls: 'Tool calls',
  turns: 'Turns',
  steps: 'Steps',
  tokenInput: 'Token input',
  tokenOutput: 'Token output',
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
  reasoning: 'Reasoning',
  turnResults: 'Turn results',
  topTools: 'Top tools',
  sessionsSection: 'Sessions',
  created: 'created',
  active: 'active',
  cwd: 'cwd',
  messages: (u, a) => 'Messages ' + u + '/' + a,
  toolsTurns: (tc, tu) => 'Tools ' + tc + ' · Turns ' + tu,
  tokensLine: (i, o) => 'Tokens in ' + i + ' / out ' + o,
  firstRequest: 'First request',
  activeBadge: 'active',
  createdBadge: 'new',
  noSessions: 'No sessions in this period',
  markdownHint: 'Markdown report (click to select all)',
  viewFull: 'View full report',
  gotIt: 'Got it',
  close: '✕ Close',
  turnChip: (k, n) => k + ': ' + n,
  createAt: (d) => 'created ' + d,
  errorRange: 'End date must not be earlier than start date',
  dataLine: 'Today at a glance',
  mainline: 'Highlights',
  dataText: (t) => t.activeSessions + ' active sessions · ' + t.userMessages + ' user messages · ' + t.assistantMessages + ' assistant messages · ' + t.toolCalls + ' tool calls · ~' + fmtNum(t.inputTokens) + '/' + fmtNum(t.outputTokens) + ' tokens',
}
const L = (lang) => (lang === 'en' ? EN : ZH)

async function api(method, payload) {
  const response = await fetch('/dsh-period-report/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
  const parsed = await response.json().catch(() => null)
  if (!response.ok || !parsed || parsed.ok !== true) {
    throw new Error((parsed && parsed.error) || ('HTTP ' + response.status))
  }
  return parsed.value
}

function templateNarrative(r, lang) {
  const l = L(lang)
  const t = r.totals
  const lines = []
  lines.push('**' + l.dataLine + '** ' + l.dataText(t))
  lines.push('')
  lines.push('**' + l.mainline + '**')
  const active = r.sessions.filter((s) => s.active)
  if (!active.length) {
    lines.push(lang === 'en' ? '_No active sessions in this period._' : '_该时间段内没有活跃会话。_')
  } else {
    active.forEach((s) => {
      const d = new Date(s.firstActive)
      lines.push('· ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' ' + s.title + (s.firstUserText ? ' — ' + s.firstUserText : ''))
    })
  }
  return lines.join('\n')
}

const CSS = `
.dshr{display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--dsw-alias-label-primary);min-width:0}
.dshr-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dshr select,.dshr input[type=date],.dshr input[type=time],.dshr input[type=number]{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 8px;color:var(--dsw-alias-label-primary);font-size:12px}
.dshr label{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshr button{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 12px;color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer}
.dshr button.primary{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}
.dshr button:disabled{opacity:.55;cursor:default}
.dshr .err{color:var(--dsw-alias-state-error-primary);font-size:12px}
.dshr .loading{color:var(--dsw-alias-label-secondary);font-size:12px}
.dshr .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}
.dshr .card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px}
.dshr .card .num{font-size:16px;font-weight:600}
.dshr .card .lbl{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshr .chips{display:flex;flex-wrap:wrap;gap:4px}
.dshr .chip{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:1px 8px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshr .session{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px}
.dshr .session h4{margin:0 0 4px;font-size:13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dshr .session .meta{color:var(--dsw-alias-label-secondary);font-size:11px;margin:2px 0}
.dshr .badge{font-size:10px;padding:0 6px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.dshr .badge.active{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dshr .badge.created{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dshr .quote{border-left:2px solid var(--dsw-alias-border-l2);padding-left:8px;color:var(--dsw-alias-label-secondary);font-size:12px;margin:6px 0;overflow-wrap:anywhere}
.dshr textarea{width:100%;min-height:150px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;resize:vertical;box-sizing:border-box}
.dshr h3{margin:4px 0 0;font-size:14px}
.dshr-narrative{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;font-size:12.5px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
.dshr-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshr-remrow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed var(--dsw-alias-border-l1)}
.dshr-toasts{position:absolute;right:16px;bottom:16px;top:auto;left:auto;display:flex;flex-direction:column;gap:8px;z-index:1000;pointer-events:auto;align-items:flex-end}
.dshr-toast{width:min(420px,calc(100vw - 40px));max-height:calc(100vh - 32px);display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;box-shadow:0 4px 16px rgba(0,0,0,.25)}
.dshr-toast-title{font-size:13px;font-weight:600;margin-bottom:4px;flex:none}
.dshr-toast .meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:4px;flex:none}
.dshr-toast-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px;flex:none}
.dshr-toast-actions button.primary{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}
.dshr-modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2000;pointer-events:auto}
.dshr-modal{width:min(920px,calc(100vw - 48px));height:min(85vh,720px);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;display:flex;flex-direction:column;padding:14px 16px;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,.35)}
.dshr-modal-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none}
.dshr-modal-title{font-size:15px;font-weight:600}
.dshr-modal-close{flex:none;padding:2px 10px;font-size:14px}
.dshr-modal .chips{flex:none}
.dshr-modal-text{flex:1;min-height:0;width:100%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.65;resize:none;box-sizing:border-box;overflow:auto}
`

function injectStyles() {
  if (document.querySelector('style[data-plugin-css="dsh-period-report"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-period-report'
  tag.dataset.pluginCss = 'dsh-period-report'
  tag.textContent = CSS
  document.head.appendChild(tag)
}

function card(label, value) {
  return h('div', { className: 'card', key: label },
    h('div', { className: 'num' }, String(value)),
    h('div', { className: 'lbl' }, label))
}

function ReportView({ report, lang }) {
  const l = L(lang)
  const t = report.totals
  const narrText = report.narrative || templateNarrative(report, lang)
  const endKinds = Object.keys(t.turnEnds)
  const multi = (report.end - report.start) > 86400000
  const md = report.markdown || ''
  return h(React.Fragment, null,
    h('h3', null, l.reportTitle + ' · ' + report.label),
    h('div', { className: 'dshr-narrative' }, narrText),
    h('div', { className: 'dshr-controls' },
      h('span', { className: 'chip' }, l.activeSessions + ' ' + t.activeSessions),
      h('span', { className: 'chip' }, l.newSessions + ' ' + t.createdSessions)),
    h('div', { className: 'cards' },
      card(l.userMessages, t.userMessages),
      card(l.assistantMessages, t.assistantMessages),
      card(l.toolCalls, t.toolCalls),
      card(l.turns, t.turns),
      card(l.tokenInput, fmtNum(t.inputTokens)),
      card(l.tokenOutput, fmtNum(t.outputTokens)),
      card(l.cacheRead, fmtNum(t.cacheReadTokens)),
      card(l.reasoning, fmtNum(t.reasoningTokens))),
    endKinds.length ? h('div', { className: 'chips' }, endKinds.map((k) => h('span', { key: k, className: 'chip' }, l.turnChip(k, t.turnEnds[k])))) : null,
    t.topTools.length ? h('div', { className: 'chips' }, t.topTools.map((x) => h('span', { key: x.name, className: 'chip' }, x.name + '×' + x.count))) : null,
    report.sessions.length === 0 ? h('div', { className: 'chips' }, h('span', { className: 'chip' }, l.noSessions)) : null,
    report.sessions.map((s, i) =>
      h('div', { key: s.id, className: 'session' },
        h('h4', null,
          (i + 1) + '. ' + s.title,
          s.active ? h('span', { className: 'badge active' }, l.activeBadge) : null,
          s.created ? h('span', { className: 'badge created' }, l.createdBadge) : null),
        h('div', { className: 'meta' },
          [
            s.id,
            s.cwd ? l.cwd + ' ' + s.cwd : null,
            s.created ? l.createAt(fmtDate(s.createdAt)) : null,
            s.active ? l.active + ' ' + fmtTime(s.firstActive, multi) + ' ~ ' + fmtTime(s.lastActive, multi) + '（' + fmtDur(s.lastActive - s.firstActive) + '）' : null,
          ].filter(Boolean).join(' · ')),
        h('div', { className: 'meta' },
          l.messages(s.userMessages, s.assistantMessages) + ' · ' + l.toolsTurns(s.toolCalls, s.turns) +
          (s.inputTokens || s.outputTokens ? ' · ' + l.tokensLine(fmtNum(s.inputTokens), fmtNum(s.outputTokens)) : '')),
        s.topTools.length ? h('div', { className: 'chips' }, s.topTools.map((x) => h('span', { key: x.name, className: 'chip' }, x.name + '×' + x.count))) : null,
        s.firstUserText ? h('div', { className: 'quote' }, l.firstRequest + '：' + s.firstUserText) : null)),
    h('label', null, l.markdownHint),
    h('textarea', { readOnly: true, value: md, onFocus: (e) => e.target.select() }))
}

function SettingsSection() {
  const [config, setConfig] = useState(null)
  const [saved, setSaved] = useState(false)
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState(todayStr())
  const [includeSubagents, setIncludeSubagents] = useState(false)
  const [withUsage, setWithUsage] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [report, setReport] = useState(null)
  const [tested, setTested] = useState(false)

  useEffect(() => {
    injectStyles()
    api('config', {}).then((v) => setConfig(v.config)).catch(() => {})
  }, [])

  const lang = config ? config.language : 'zh'
  const l = L(lang)
  const dayOpts = Array.from({ length: 90 }, (_, i) => h('option', { key: i + 1, value: i + 1 }, i + 1 + ' 天'))

  const update = (patch) => setConfig((c) => (c ? { ...c, ...patch } : c))

  const save = async () => {
    if (!config) return
    try {
      const v = await api('config', config)
      setConfig(v.config)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) { setError(String((e && e.message) || e)) }
  }

  const generate = async () => {
    setLoading(true)
    setError(null)
    if (startDate > endDate) { setError(l.errorRange); setLoading(false); return }
    try {
      const value = await api('report', { startDate, endDate, includeSubagents, withUsage, narrate: config ? config.narrate : true, language: lang })
      setReport(value)
    } catch (e) {
      setError(String((e && e.message) || e))
    } finally {
      setLoading(false)
    }
  }

  const testReminders = async () => {
    setTested(false)
    try {
      await api('test')
      setTested(true)
    } catch (e) { setError(String((e && e.message) || e)) }
  }

  if (!config) return h('div', { className: 'dshr' }, '加载中…')

  return h('div', { className: 'dshr' },
    h('h3', null, '📊 报告生成'),
    h('div', { className: 'dshr-controls' },
      h('span', { className: 'dshr-hint' }, '开始'),
      h('input', { type: 'date', value: startDate, onChange: (e) => setStartDate(e.target.value) }),
      h('span', { className: 'dshr-hint' }, '结束'),
      h('input', { type: 'date', value: endDate, onChange: (e) => setEndDate(e.target.value) })),
    h('div', { className: 'dshr-controls' },
      h('label', null, h('input', { type: 'checkbox', checked: includeSubagents, onChange: (e) => setIncludeSubagents(e.target.checked) }), '含子代理会话'),
      h('label', null, h('input', { type: 'checkbox', checked: withUsage, onChange: (e) => setWithUsage(e.target.checked) }), 'Token 统计'),
      h('button', { className: 'primary', onClick: generate, disabled: loading }, loading ? '生成中…' : '生成报告')),
    error ? h('div', { className: 'err' }, '错误：' + error) : null,
    loading ? h('div', { className: 'loading' }, '正在扫描会话日志并汇总…') : null,
    report && !loading ? h(ReportView, { report, lang }) : null,
    h('h3', null, '⏰ 定时提醒'),
    h('div', { className: 'dshr-hint' },
      '自由周期：从「起始日期」起，每隔 N 天滚动一个周期，每个周期开始时在设定时刻弹出提醒并自动生成报告。' +
      '例如：起始 06-01、每隔 2 天、09:00 → 06-01、06-03、06-05 … 的 09:00 各提醒一次；设 7 天即每周一次。' +
      '「统计上一周期」表示提醒时展示上一个周期的报告。到点后系统通知 + 界面右下角弹窗，完整报告保存于 ~/.dsh/dsh-period-report/reports/。'),
    h('div', { className: 'dshr-remrow' },
      h('label', null, h('input', { type: 'checkbox', checked: config.enabled, onChange: (e) => update({ enabled: e.target.checked }) }), '启用提醒')),
    h('div', { className: 'dshr-remrow' },
      h('span', { className: 'dshr-hint' }, '报告语言'),
      h('select', { value: config.language, onChange: (e) => update({ language: e.target.value }) },
        h('option', { value: 'zh' }, '中文'),
        h('option', { value: 'en' }, 'English'))),
    h('div', { className: 'dshr-remrow' },
      h('label', null, h('input', { type: 'checkbox', checked: config.narrate, onChange: (e) => update({ narrate: e.target.checked }) }), 'AI 叙事摘要'),
      h('span', { className: 'dshr-hint' }, 'AI 生成「今日数据 / 今日主线 / 今日回顾 / 明日建议」（每次消耗少量 API 额度）')),
    h('div', { className: 'dshr-remrow' },
      h('span', { className: 'dshr-hint' }, '起始日期'),
      h('input', { type: 'date', value: config.anchorDate, disabled: !config.enabled, onChange: (e) => update({ anchorDate: e.target.value }) })),
    h('div', { className: 'dshr-remrow' },
      h('span', { className: 'dshr-hint' }, '每隔'),
      h('select', { value: config.intervalDays, disabled: !config.enabled, onChange: (e) => update({ intervalDays: Number(e.target.value) }) }, dayOpts),
      h('span', { className: 'dshr-hint' }, '天提醒一次')),
    h('div', { className: 'dshr-remrow' },
      h('span', { className: 'dshr-hint' }, '提醒时间'),
      h('input', { type: 'time', value: clock(config), disabled: !config.enabled, onChange: (e) => update(timePatch(e.target.value)) }),
      h('select', { value: config.range, disabled: !config.enabled, onChange: (e) => update({ range: e.target.value }) },
        h('option', { value: 'previous' }, '统计上一周期'),
        h('option', { value: 'current' }, '统计当前周期'))),
    h('div', { className: 'dshr-controls' },
      h('button', { className: 'primary', onClick: save }, saved ? '已保存 ✓' : '保存配置'),
      h('button', { onClick: testReminders }, '测试提醒'),
      tested ? h('span', { className: 'chip' }, '已触发，提醒将在 30 秒内弹出') : null))
}

function ReminderToasts() {
  const [pending, setPending] = useState([])
  const [viewing, setViewing] = useState(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const value = await api('poll')
        if (alive) setPending(value || [])
      } catch (e) { /* ignore */ }
    }
    tick()
    const timer = setInterval(tick, 30000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  const ack = async (id) => {
    try {
      const value = await api('ack', { ids: [id] })
      setPending(value || [])
    } catch (e) { /* ignore */ }
  }

  return h(React.Fragment, null,
    viewing ? h('div', { className: 'dshr-modal-backdrop', onClick: () => setViewing(null) },
      h('div', { className: 'dshr-modal', onClick: (e) => e.stopPropagation() },
        h('div', { className: 'dshr-modal-head' },
          h('div', { className: 'dshr-modal-title' }, L(viewing.language).reminderTitle + ' · ' + viewing.label),
          h('button', { className: 'dshr-modal-close', onClick: () => setViewing(null) }, L(viewing.language).close)),
        h('div', { className: 'chips' },
          h('span', { className: 'chip' }, L(viewing.language).activeSessions + ' ' + viewing.report.totals.activeSessions),
          h('span', { className: 'chip' }, L(viewing.language).toolCalls + ' ' + viewing.report.totals.toolCalls),
          h('span', { className: 'chip' }, L(viewing.language).tokenInput + ' ' + fmtNum(viewing.report.totals.inputTokens)),
          h('span', { className: 'chip' }, L(viewing.language).tokenOutput + ' ' + fmtNum(viewing.report.totals.outputTokens))),
        h('textarea', { readOnly: true, className: 'dshr-modal-text', value: viewing.markdown, onFocus: (e) => e.target.select() })))
      : null,
    pending.length ? h('div', { className: 'dshr-toasts' },
      pending.map((p) =>
        h('div', { key: p.id, className: 'dshr-toast' },
          h('div', { className: 'dshr-toast-title' }, L(p.language).reminderTitle + ' · ' + p.label),
          h('div', { className: 'meta' },
            L(p.language).activeSessions + ' ' + p.report.totals.activeSessions + ' · ' + L(p.language).toolCalls + ' ' + p.report.totals.toolCalls +
            ' · ' + L(p.language).tokenInput + ' ' + fmtNum(p.report.totals.inputTokens) + ' / ' + L(p.language).tokenOutput + ' ' + fmtNum(p.report.totals.outputTokens)),
          h('div', { className: 'dshr-toast-actions' },
            h('button', { className: 'primary', onClick: () => setViewing(p) }, L(p.language).viewFull),
            h('button', { onClick: () => ack(p.id) }, L(p.language).gotIt)))))
      : null)
}

exports.name = 'period-report'
exports.inject = ['slots']
exports.apply = function apply(ctx) {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'session-reports',
    order: 35,
    label: 'Session Report',
  }, () => h(SettingsSection, null)))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'session-report-reminders',
    order: 50,
  }, () => h(ReminderToasts, null)))
}

return module.exports; } });
