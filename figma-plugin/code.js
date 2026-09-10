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
  } else if (msg.type === "wire-draw") {
    try { await wireDraw(msg); } catch (e) { figma.ui.postMessage({ type: "wire-drawn", ok: false, error: String(e) }); }
  } else if (msg.type === "mock-extract") {
    try { await mockExtract(msg); } catch (e) { figma.ui.postMessage({ type: "mock-extracted", ok: false, error: String(e) }); }
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
  const st = msg.settings || {};
  const minW = typeof st.minFrameWidth === "number" ? st.minFrameWidth : 240;
  const prefixes = st.ignorePrefixes || [];
  await figma.loadAllPagesAsync();
  const pages = [];
  const all = figma.root.children;
  for (let i = 0; i < all.length; i++) {
    const page = all[i];
    figma.ui.postMessage({ type: "wire-progress", done: i, total: all.length, page: page.name });
    if (nameIgnored(page.name, prefixes)) continue;
    const frames = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.type === "SECTION") { walk(n.children); continue; }
        if (n.type !== "FRAME" && n.type !== "COMPONENT" && n.type !== "INSTANCE") continue;
        if (n.width < minW || nameIgnored(n.name, prefixes)) continue;
        frames.push({ node_id: n.id, name: n.name, width: Math.round(n.width), height: Math.round(n.height), links: reactionTargets(n) });
      }
    };
    walk(page.children);
    pages.push({ name: page.name, frames });
  }
  figma.ui.postMessage({ type: "wire-inventory-result", ok: true, fileName: figma.root.name, pages });
}

// ---- 描画 ----
const GREY = { r: 0.82, g: 0.82, b: 0.84 }, GREY_D = { r: 0.62, g: 0.62, b: 0.66 }, LINE = { r: 0.55, g: 0.55, b: 0.6 }, INK = { r: 0.16, g: 0.16, b: 0.18 }, WHITE = { r: 1, g: 1, b: 1 }, NEW = { r: 0.06, g: 0.55, b: 0.36 };
const solid = (c, o) => [{ type: "SOLID", color: c, opacity: o == null ? 1 : o }];

function hasImageFill(n) {
  const f = n.fills;
  return Array.isArray(f) && f.some((p) => p.type === "IMAGE" && p.visible !== false);
}

// 既存 Frame を灰色の箱・線・枠に置き換えて target に描く（元には触らない）
function simplifyInto(src, target, scale) {
  const ob = src.absoluteBoundingBox;
  if (!ob) return 0;
  let budget = 400;
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      if (budget <= 0) return;
      if (n.visible === false) continue;
      const b = n.absoluteBoundingBox;
      if (!b) continue;
      const x = (b.x - ob.x) * scale, y = (b.y - ob.y) * scale, w = b.width * scale, h = b.height * scale;
      if (w < 1.5 || h < 1.5) continue;
      if (n.type === "TEXT") {
        const r = figma.createRectangle();
        const fs = typeof n.fontSize === "number" ? n.fontSize : 14;
        const bh = Math.max(2, Math.min(h, fs * 0.75 * scale));
        r.x = x; r.y = y + (h - bh) / 2 > 0 && h < fs * 1.6 * scale ? y + (h - bh) / 2 : y;
        r.resize(Math.max(2, w * 0.92), bh);
        r.cornerRadius = bh / 2;
        r.fills = solid(GREY_D, 0.9);
        target.appendChild(r); budget--;
        // 複数行の文字は行ごとに帯を足す
        const lines = Math.min(6, Math.floor(h / (fs * 1.45 * scale)));
        for (let i = 1; i < lines; i++) {
          const r2 = r.clone(); r2.y = y + i * fs * 1.45 * scale; r2.resize(Math.max(2, w * (i === lines - 1 ? 0.55 : 0.92)), bh);
          target.appendChild(r2); budget--;
        }
        continue;
      }
      if (n.type === "INSTANCE" || n.type === "COMPONENT") {
        const r = figma.createRectangle();
        r.x = x; r.y = y; r.resize(w, h);
        r.fills = solid(WHITE, 0); r.strokes = solid(LINE); r.strokeWeight = 1;
        r.cornerRadius = Math.min(6, h / 4);
        target.appendChild(r); budget--;
        if (depth < 4 && "children" in n) walk(n.children, depth + 1);
        continue;
      }
      if (["RECTANGLE", "ELLIPSE", "VECTOR", "STAR", "POLYGON", "LINE", "BOOLEAN_OPERATION"].includes(n.type)) {
        const img = hasImageFill(n);
        const shape = n.type === "ELLIPSE" ? figma.createEllipse() : figma.createRectangle();
        shape.x = x; shape.y = y; shape.resize(w, h);
        shape.fills = solid(img ? GREY_D : GREY, img ? 0.7 : 0.6);
        if (shape.type === "RECTANGLE") shape.cornerRadius = Math.min(4, h / 4);
        target.appendChild(shape); budget--;
        continue;
      }
      if (n.type === "FRAME" || n.type === "GROUP" || n.type === "SECTION") {
        if (depth <= 2 && n.type === "FRAME" && (hasImageFill(n) || (Array.isArray(n.fills) && n.fills.some((p) => p.type === "SOLID" && p.visible !== false && p.opacity !== 0)))) {
          const r = figma.createRectangle();
          r.x = x; r.y = y; r.resize(w, h);
          r.fills = solid(hasImageFill(n) ? GREY_D : WHITE, hasImageFill(n) ? 0.7 : 1);
          r.strokes = solid(GREY); r.strokeWeight = 1;
          target.appendChild(r); budget--;
        }
        if (depth < 5 && "children" in n) walk(n.children, depth + 1);
      }
    }
  };
  if ("children" in src) walk(src.children, 0);
  return 400 - budget;
}

