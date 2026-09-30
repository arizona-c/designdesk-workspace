// Design Desk Figmaプラグイン（メインスレッド）。
// 役割: UI表示 / 選択中Frameの情報とfileKeyをUIへ渡す / 設定のclientStorage保存

figma.showUI(__html__, { width: 360, height: 560, themeColors: true });

// 前回のUIサイズを復元（右下ハンドルでリサイズ可・2026-08-30）
const UI_MIN_W = 320, UI_MIN_H = 400, UI_MAX_W = 720, UI_MAX_H = 1000;
let uiSize = { width: 360, height: 560 };
figma.clientStorage.getAsync("dd_uisize").then((saved) => {
  if (saved && saved.width && saved.height) {
    uiSize = saved;
    figma.ui.resize(saved.width, saved.height);
  }
});

// 旧・全ファイル共有になっていた保存キーの掃除（残っていると誤fileKeyの温床）
figma.clientStorage.deleteAsync("dd_filekey_0:0");

async function sendSettings() {
  const token = await figma.clientStorage.getAsync("dd_token");
  const project = await figma.clientStorage.getAsync("dd_project");
  const url = (await figma.clientStorage.getAsync("dd_url")) || null; // 接続先（独立デプロイの組織のみ設定・未設定なら UI 側の既定）
  const sort = (await figma.clientStorage.getAsync("dd_sort")) || "list";
  const onlyDoing = (await figma.clientStorage.getAsync("dd_only_doing")) || false;
  const scope = (await figma.clientStorage.getAsync("dd_scope")) || "mine"; // mine=自分のチケット / all=すべて
  // fileKey は Community 公開のプラグインでは取得できない（figma.fileKey は組織の非公開プラグイン限定）→ UIでURL貼り付けを促し、ファイル毎に保存。
  // 保存キーはファイル名ベース。旧実装のroot.idは全ファイル共通"0:0"のため、別ファイルのfileKeyを
  // 返してしまい同期先プロダクトを誤る事故があった（2026-09-02修正）。ファイル名変更時は再貼り付けを促す
  let fileKey = figma.fileKey || null;
  if (!fileKey) {
    fileKey = (await figma.clientStorage.getAsync("dd_filekey_name_" + figma.root.name)) || null;
  }
  figma.ui.postMessage({
    type: "settings",
    token: token || null,
    project: project || null,
    url: url,
    fileKey: fileKey,
    fileName: figma.root.name,
    sort: sort,
    onlyDoing: onlyDoing,
    scope: scope,
  });
}

function sendSelection() {
  const sel = figma.currentPage.selection.map((n) => ({ id: n.id, name: n.name }));
  figma.ui.postMessage({ type: "selection", nodes: sel });
}

figma.on("selectionchange", sendSelection);

