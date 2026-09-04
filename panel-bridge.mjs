#!/usr/bin/env node
// Design Desk「ローカルClaude連携パネル（ベータ）」の橋渡し。
// このフォルダで手元の Claude Code をヘッドレス起動し、ブラウザの Design Desk 右パネルと中継する。
//
// - 待ち受けは 127.0.0.1 のみ（LAN・外部からは届かない）
// - 接続を許すブラウザのオリジンは .env の DESIGNDESK_URL（と開発用 http://localhost:3000）だけ
// - 起動ごとに表示される6桁の接続コードを Design Desk 側のパネルに入力して結びつける
// - 会話は Design Desk のサーバーを通らず、このPC内で完結する（Claude の認証は手元の claude ログインをそのまま使う）
// - ツール実行の許可はパネル側のボタンで返す。許可しない限り Claude は書き込みをしない
//
// 使い方:  node panel-bridge.mjs            （Node 20 以上・依存パッケージなし）
// 止め方:  Ctrl+C
//
// 外し方: このファイルと「Claude連携パネル.command」を消すだけ。他のファイルからは参照されない

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DESIGNDESK_PANEL_PORT || 47831);
const HISTORY_MAX = 300;

// ---- .env（KEY=VALUE のみ。値の引用符は外す）----
const env = {};
if (existsSync(resolve(ROOT, ".env"))) {
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const PROJECT = env.DESIGNDESK_PROJECT || "";
const allowedOrigins = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
if (env.DESIGNDESK_URL) {
  try {
    allowedOrigins.add(new URL(env.DESIGNDESK_URL).origin);
  } catch {}
}

// ---- 状態 ----
const pairCode = String(Math.floor(100000 + Math.random() * 900000));
let token = null; // 接続後に発行するアクセストークン（1つだけ・再ペアで置き換え）
let child = null; // claude 子プロセス
let sessionId = null; // 継続用（子プロセスが落ちたら --resume で戻す）
let busy = false;
const pending = new Map(); // request_id -> { toolName, input }
const autoAllow = new Set(); // 「このツールは以後許可」
const history = []; // パネル再接続時に再生する（delta は含めない）
const clients = new Set(); // SSE レスポンス

function emit(ev, keep = true) {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(line);
  if (keep) {
    history.push(ev);
    if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
  }
}
function state() {
  return { type: "state", project: PROJECT, cwd: ROOT, busy, sessionId, running: !!child };
}

// ---- claude 子プロセス ----
function ensureChild() {
  if (child) return child;
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-prompt-tool", "stdio",
    "--permission-mode", "default",
  ];
  if (sessionId) args.push("--resume", sessionId);
  const p = spawn("claude", args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], env: process.env });
  child = p;
  let buf = "";
  p.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) handleLine(line);
    }
  });
  p.stderr.on("data", (d) => {
    const s = d.toString().trim();
    if (s) process.stderr.write(`[claude] ${s.slice(0, 500)}\n`);
  });
  p.on("exit", (code) => {
    child = null;
    busy = false;
    for (const id of pending.keys()) emit({ type: "permission_resolved", requestId: id, behavior: "deny" });
    pending.clear();
    emit({ type: "status", message: code === 0 ? "Claude を終了しました" : `Claude が終了しました（code ${code}）。次の送信で再開します` });
    emit(state(), false);
  });
  emit({ type: "status", message: sessionId ? "Claude を再開しました" : "Claude を起動しました" });
  return p;
}

function toChild(obj) {
  if (!child) return;
  child.stdin.write(JSON.stringify(obj) + "\n");
}

function summarizeTool(name, input) {
  if (!input || typeof input !== "object") return "";
  if (name === "Bash") return String(input.command ?? "").slice(0, 200);
  if (input.file_path) return String(input.file_path).replace(ROOT + "/", "");
  if (input.pattern) return String(input.pattern);
  if (input.url) return String(input.url);
  if (name.startsWith("mcp__")) {
    const keys = Object.keys(input).slice(0, 4);
    return keys.map((k) => `${k}=${JSON.stringify(input[k]).slice(0, 60)}`).join(" ");
  }
  return JSON.stringify(input).slice(0, 160);
}

function handleLine(line) {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  switch (m.type) {
    case "system":
      if (m.subtype === "init") {
        sessionId = m.session_id || sessionId;
        emit(state(), false);
      }
      return;
    case "stream_event": {
      const e = m.event;
      if (!e) return;
      if (e.type === "content_block_start") emit({ type: "block_start" }, false);
      if (e.type === "content_block_delta" && e.delta?.type === "text_delta") emit({ type: "delta", text: e.delta.text }, false);
      return;
    }
    case "assistant": {
      for (const block of m.message?.content ?? []) {
        if (block.type === "text" && block.text) emit({ type: "assistant", text: block.text });
        if (block.type === "tool_use") emit({ type: "tool", name: block.name, summary: summarizeTool(block.name, block.input) });
      }
      return;
    }
    case "user": {
      // ツール結果（エラーだけ知らせる）
      for (const block of m.message?.content ?? []) {
        if (block.type === "tool_result" && block.is_error) {
          const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          emit({ type: "tool_error", summary: String(text).slice(0, 200) });
        }
      }
      return;
    }
    case "control_request": {
      const req = m.request;
      if (req?.subtype !== "can_use_tool") return;
      if (autoAllow.has(req.tool_name)) {
        respondPermission(m.request_id, "allow", req.input);
        emit({ type: "tool_auto", name: req.tool_name });
        return;
      }
      pending.set(m.request_id, { toolName: req.tool_name, input: req.input });
      emit({
        type: "permission",
        requestId: m.request_id,
        toolName: req.tool_name,
        displayName: req.display_name || req.tool_name,
        description: req.description || "",
        summary: summarizeTool(req.tool_name, req.input),
      });
      return;
    }
    case "result": {
      busy = false;
      sessionId = m.session_id || sessionId;
      emit({ type: "result", ok: !m.is_error, durationMs: m.duration_ms ?? null, costUsd: m.total_cost_usd ?? null });
      emit(state(), false);
      return;
    }
    default:
      return;
  }
}