// まだ Frame が無い画面: 区画を固定部品で置く（第2段 #39 の基本形）
const REGION_LABEL = { header: "ヘッダー", nav: "ナビ", hero: "メインビジュアル", list: "一覧", form: "フォーム", text: "文章", image: "画像", cta: "主ボタン", footer: "フッター", modal: "モーダル", tabs: "タブ", block: "ブロック" };
async function kitInto(regions, target, w, h) {
  const rs = regions && regions.length ? regions : [{ kind: "header", weight: 1 }, { kind: "text", weight: 2 }, { kind: "list", weight: 4 }, { kind: "cta", weight: 1 }];
  const total = rs.reduce((a, r) => a + (r.weight || 1), 0);
  const pad = Math.max(4, w * 0.03);
  let y = pad;
  const inner = h - pad * 2 - (rs.length - 1) * pad;
  for (const r of rs) {
    const rh = Math.max(8, inner * ((r.weight || 1) / total));
    const box = figma.createRectangle();
    box.x = pad; box.y = y; box.resize(w - pad * 2, rh);
    box.fills = solid(r.kind === "image" || r.kind === "hero" ? GREY_D : GREY, r.kind === "cta" ? 1 : 0.5);
    box.strokes = solid(LINE); box.strokeWeight = 1; box.cornerRadius = 4;
    target.appendChild(box);
    const t = figma.createText();
    t.characters = (REGION_LABEL[r.kind] || r.kind) + (r.label ? "：" + r.label : "");
    t.fontSize = Math.max(8, Math.min(12, rh * 0.5)); t.fills = solid(INK, 0.8);
    t.x = pad + 6; t.y = y + 4;
    target.appendChild(t);
    y += rh + pad;
  }
}

