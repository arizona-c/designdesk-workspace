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

async function sendSettings() {
  const token = await figma.clientStorage.getAsync("dd_token");
  const project = await figma.clientStorage.getAsync("dd_project");
  const sort = (await figma.clientStorage.getAsync("dd_sort")) || "list";
  const onlyDoing = (await figma.clientStorage.getAsync("dd_only_doing")) || false;
  // fileKeyは開発版プラグインでは取れないことがある → その場合はUIでURL貼り付けを促し、ファイル毎に保存
  let fileKey = figma.fileKey || null;
  if (!fileKey) {
    fileKey = (await figma.clientStorage.getAsync("dd_filekey_" + figma.root.id)) || null;
  }
  figma.ui.postMessage({
    type: "settings",
    token: token || null,
    project: project || null,
    fileKey: fileKey,
    fileName: figma.root.name,
    sort: sort,
    onlyDoing: onlyDoing,
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
    await sendSettings();
  } else if (msg.type === "save-filekey") {
    await figma.clientStorage.setAsync("dd_filekey_" + figma.root.id, msg.fileKey);
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
