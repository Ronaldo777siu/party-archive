// LibLoader：多源加载第三方浏览器库（本地 → jsDelivr → unpkg → cdnjs），弱网/缓存失败时自动兜底
window.LibLoader = (function () {
  const LIB_SOURCES = {
    xlsx: [
      "lib/sheetjs.full.min.js",
      "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
      "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
    ],
    mammoth: [
      "lib/mammoth.browser.min.js",
      "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js",
      "https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js"
    ]
  };
  const GLOBALS = { xlsx: "XLSX", mammoth: "mammoth" };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("load fail: " + src));
      document.head.appendChild(s);
    });
  }

  async function ensure(lib) {
    const globalName = GLOBALS[lib];
    if (window[globalName]) return window[globalName];
    const sources = LIB_SOURCES[lib] || [];
    let lastErr = null;
    for (const src of sources) {
      try {
        await loadScript(src);
        if (window[globalName]) return window[globalName];
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error(lib + " 加载失败，请检查网络后刷新重试");
  }

  return { ensure, ensureXlsx: () => ensure("xlsx"), ensureMammoth: () => ensure("mammoth") };
})();