async function wireDraw(msg) {
  const { pageName, screens, transitions, settings, highlightIds, removedNames } = msg;
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  const scale = settings.drawScale || 0.25, cols = Math.max(1, settings.drawColumns || 4);
  const page = figma.createPage();
  page.name = pageName;
  const GAP = 160, LABEL_H = 36;
  // 各画面のサイズ（Frame があればその寸法・無ければ 390×844）
  const sized = screens.map((s) => {
    const st = (s.states || [])[0];
    const w = (st && st.width) || 390, h = (st && st.height) || 844;
    return { s, w: w * scale, h: h * scale };
  });
  const cellW = Math.max(...sized.map((x) => x.w)), cellH = Math.max(...sized.map((x) => x.h)) + LABEL_H;
  const pos = {};
  let drawn = 0, missing = 0;
  for (let i = 0; i < sized.length; i++) {
    const { s, w, h } = sized[i];
    const col = i % cols, row = Math.floor(i / cols);
    const x = col * (cellW + GAP), y = row * (cellH + GAP) + LABEL_H;
    figma.ui.postMessage({ type: "wire-progress", done: i, total: sized.length, page: s.name });
    const label = figma.createText();
    label.fontName = { family: "Inter", style: "Bold" }; label.fontSize = 14; label.characters = s.name; label.fills = solid(INK);
    label.x = x; label.y = y - 24;
    page.appendChild(label);
    const f = figma.createFrame();
    f.name = s.name; f.x = x; f.y = y; f.resize(w, h);
    f.fills = solid(WHITE); f.strokes = solid((highlightIds || []).includes(s.id) ? NEW : LINE); f.strokeWeight = (highlightIds || []).includes(s.id) ? 3 : 1;
    f.clipsContent = true;
    page.appendChild(f);
    let src = null;
    const nodeId = (s.layout && s.layout.nodeId) || ((s.states || [])[0] || {}).nodeId;
    if (nodeId && (!s.layout || s.layout.source !== "kit")) { try { src = await figma.getNodeByIdAsync(nodeId); } catch (e) { src = null; } }
    if (src && "children" in src) { simplifyInto(src, f, scale); drawn++; }
    else { await kitInto(s.layout && s.layout.regions, f, w, h); missing++; }
    if ((highlightIds || []).includes(s.id)) {
      const tag = figma.createText(); tag.fontName = { family: "Inter", style: "Bold" }; tag.fontSize = 10; tag.characters = "NEW"; tag.fills = solid(NEW);
      tag.x = x + w - 30; tag.y = y - 22; page.appendChild(tag);
    }
    pos[s.id] = { x, y, w, h };
  }
  // 遷移: 線（先端に矢印）＋条件ラベル
  let lines = 0;
  for (const t of transitions) {
    const a = pos[t.fromScreenId], b = pos[t.toScreenId];
    if (!a || !b) continue;
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const dx = bc.x - ac.x, dy = bc.y - ac.y;
    let p1, p2;
    if (Math.abs(dx) >= Math.abs(dy)) { p1 = { x: dx >= 0 ? a.x + a.w : a.x, y: ac.y }; p2 = { x: dx >= 0 ? b.x : b.x + b.w, y: bc.y }; }
    else { p1 = { x: ac.x, y: dy >= 0 ? a.y + a.h : a.y }; p2 = { x: bc.x, y: dy >= 0 ? b.y - LABEL_H : b.y + b.h }; }
    const v = figma.createVector();
    v.name = "→ " + (t.label || "");
    const minX = Math.min(p1.x, p2.x), minY = Math.min(p1.y, p2.y);
    v.x = minX; v.y = minY;
    await v.setVectorNetworkAsync({
      vertices: [{ x: p1.x - minX, y: p1.y - minY, strokeCap: "NONE" }, { x: p2.x - minX, y: p2.y - minY, strokeCap: "ARROW_LINES" }],
      segments: [{ start: 0, end: 1 }],
      regions: [],
    });
    v.strokes = solid(LINE); v.strokeWeight = 2;
    page.appendChild(v);
    if (settings.showLabels !== false && t.label) {
      const lt = figma.createText(); lt.fontSize = 11; lt.characters = t.label; lt.fills = solid(INK, 0.85);
      lt.x = (p1.x + p2.x) / 2 - lt.width / 2; lt.y = (p1.y + p2.y) / 2 - 16;
      page.appendChild(lt);
    }
    lines++;
  }
  if (removedNames && removedNames.length) {
    const note = figma.createText(); note.fontSize = 12; note.fills = solid(INK, 0.7);
    note.characters = "前回にあって今回は無い画面: " + removedNames.join("、");
    note.x = 0; note.y = -60; page.appendChild(note);
  }
  await figma.setCurrentPageAsync(page);
  figma.viewport.scrollAndZoomIntoView(page.children);
  figma.ui.postMessage({ type: "wire-drawn", ok: true, pageName, drawn, missing, lines });
}