figma.ui.onmessage = async (msg) => {
  if (msg.type === "init") {
    await sendSettings();
    sendSelection();
  } else if (msg.type === "save-settings") {
    await figma.clientStorage.setAsync("dd_token", msg.token);
    await figma.clientStorage.setAsync("dd_project", msg.project);
    if (msg.url) await figma.clientStorage.setAsync("dd_url", msg.url);
    await sendSettings();
  } else if (msg.type === "save-filekey") {
    await figma.clientStorage.setAsync("dd_filekey_name_" + figma.root.name, msg.fileKey);
    await sendSettings();
  } else if (msg.type === "logout") {
    await figma.clientStorage.deleteAsync("dd_token");
    await figma.clientStorage.deleteAsync("dd_project");
    await sendSettings();
  } else if (msg.type === "notify") {
    figma.notify(msg.message);
  } else if (msg.type === "resize") {
    // UIの右下ハンドルからのドラッグリサイズ（上下限つき）
    uiSize = {
      width: Math.max(UI_MIN_W, Math.min(UI_MAX_W, msg.width)),
      height: Math.max(UI_MIN_H, Math.min(UI_MAX_H, msg.height)),
    };
    figma.ui.resize(uiSize.width, uiSize.height);
  } else if (msg.type === "save-sort") {
    await figma.clientStorage.setAsync("dd_sort", msg.sort);
  } else if (msg.type === "save-only-doing") {
    await figma.clientStorage.setAsync("dd_only_doing", msg.value);
  } else if (msg.type === "save-scope") {
    await figma.clientStorage.setAsync("dd_scope", msg.value);
  } else if (msg.type === "resize-save") {
    await figma.clientStorage.setAsync("dd_uisize", uiSize);
  } else if (msg.type === "export-nodes") {
    // 指定ノードをPNG書き出しして返す（Before/Afterキャプチャ用）。
    // 消えたノードはスキップし、撮れたものだけ返す
    const images = [];
    for (const id of msg.ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || !("exportAsync" in node)) continue;
        const bytes = await node.exportAsync({
          format: "PNG",
          // width指定あり=サムネ用の縮小書き出し（コンポーネント一覧）。なし=等倍（キャプチャ用）
          constraint: msg.width ? { type: "WIDTH", value: msg.width } : { type: "SCALE", value: 1 },
        });
        images.push({ id, name: node.name, data: figma.base64Encode(bytes) });
      } catch (e) {
        // 書き出せないノードは黙ってスキップ（UI側で件数を表示する）
      }
    }
    figma.ui.postMessage({ type: "exported", requestId: msg.requestId, images });
  } else if (msg.type === "read-components") {
    // 全ページのコンポーネント/コンポーネントセットを列挙（Variantはセットにまとめる）。
    // 正本はFigma側 — これはDesign Deskの「開かずに眺める索引」用スナップショット
    try {
      await figma.loadAllPagesAsync();
      const out = [];
      const usage = {}; // componentKey → { total, pages: { pageName: count } }（このファイル内のインスタンス使用数）
      const varUsage = {}; // "コレクション名/変数名" → { total, pages }（デザインシステムの使用回数・DSページ用）
      const varNameCache = {}; // variableId → "コレクション名/変数名"（解決は変数の種類数ぶんだけ）
      async function varLabel(id) {
        if (varNameCache[id] !== undefined) return varNameCache[id];
        let label = null;
        try {
          const v = await figma.variables.getVariableByIdAsync(id);
          if (v) {
            let colName = "";
            try {
              const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
              colName = col ? col.name : "";
            } catch (e) { colName = ""; }
            label = (colName ? colName + "/" : "") + v.name;
          }
        } catch (e) { label = null; }
        varNameCache[id] = label;
        return label;
      }
      const pages = figma.root.children;
      for (let pi = 0; pi < pages.length; pi++) {
        const page = pages[pi];
        figma.ui.postMessage({ type: "components-progress", done: pi, total: pages.length, page: page.name });
        const nodes = page.findAllWithCriteria({ types: ["COMPONENT", "COMPONENT_SET"] });
        for (const n of nodes) {
          if (n.type === "COMPONENT" && n.parent && n.parent.type === "COMPONENT_SET") continue;
          let variants = "";
          if (n.type === "COMPONENT_SET") {
            try {
              const props = n.variantGroupProperties || {};
              variants = Object.keys(props).map((k) => k + "=" + props[k].values.join("|")).join(" / ");
            } catch (e) { variants = ""; }
          }
          out.push({ id: n.id, key: n.key || "", name: n.name, page: page.name, description: n.description || "", variants: variants, type: n.type });
        }
        // 変数バインドの集計（DSページの使用回数用）。boundVariablesを持つノードだけ走査
        const bounds = page.findAll((n) => n.boundVariables && Object.keys(n.boundVariables).length > 0);
        for (const n of bounds) {
          const bv = n.boundVariables;
          for (const field in bv) {
            const entry = bv[field];
            const aliases = Array.isArray(entry) ? entry : [entry];
            for (const al of aliases) {
              if (!al || !al.id) continue;
              const label = await varLabel(al.id);
              if (!label) continue;
              if (!varUsage[label]) varUsage[label] = { total: 0, pages: {} };
              varUsage[label].total++;
              varUsage[label].pages[page.name] = (varUsage[label].pages[page.name] || 0) + 1;
            }
          }
        }
        // インスタンス集計（Variantは親セットのキーに寄せる — 一覧がセット単位のため）
        const insts = page.findAllWithCriteria({ types: ["INSTANCE"] });
        for (const inst of insts) {
          let mc = null;
          try { mc = await inst.getMainComponentAsync(); } catch (e) { mc = null; }
          if (!mc) continue;
          const owner = mc.parent && mc.parent.type === "COMPONENT_SET" ? mc.parent : mc;
          const key = owner.key || "";
          if (!key) continue;
          if (!usage[key]) usage[key] = { total: 0, pages: {} };
          usage[key].total++;
          usage[key].pages[page.name] = (usage[key].pages[page.name] || 0) + 1;
        }
      }
      figma.ui.postMessage({ type: "components", ok: true, components: out, usage: usage, varUsage: varUsage });
    } catch (e) {
      figma.ui.postMessage({ type: "components", ok: false, error: String(e) });
    }
  } else if (msg.type === "read-design-system") {
    // このファイルのVariable Collectionsとテキストスタイルを読み取ってUIへ返す。
    // REST変数APIはEnterprise限定だが、プラグインAPIはプラン不問で読める
    try {
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      const out = [];
      for (const col of collections) {
        const modeId = col.defaultModeId;
        const vars = [];
        for (const vid of col.variableIds) {
          const v = await figma.variables.getVariableByIdAsync(vid);
          if (!v) continue;
          let value = v.valuesByMode[modeId];
          let ref = null;
          // エイリアス（役割→生値の参照）は参照先の名前を解決しつつ、実値まで辿る
          let guard = 0;
          while (value && value.type === "VARIABLE_ALIAS" && guard < 10) {
            const target = await figma.variables.getVariableByIdAsync(value.id);
            if (!target) break;
            if (!ref) ref = target.name;
            value = target.valuesByMode[Object.keys(target.valuesByMode)[0]];
            guard++;
          }
          let hex = null;
          let num = null;
          if (v.resolvedType === "COLOR" && value && value.r !== undefined) {
            const h = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
            hex = "#" + h(value.r) + h(value.g) + h(value.b);
          } else if (v.resolvedType === "FLOAT" && typeof value === "number") {
            num = value;
          }
          vars.push({ name: v.name, type: v.resolvedType, hex, num, ref, description: v.description || "" });
        }
        out.push({ collection: col.name, variables: vars });
      }
      const styles = await figma.getLocalTextStylesAsync();
      const W = { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
      const textStyles = styles.map((st) => {
        const styleName = (st.fontName && st.fontName.style ? st.fontName.style : "").toLowerCase().replace(/\s/g, "");
        let weight = 400;
        for (const k in W) if (styleName.includes(k)) { weight = W[k]; }
        let lh = 0;
        if (st.lineHeight && st.lineHeight.unit === "PIXELS") lh = Math.round((st.lineHeight.value / st.fontSize) * 100) / 100;
        else if (st.lineHeight && st.lineHeight.unit === "PERCENT") lh = Math.round(st.lineHeight.value) / 100;
        return { name: st.name, size: st.fontSize, weight, lineHeight: lh, usage: st.description || "" };
      });
      figma.ui.postMessage({ type: "design-system", ok: true, fileName: figma.root.name, collections: out, textStyles });
    } catch (e) {
      figma.ui.postMessage({ type: "design-system", ok: false, error: String(e) });
    }
  } else if (msg.type === "wire-inventory") {
    try { await wireInventory(msg); } catch (e) { figma.ui.postMessage({ type: "wire-inventory-result", ok: false, error: String(e) }); }
  } else if (msg.type === "auto-check") {
    // 自動チェック（#16）: 選んだ Frame の中だけを決まった検査で調べる（AI なし・読むだけで何も変えない）。
    // 種類は Design Desk のルールに結んだものだけ（msg.kinds）。例は種類ごとに 5 件まで
    try {
      const result = await runAutoCheck(msg.ids || [], msg.kinds || []);
      figma.ui.postMessage({ type: "auto-check-result", requestId: msg.requestId, result });
    } catch (e) {
      figma.ui.postMessage({ type: "auto-check-result", requestId: msg.requestId, error: String((e && e.message) || e) });
    }
  } else if (msg.type === "goto-node") {
    // 同一ファイル内なら該当ノードへジャンプ（ページ切替+スクロール&ズーム+選択）
    try {
      const node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) throw new Error("not found");
      let page = node;
      while (page && page.type !== "PAGE") page = page.parent;
      if (page && page.type === "PAGE") await figma.setCurrentPageAsync(page);
      figma.viewport.scrollAndZoomIntoView([node]);
      figma.currentPage.selection = [node];
      figma.notify("移動しました: " + node.name);
      figma.ui.postMessage({ type: "goto-result", ok: true });
    } catch (e) {
      figma.ui.postMessage({ type: "goto-result", ok: false, url: msg.url });
    }
  }
};

