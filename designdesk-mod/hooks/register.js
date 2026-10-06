// Design Desk の Mod（Claude Code 2.1.287 以上・2026-10-06・PoC）。
// ターミナルの中に、Design Desk のホームと同じもの（まずやること・いまのチケットのカード・あなたの順番の一覧）を pane で出す。
// データは作業フォルダの .env（DESIGNDESK_URL / DESIGNDESK_TOKEN / DESIGNDESK_PROJECT）で Design Desk の /api/mod/home を読む。
// 触るもの: .env の読み取り、DESIGNDESK_URL への HTTP だけ。ほかのファイル・プロセス・環境変数には触らない。
//
// できること:
//   /dd           pane を開く（Esc で閉じる）
//   g             いまのカードの「続きを進めて」を、あなたの言葉として送る（AI が get_ticket → 作業 → Design Desk に書き戻す）
//   1〜5          ほかの頼み方（作業報告の下書き・いまの状況を 3 行で・提出前のセルフチェック…）を送る
//   l             「あとで」= 並びの末尾へ（Design Desk の画面と同じ home_orders）
//   r             取り直し
// Design Desk の道具（designdesk / claude.ai の Design Desk コネクタ）が呼ばれたあとは自動で取り直す。60 秒ごとにも取り直す。
//
// 読む側の決まり（claude plugin validate が静的に読む）: $.名前.メソッド を省略せずに書く・$ は最上位の関数にだけ渡す・on の出来事名は文字列で

const PANE = 'designdesk'
const REFRESH_MS = 60000

let env = null // { url, token, project }
let data = null // /api/mod/home の返事
let error = null // 直近のエラーの一言
let loadedAt = 0

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'dd', description: 'Design Desk のホームを開く（まずやること・担当のチケット）', immediate: true })
    await loadEnv($)
    await refresh($)
    // 自分で開く pane は広い端末でだけ出る（144 列）。狭ければ /dd で開く
    if (env) await $.ui.open({ id: PANE, title: 'Design Desk' })
    $.clock.every(REFRESH_MS, () => refresh($))
    return next(e)
  })

  on('command.run', { command: 'dd' }, async ($) => {
    if (!env) await loadEnv($)
    await refresh($)
    if (!env) return { text: '作業フォルダの .env（DESIGNDESK_URL / DESIGNDESK_TOKEN / DESIGNDESK_PROJECT）が見つかりません。作業フォルダの中で起動してください' }
    await $.ui.open({ id: PANE, title: 'Design Desk', focus: true, closeOnEscape: true })
    return {}
  })

  // Design Desk の道具が呼ばれたら、終わってから取り直す（AI が書いた直後の状態を映す）
  on('tool.call', { tool: /designdesk|design_desk/i }, async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  }).catch(async ($, e, next) => next(e)) // 取り直しに失敗しても道具は通す（止める役ではない）

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const columns = Math.max(24, (e.props && e.props.bodyColumns) || 60)
    const lines = []

    if (!env) {
      lines.push(Text({ children: ['作業フォルダの .env が見つかりません（DESIGNDESK_URL / DESIGNDESK_TOKEN / DESIGNDESK_PROJECT）'] }))
      return Box({ flexDirection: 'column', children: lines })
    }
    if (error && !data) {
      lines.push(Text({ color: 'red', children: ['Design Desk に届きません: ' + error] }))
      lines.push(Button({ key: 'retry', label: '取り直す', hotkey: 'r', plain: true, onPress: () => refresh($) }))
      return Box({ flexDirection: 'column', children: lines })
    }
    if (!data) {
      lines.push(Text({ dimColor: true, children: ['読み込んでいます…'] }))
      return Box({ flexDirection: 'column', children: lines })
    }

    // 見出し（まずやること。無ければ挨拶）
    lines.push(Text({ bold: true, wrap: 'wrap', children: [data.lead] }))
    lines.push(Text({ children: [' '] }))

    // いまのカード
    const card = data.card
    if (card && card.kind === 'ticket') {
      lines.push(Text({ dimColor: true, children: ['#' + card.seq + ' · ' + card.column + (card.due ? ' · 期日 ' + shortDate(card.due) : '')] }))
      lines.push(Text({ bold: true, wrap: 'wrap', children: [card.title] }))
      if (card.say) lines.push(Text({ dimColor: true, wrap: 'wrap', children: [(card.by ? card.by + ': ' : '') + '「' + card.say + '」'] }))
      lines.push(Text({ children: [' '] }))
      const opts = card.options || []
      if (opts.length) {
        lines.push(Button({ key: 'go', label: opts[0].label, hotkey: 'g', onPress: () => send($, opts[0].words) }))
        const others = opts.slice(1, 6)
        others.forEach((o, i) => {
          lines.push(Button({ key: 'ask-' + o.key, label: o.label, hotkey: String(i + 1), plain: true, onPress: () => send($, o.words) }))
        })
      }
      lines.push(Button({ key: 'later', label: 'あとで（末尾へ）', hotkey: 'l', plain: true, onPress: () => later($, card.key) }))
    } else if (card && card.kind === 'approvals') {
      lines.push(Text({ dimColor: true, children: ['確認待ち'] }))
      lines.push(Text({ bold: true, children: [card.title + '（' + (card.parts || []).join('・') + '）'] }))
      lines.push(Text({ dimColor: true, wrap: 'wrap', children: ['確認は Design Desk で: ' + card.url] }))
      lines.push(Button({ key: 'later', label: 'あとで（末尾へ）', hotkey: 'l', plain: true, onPress: () => later($, card.key) }))
    } else {
      lines.push(Text({ dimColor: true, children: ['担当のチケットはありません'] }))
    }

    // あなたの順番の一覧
    const rows = data.rows || []
    if (rows.length) {
      lines.push(Text({ children: [' '] }))
      lines.push(Text({ dimColor: true, children: ['担当しているチケット ' + rows.length + ' 件'] }))
      for (const r of rows) {
        const head = r.seq ? '#' + r.seq : r.column
        const tail = (r.fresh ? ' 新着' : '') + (r.role === 'レビュアー' ? ' あなたがレビュー' : '') + (r.seq ? '  ' + r.column : '')
        const room = Math.max(8, columns - head.length - tail.length - 3)
        lines.push(Text({ wrap: 'truncate-end', children: [head + '  ' + cut(r.title, room) + tail] }))
      }
    }
    lines.push(Text({ children: [' '] }))
    lines.push(Text({ dimColor: true, children: [data.project.name + ' · ' + ago(loadedAt) + ' · r で取り直し'] }))
    lines.push(Button({ key: 'refresh', label: '取り直す', hotkey: 'r', plain: true, onPress: () => refresh($) }))
    return Box({ flexDirection: 'column', children: lines })
  })
}