// ---- モックアップ作成: 参考デザインの取り出し（AI なし・決定的）----
function guessRegionKind(n, idx, total) {
  const s = (n.name || "").toLowerCase();
  const pairs = [["header", "header"], ["ヘッダー", "header"], ["nav", "nav"], ["tab", "tabs"], ["footer", "footer"], ["フッター", "footer"], ["hero", "hero"], ["kv", "hero"], ["list", "list"], ["一覧", "list"], ["card", "list"], ["form", "form"], ["input", "form"], ["button", "cta"], ["cta", "cta"], ["modal", "modal"], ["dialog", "modal"], ["image", "image"], ["img", "image"], ["text", "text"]];
  for (const [k, v] of pairs) if (s.includes(k)) return v;
  if (idx === 0) return "header";
  if (idx === total - 1 && total > 2) return "footer";
  return "block";
}
const toHex = (c) => "#" + [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");

async function mockExtract(msg) {
  const targets = [];
  for (const id of msg.ids || []) { try { const n = await figma.getNodeByIdAsync(id); if (n && "children" in n) targets.push(n); } catch (e) { /* skip */ } }
  const samples = [];
  const styleNameCache = {};
  for (let ti = 0; ti < targets.length; ti++) {
    const node = targets[ti];
    figma.ui.postMessage({ type: "mock-progress", done: ti, total: targets.length, page: node.name });
    let page = node; while (page && page.type !== "PAGE") page = page.parent;
    const data = { width: Math.round(node.width), height: Math.round(node.height), instances: [], regions: [], spacing: [], textStyles: [], colors: [] };
    // 区画: 直下の子を上から順に
    const kids = node.children.filter((c) => c.visible !== false).slice().sort((a, b) => a.y - b.y);
    data.regions = kids.slice(0, 24).map((c, i) => ({ kind: guessRegionKind(c, i, kids.length), y: Math.round(c.y), height: Math.round(c.height), label: c.name }));
    // 部品: インスタンス（メインコンポーネント名・キー・バリアント）
    const instMap = {};
    let insts = [];
    try { insts = node.findAllWithCriteria({ types: ["INSTANCE"] }).slice(0, 400); } catch (e) { insts = []; }
    for (const inst of insts) {
      let mc = null; try { mc = await inst.getMainComponentAsync(); } catch (e) { mc = null; }
      if (!mc) continue;
      const owner = mc.parent && mc.parent.type === "COMPONENT_SET" ? mc.parent : mc;
      const props = {};
      try { const cp = inst.componentProperties || {}; for (const k in cp) if (cp[k].type === "VARIANT" || cp[k].type === "BOOLEAN") props[k.replace(/#.*$/, "")] = String(cp[k].value); } catch (e) { /* ignore */ }
      const key = owner.name + "|" + JSON.stringify(props);
      if (!instMap[key]) instMap[key] = { name: owner.name, key: owner.key || "", props, count: 0 };
      instMap[key].count++;
    }
    data.instances = Object.values(instMap).sort((a, b) => b.count - a.count).slice(0, 60);
    // 余白: オートレイアウトの間隔とパディング
    const spacingCount = {};
    let frames = [];
    try { frames = node.findAllWithCriteria({ types: ["FRAME", "COMPONENT", "INSTANCE"] }).slice(0, 600); } catch (e) { frames = []; }
    for (const f of [node].concat(frames)) {
      if (!f.layoutMode || f.layoutMode === "NONE") continue;
      for (const v of [f.itemSpacing, f.paddingTop, f.paddingRight, f.paddingBottom, f.paddingLeft]) {
        if (typeof v === "number" && v > 0) spacingCount[v] = (spacingCount[v] || 0) + 1;
      }
    }
    data.spacing = Object.keys(spacingCount).map(Number).sort((a, b) => spacingCount[b] - spacingCount[a]).slice(0, 15);
    // 文字: サイズ・太さ・スタイル名
    const textMap = {};
    let texts = [];
    try { texts = node.findAllWithCriteria({ types: ["TEXT"] }).slice(0, 600); } catch (e) { texts = []; }
    for (const t of texts) {
      const size = typeof t.fontSize === "number" ? t.fontSize : 0;
      const style = t.fontName && t.fontName.style ? t.fontName.style : "";
      let name = "";
      if (typeof t.textStyleId === "string" && t.textStyleId) {
        if (styleNameCache[t.textStyleId] === undefined) { try { const st = await figma.getStyleByIdAsync(t.textStyleId); styleNameCache[t.textStyleId] = st ? st.name : ""; } catch (e) { styleNameCache[t.textStyleId] = ""; } }
        name = styleNameCache[t.textStyleId];
      }
      const k = name + "|" + size + "|" + style;
      if (!textMap[k]) textMap[k] = { name: name || (size + "px " + style), size, style, count: 0 };
      textMap[k].count++;
    }
    data.textStyles = Object.values(textMap).sort((a, b) => b.count - a.count).slice(0, 15);
    // 色: 単色塗りの出現回数（変数に結びついていれば役割名）
    const colorMap = {};
    let painted = [];
    try { painted = node.findAll((n) => Array.isArray(n.fills) && n.fills.length > 0).slice(0, 800); } catch (e) { painted = []; }
    for (const n of painted) {
      for (const p of n.fills) {
        if (p.type !== "SOLID" || p.visible === false) continue;
        const hex = toHex(p.color);
        let role = "";
        try {
          const bv = n.boundVariables && n.boundVariables.fills;
          const al = Array.isArray(bv) ? bv[0] : bv;
          if (al && al.id) { const v = await figma.variables.getVariableByIdAsync(al.id); role = v ? v.name : ""; }
        } catch (e) { role = ""; }
        const k = hex + "|" + role;
        if (!colorMap[k]) colorMap[k] = { hex, role, count: 0 };
        colorMap[k].count++;
      }
    }
    data.colors = Object.values(colorMap).sort((a, b) => b.count - a.count).slice(0, 15);
    samples.push({ node_id: node.id, name: node.name, page: page ? page.name : "", data });
  }
  figma.ui.postMessage({ type: "mock-extracted", ok: true, samples });
}