// ==== 自動チェック（#16）====
// 種類と「要確認」の決まりは Design Desk の src/lib/auto-check.ts（AUTO_CHECKS）と同じ。ここを変えたらあちらの説明も直す
const DEFAULT_LAYER_NAME_RE = /^(Frame|Group|Vector|Rectangle|Ellipse|Line|Polygon|Star|Text|Section|Image) \d+$/;
const AUTO_CHECK_SAMPLES = 5;
const AUTO_CHECK_MAX_NODES = 30000; // 選んだ範囲が巨大でも固まらない上限

function hasUnboundSolid(paints) {
  if (!Array.isArray(paints)) return false; // figma.mixed（文字ごとに違う塗り）は数えない
  return paints.some((p) => p && p.type === "SOLID" && p.visible !== false && !(p.boundVariables && p.boundVariables.color));
}

async function runAutoCheck(ids, kinds) {
  const want = new Set(kinds);
  const found = {};
  kinds.forEach((k) => { found[k] = { kind: k, count: 0, samples: [] }; });
  const hit = (k, node) => {
    const f = found[k];
    f.count++;
    if (f.samples.length < AUTO_CHECK_SAMPLES) f.samples.push({ nodeId: node.id, name: node.name });
  };
  const scope = [];
  let nodeCount = 0;
  const visit = (node, top) => {
    if (nodeCount >= AUTO_CHECK_MAX_NODES) return;
    nodeCount++;
    if (want.has("default_layer_name") && !top && DEFAULT_LAYER_NAME_RE.test(node.name)) hit("default_layer_name", node);
    if (want.has("hex_color")) {
      // スタイル（塗り・線）が当たっていれば直打ちではない
      const fillStyled = "fillStyleId" in node && node.fillStyleId && node.fillStyleId !== figma.mixed;
      const strokeStyled = "strokeStyleId" in node && node.strokeStyleId;
      if (("fills" in node && !fillStyled && hasUnboundSolid(node.fills)) || ("strokes" in node && !strokeStyled && hasUnboundSolid(node.strokes))) hit("hex_color", node);
    }
    // インスタンスの中は部品側の問題なので数えない（インスタンス自体は見る）
    if (node.type === "INSTANCE") return;
    if ("children" in node) for (const c of node.children) visit(c, false);
  };
  for (const id of ids) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT") continue;
    scope.push({ nodeId: node.id, name: node.name });
    visit(node, true);
  }
  return { scope, nodeCount, truncated: nodeCount >= AUTO_CHECK_MAX_NODES, findings: kinds.map((k) => found[k]) };
}

