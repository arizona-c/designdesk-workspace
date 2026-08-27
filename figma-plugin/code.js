// Design Desk Figmaプラグイン（メインスレッド）。
// 役割: UI表示 / 選択中Frameの情報とfileKeyをUIへ渡す / 設定のclientStorage保存

figma.showUI(__html__, { width: 360, height: 560, themeColors: true });

async function sendSettings() {
  const token = await figma.clientStorage.getAsync("dd_token");
  const project = await figma.clientStorage.getAsync("dd_project");
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
  }
};