function respondPermission(requestId, behavior, input) {
  const response =
    behavior === "allow"
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "利用者がパネルで拒否しました" };
  toChild({ type: "control_response", response: { subtype: "success", request_id: requestId, response } });
}

function sendUser(text) {
  ensureChild();
  busy = true;
  emit({ type: "user", text });
  emit(state(), false);
  console.log(`[${stamp()}] 送信: ${text.slice(0, 60).replace(/\n/g, " ")}`);
  toChild({ type: "user", message: { role: "user", content: text } });
}

function interrupt() {
  if (!child) return;
  toChild({ type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } });
}

// ---- HTTP ----
function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Private-Network", "true"); // Chrome のローカルネットワークアクセス
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Vary", "Origin");
  return true;
}
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((ok) => {
    let s = "";
    req.on("data", (d) => {
      s += d;
      if (s.length > 200_000) req.destroy();
    });
    req.on("end", () => {
      try {
        ok(JSON.parse(s || "{}"));
      } catch {
        ok({});
      }
    });
  });
}
function authed(req, url) {
  if (!token) return false;
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : url.searchParams.get("t");
  return t === token;
}

function stamp() {
  return new Date().toLocaleTimeString("ja-JP", { hour12: false });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method !== "OPTIONS") {
    res.on("finish", () => console.log(`[${stamp()}] ${req.method} ${url.pathname} → ${res.statusCode}`));
  }
  if (!cors(req, res)) {
    // ブラウザ以外（curl等の直接アクセス）や許可外オリジンは拒否
    return json(res, 403, { error: "forbidden origin" });
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && url.pathname === "/status") {
    return json(res, 200, { ok: true, project: PROJECT, paired: authed(req, url), version: 1 });
  }
  if (req.method === "POST" && url.pathname === "/pair") {
    const { code } = await readBody(req);
    if (String(code) !== pairCode) return json(res, 401, { error: "接続コードが違います" });
    token = randomBytes(24).toString("hex");
    console.log(`✅ ブラウザと接続しました（${req.headers.origin}）`);
    return json(res, 200, { token, project: PROJECT });
  }
  if (!authed(req, url)) return json(res, 401, { error: "未接続です。接続コードを入力してください" });

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "hello", history, state: state(), pending: [...pending.entries()].map(([id, p]) => ({ requestId: id, toolName: p.toolName, summary: summarizeTool(p.toolName, p.input) })) })}\n\n`);
    clients.add(res);
    console.log(`[${stamp()}] パネル接続（受信開始）`);
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
      console.log(`[${stamp()}] パネル切断`);
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/send") {
    const { text } = await readBody(req);
    const t = String(text ?? "").trim();
    if (!t) return json(res, 400, { error: "empty" });
    if (busy) return json(res, 409, { error: "Claude が応答中です。完了か中断を待ってください" });
    sendUser(t);
    return json(res, 202, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/permission") {
    const { requestId, behavior, always } = await readBody(req);
    const p = pending.get(requestId);
    if (!p) return json(res, 404, { error: "その確認は既に処理済みです" });
    pending.delete(requestId);
    if (behavior === "allow" && always) autoAllow.add(p.toolName);
    respondPermission(requestId, behavior === "allow" ? "allow" : "deny", p.input);
    emit({ type: "permission_resolved", requestId, behavior: behavior === "allow" ? "allow" : "deny" });
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/interrupt") {
    interrupt();
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/reset") {
    // 会話を仕切り直す（子プロセスを終了し、次回は新規セッションで起動）
    sessionId = null;
    if (child) child.kill();
    history.length = 0;
    autoAllow.clear();
    emit({ type: "status", message: "会話をリセットしました" });
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("Design Desk ローカルClaude連携パネル（ベータ）");
  console.log(`  作業フォルダ : ${ROOT}`);
  console.log(`  プロジェクト : ${PROJECT || "(.env 未設定)"}`);
  console.log(`  待ち受け     : http://127.0.0.1:${PORT}（このPC内のみ）`);
  console.log(`  許可オリジン : ${[...allowedOrigins].join(", ")}`);
  console.log("");
  console.log(`  🔑 接続コード: ${pairCode}`);
  console.log("");
  console.log("Design Desk の右下「Claude」ボタンからパネルを開き、このコードを入力してください。止めるには Ctrl+C。");
});
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`ポート ${PORT} は使用中です。既に起動していないか確認してください（別ポートは DESIGNDESK_PANEL_PORT=番号 で指定）`);
  } else console.error(e);
  process.exit(1);
});
process.on("SIGINT", () => {
  if (child) child.kill();
  process.exit(0);
});
