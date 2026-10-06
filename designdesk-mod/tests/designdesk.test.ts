import { expect, mock, test } from 'claude-code/testing'

// Design Desk の Mod: .env を読み、/api/mod/home を取り、pane に見出し・カード・一覧を描く。g で一言を送る

const ENV = 'DESIGNDESK_URL=https://designdesk.example.com\nDESIGNDESK_TOKEN=tok\nDESIGNDESK_PROJECT=daiwa\n'
const HOME = {
  project: { slug: 'daiwa', name: '大和' },
  siteUrl: 'https://designdesk.example.com',
  lead: '#62 の期限を過ぎています',
  card: { kind: 'ticket', key: 't:62', seq: 62, title: '初回モーダルの本文が収まらない', column: '作業中', due: '2026-09-07', role: '担当', say: null, by: null, options: [{ key: 'start', label: '続きを進めて', words: 'Design Desk の #62 を進めて' }, { key: 'status', label: 'いまの状況を 3 行で教えて', words: 'Design Desk の #62 のいまの状況を 3 行で教えて' }], url: 'https://designdesk.example.com/daiwa/board/62' },
  rows: [
    { key: 't:17', seq: 17, title: 'Overlay のコンポーネント化', column: '作業中', columnRole: 'doing', role: '担当', due: null, fresh: true, aiAt: null },
    { key: 'approvals', title: '提案 1 件（ルール 1）', column: '確認待ち', fresh: false },
  ],
}

const PANE = {
  plugin: 'designdesk',
  component: 'Pane',
  requestId: 'designdesk',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'Design Desk', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('起動時に .env と /api/mod/home を読み、pane に見出し・カード・一覧を描く', async ($, on) => {
  mock.clock(on)
  const fetched: string[] = []
  on('fs.read', () => ({ value: ENV }))
  on('http.fetch', ($, e) => { fetched.push(e.url); return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(HOME) } } })
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', () => ({ cwd: '/work' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(fetched[0]).toBe('https://designdesk.example.com/api/mod/home?project=daiwa')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '#62 の期限を過ぎています' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /初回モーダル/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /#17 .*新着/ })).toBeDefined()
  expect(await ui.find({ key: 'go' })).toBeDefined()
  await ui.unmount()
})

test('g で「続きを進めて」をあなたの言葉として送る', async ($, on) => {
  mock.clock(on)
  const sent: Array<{ text: string; asUser?: boolean }> = []
  on('fs.read', () => ({ value: ENV }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(HOME) } }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => { sent.push({ text: e.text, asUser: e.asUser }); return { text: e.text } })
  on('session.start', () => ({ cwd: '/work' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'go' })
  expect(sent[0]?.text).toBe('Design Desk の #62 を進めて')
  await ui.unmount()
})

test('.env が無ければ /dd がその旨を返す', async ($, on) => {
  mock.clock(on)
  on('fs.read', () => ({ deny: 'no such file' }))
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const answer = await $.command.run({ command: 'dd', args: '' })
  expect(answer.text).toMatch(/\.env/)
})