// ---- Design Desk との通信（最上位の関数にだけ $ を渡す） ----

async function loadEnv($) {
  try {
    const text = await $.fs.read('.env')
    const get = (k) => { const m = text.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^"|"$/g, '') : '' }
    const url = get('DESIGNDESK_URL'), token = get('DESIGNDESK_TOKEN'), project = get('DESIGNDESK_PROJECT')
    env = url && token && project ? { url: url.replace(/\/$/, ''), token, project } : null
  } catch {
    env = null
  }
}

async function refresh($) {
  if (!env) return
  try {
    const res = await $.http.fetch(env.url + '/api/mod/home?project=' + encodeURIComponent(env.project), { headers: { authorization: 'Bearer ' + env.token } })
    if (!res.ok) { error = 'HTTP ' + res.status; $.ui.invalidate('ui.render'); return }
    data = JSON.parse(res.text)
    error = null
    loadedAt = Date.now()
  } catch (err) {
    error = String(err && err.message ? err.message : err)
  }
  $.ui.invalidate('ui.render')
}

/** 一言を、あなたの言葉として送る（AI が Design Desk の道具で進める） */
async function send($, words) {
  if (!words) return
  await $.prompt.submit({ text: words, asUser: true })
  $.ui.toast('送りました: ' + words)
}

/** 「あとで」= 並びの末尾へ */
async function later($, key) {
  if (!env || !key) return
  try {
    const res = await $.http.fetch(env.url + '/api/mod/home?project=' + encodeURIComponent(env.project), { method: 'POST', headers: { authorization: 'Bearer ' + env.token, 'content-type': 'application/json' }, body: JSON.stringify({ later: key }) })
    if (!res.ok) $.ui.toast('あとで、にできませんでした（HTTP ' + res.status + '）')
  } catch (err) {
    $.ui.toast('あとで、にできませんでした: ' + String(err && err.message ? err.message : err))
  }
  await refresh($)
}

// ---- 見た目の小道具 ----
function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s }
function shortDate(ymd) { const p = String(ymd).split('-'); return p.length === 3 ? Number(p[1]) + '/' + Number(p[2]) : ymd }
function ago(t) { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'たった今' : m + ' 分前' }