// ==== ワイヤー生成（#36 棚卸し / #38 描画）・モックアップ作成（#44 取り出し）====
// 原則: 既存ページ・既存ノードは読むだけで一切変更しない。描くのは新しく作ったページの中だけ。AI は使わない（決定的な処理）

function nameIgnored(name, prefixes) {
  const n = String(name || "").trim().toLowerCase();
  return (prefixes || []).some((p) => p && n.startsWith(String(p).toLowerCase()));
}

// プロトタイプ接続の遷移先（Frame 自身と中のボタン等に付いた reactions を集める）
function reactionTargets(node) {
  const out = [];
  const take = (n) => {
    const rs = n.reactions || [];
    for (const r of rs) {
      const actions = r.actions || (r.action ? [r.action] : []);
      for (const a of actions) if (a && a.type === "NODE" && a.destinationId) out.push(a.destinationId);
    }
  };
  take(node);
  if ("findAll" in node) {
    try { node.findAll((n) => n.reactions && n.reactions.length > 0).forEach(take); } catch (e) { /* 巨大 Frame は諦める */ }
  }
  return Array.from(new Set(out));
}

async function wireInventory(msg) {
  // 範囲（#61）: selection=選択中の Frame / Section だけ（Section は中の最上位 Frame を展開）/ page=今のページ / all=全ページ。
  // selection・page は「渡す対象」として Design Desk に足し込まれ、all は差分確認用の全体（既存の渡す対象の印は保たれる）
  const st = msg.settings || {};
  const scope = msg.scope || "all";
  const minW = typeof st.minFrameWidth === "number" ? st.minFrameWidth : 240;
  const prefixes = st.ignorePrefixes || [];
  const isFrameLike = (n) => n.type === "FRAME" || n.type === "COMPONENT" || n.type === "INSTANCE";
  // 人に選ばせずに機械的に取れる情報も送る（2026-09-13 オーナー決定）: 種類・親の並び（Section › Section › Frame の入れ子）・画面名の候補（中の一番大きい文字）。
  // Design Desk 側はこれで画面グループと画面の下書きを組み立てる。Figma は変えない
  const parentsOf = (n) => {
    const out = [];
    let p = n.parent;
    while (p && p.type !== "PAGE" && p.type !== "DOCUMENT") { out.unshift({ id: p.id, name: p.name, type: p.type }); p = p.parent; }
    return out;
  };
  const titleOf = (n) => {
    try {
      if (n.width < minW || !("findAllWithCriteria" in n)) return "";
      const texts = n.findAllWithCriteria({ types: ["TEXT"] }).slice(0, 300);
      let best = null, bestSize = 0;
      for (const t of texts) {
        const chars = (t.characters || "").trim().replace(/\s+/g, " ");
        if (!chars || chars.length > 40 || t.visible === false) continue;
        const size = typeof t.fontSize === "number" ? t.fontSize : 0;
        if (size > bestSize) { bestSize = size; best = chars; }
      }
      return best || "";
    } catch (e) { return ""; }
  };
  const frameOf = (n) => ({ node_id: n.id, name: n.name, type: n.type, width: Math.round(n.width), height: Math.round(n.height), links: reactionTargets(n), parents: parentsOf(n), title: titleOf(n) });
  const collect = (nodes, out, strict) => {
    for (const n of nodes) {
      if (n.type === "SECTION") { collect(n.children, out, strict); continue; }
      if (!isFrameLike(n)) continue;
      if (strict && (n.width < minW || nameIgnored(n.name, prefixes))) continue;
      out.push(frameOf(n));
    }
  };
  const pages = [];
  if (scope === "selection") {
    const sel = figma.currentPage.selection;
    if (!sel.length) { figma.ui.postMessage({ type: "wire-inventory-result", ok: false, error: "Frame か Section を選んでください（複数可）" }); return; }
    const frames = [];
    for (const n of sel) {
      if (n.type === "SECTION") collect(n.children, frames, false);
      else if (isFrameLike(n)) frames.push(frameOf(n));
      else if ("children" in n) collect(n.children, frames, false);
    }
    // 同じ Frame を二重に選んでいても 1 件
    const seen = new Set();
    pages.push({ name: figma.currentPage.name, frames: frames.filter((f) => (seen.has(f.node_id) ? false : (seen.add(f.node_id), true))) });
  } else if (scope === "page") {
    const frames = [];
    collect(figma.currentPage.children, frames, true);
    pages.push({ name: figma.currentPage.name, frames });
  } else {
    await figma.loadAllPagesAsync();
    const all = figma.root.children;
    for (let i = 0; i < all.length; i++) {
      const page = all[i];
      figma.ui.postMessage({ type: "wire-progress", done: i, total: all.length, page: page.name });
      if (nameIgnored(page.name, prefixes)) continue;
      const frames = [];
      collect(page.children, frames, true);
      pages.push({ name: page.name, frames });
    }
  }
  figma.ui.postMessage({ type: "wire-inventory-result", ok: true, fileName: figma.root.name, pages, scope });
}
