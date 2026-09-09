// 党务档案管理系统 - 主逻辑
(function () {
  const $ = id => document.getElementById(id);
  const PA = window.PA;

  // ---------- 全局工具 ----------
  const pad2 = n => String(n).padStart(2, "0");
  const fmtDate = v => { if (!v) return null; const d = new Date(v); if (isNaN(d)) return null; const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const showLoading = on => $("loadingMask").classList.toggle("show", !!on);
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms || 2600);
  }
  function showErr(msg) { toast(msg, 3800); }

  const STAGE_LABEL = { "入党申请人": "入党申请人", "入党积极分子": "入党积极分子", "发展对象": "发展对象", "预备党员": "预备党员", "正式党员": "正式党员" };
  const STAGE_ORDER = ["入党申请人", "入党积极分子", "发展对象", "预备党员", "正式党员"];
  const STAGE_CARDS = ["入党申请人", "入党积极分子", "发展对象", "预备党员"];
  const STATUS_CARDS = ["继续发展", "待确认", "已退出", "转出", "转入"];

  // 导出列：中文表头 -> 字段
  const EXPORT_COLS = [
    ["期数", "party_qi"], ["班级", "class_name"], ["姓名", "name"], ["性别", "gender"],
    ["民族", "ethnicity"], ["政治面貌", "political_status"], ["发展阶段", "current_stage"], ["状态", "status_flag"],
    ["出生日期", "birth_date"], ["入团日期", "join_league_date"], ["申请时间", "apply_date"],
    ["谈话时间", "talk_date"], ["推优时间", "recommend_date"], ["积极分子确定时间", "activist_date"],
    ["发展对象确定", "develop_date"], ["预备党员时间", "probation_date"], ["转正时间", "full_date"],
    ["介绍人", "introducer"], ["学号", "student_id"], ["身份证", "id_card"], ["备注", "remark"]
  ];

  // 时间线异常：仅校验非空日期，后阶段早于前阶段即异常
  const TL_SEQ = [
    ["apply_date", "入党申请时间"], ["talk_date", "谈话时间"], ["recommend_date", "推优时间"],
    ["activist_date", "积极分子确定时间"], ["develop_date", "发展对象确定时间"],
    ["probation_date", "预备党员时间"], ["full_date", "转正时间"]
  ];
  function timelineIssue(r) {
    for (let i = 0; i < TL_SEQ.length - 1; i++) {
      const a = fmtDate(r[TL_SEQ[i][0]]);
      const b = fmtDate(r[TL_SEQ[i + 1][0]]);
      if (a && b && a > b) return TL_SEQ[i + 1][1] + "早于" + TL_SEQ[i][1];
    }
    return null;
  }

  // ---------- 启动：会话校验 ----------
  async function bootstrap() {
    try {
      const profile = await PA.currentProfile();
      if (!profile) { window.location.href = "index.html"; return; }
      renderUser(profile);
      PA.isAdmin() ? initAdmin() : initViewer();
      bindNav();
    } catch (e) {
      showErr("会话失效，请重新登录");
      setTimeout(() => { window.location.href = "index.html"; }, 900);
    }
  }

  function renderUser(p) {
    $("userName").textContent = p.username;
    $("rolePill").textContent = p.role === "admin" ? "管理员" : "查询员";
  }

  function initViewer() { /* viewer 仅查询功能，无需额外处理 */ }
  function initAdmin() {
    document.querySelectorAll(".admin-only").forEach(el => el.classList.remove("hidden"));
    loadQiOptions();
    loadLogs(true);
  }

  function bindNav() {
    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        switchSection(btn.dataset.sec);
      });
    });
    $("logoutBtn").addEventListener("click", async () => {
      await PA.signOut();
      window.location.href = "index.html";
    });
  }

  function switchSection(name) {
    document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
    const el = $("sec-" + name);
    if (el) el.classList.add("active");
    if (name === "logs" && PA.isAdmin()) loadLogs(true);
    if (name === "browse" && PA.isAdmin()) loadStats();
  }

  // ================================================================
  // 1. 精确查询
  // ================================================================
  function bindSearch() {
    const run = async () => {
      const cls = $("qClass").value.trim();
      const name = $("qName").value.trim();
      if (!cls && !name) { showErr("请至少输入班级或姓名"); return; }
      showLoading(true);
      try {
        const rows = await PA.queryMembers(cls, name);
        renderSearchResult(rows, cls, name);
      } catch (e) { showErr(e.message); }
      finally { showLoading(false); }
    };
    $("qBtn").addEventListener("click", run);
    $("qName").addEventListener("keydown", e => { if (e.key === "Enter") run(); });
  }

  function renderSearchResult(rows, cls, name) {
    const box = $("searchResult");
    if (!rows.length) {
      box.innerHTML = `<div class="card" style="text-align:center;color:#999;">未查询到${(cls ? "【" + esc(cls) + "】" : "")}${(name ? "【" + esc(name) + "】" : "")}相关档案，请核对班级、姓名后重试</div>`;
      return;
    }
    let html = `<div class="result-info">共找到 <b>${rows.length}</b> 条档案${rows.length > 1 ? "，请点击行查看详情" : ""}</div>`;
    html += `<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th>期数</th><th>班级</th><th>姓名</th><th>性别</th><th>政治面貌</th><th>发展阶段</th><th>状态</th><th>操作</th>
      </tr></thead><tbody>`;
    rows.forEach((r, i) => {
      html += `<tr>
        <td>${esc(r.party_qi || "-")}</td><td>${esc(r.class_name)}</td><td><b>${esc(r.name)}</b></td>
        <td>${esc(r.gender || "-")}</td><td>${esc(r.political_status || "-")}</td>
        <td><span class="stage-tag">${esc(r.current_stage || "-")}</span></td>
        <td>${esc(r.status_flag || "继续发展")}</td>
        <td><button class="btn btn-ghost btn-sm" data-open="${i}">查看详情</button></td></tr>`;
    });
    html += "</tbody></table></div></div>";
    html += `<div id="searchDetail"></div>`;
    box.innerHTML = html;
    box.querySelectorAll("[data-open]").forEach(btn => {
      btn.addEventListener("click", () => {
        const el = $("searchDetail");
        el.innerHTML = memberDetailCard(rows[+btn.dataset.open]);
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    if (rows.length === 1) {
      $("searchDetail").innerHTML = memberDetailCard(rows[0]);
    }
  }

  // 成员详情卡
  function memberDetailCard(m) {
    const items = [
      ["班级", m.class_name], ["姓名", m.name], ["学号", m.student_id], ["性别", m.gender],
      ["出生日期", fmtDate(m.birth_date)], ["民族", m.ethnicity], ["政治面貌", m.political_status],
      ["身份证号", m.id_card], ["入团年月", fmtDate(m.join_league_date)], ["入党期数", m.party_qi],
      ["发展阶段", m.current_stage], ["入党申请时间", fmtDate(m.apply_date)], ["谈话时间", fmtDate(m.talk_date)],
      ["推优时间", fmtDate(m.recommend_date)], ["积极分子确定时间", fmtDate(m.activist_date)],
      ["发展对象确定时间", fmtDate(m.develop_date)], ["接收预备党员时间", fmtDate(m.probation_date)],
      ["转正时间", fmtDate(m.full_date)], ["介绍人", m.introducer],
      ["发展状态", m.status_flag || "继续发展"], ["备注", m.remark]
    ];
    const grid = items.map(([k, v]) =>
      `<div class="detail-item"><span class="k">${k}</span><span class="v ${v == null || v === "" ? "muted" : ""}">${v == null || v === "" ? "—" : esc(v)}</span></div>`
    ).join("");
    return `<div class="card"><h3>档案详情 · ${esc(m.class_name)} ${esc(m.name)}</h3><div class="detail-grid">${grid}</div></div>`;
  }

  // ================================================================
  // 2. 列表浏览（管理员）
  // ================================================================
  async function loadQiOptions() {
    try {
      const qis = await PA.listDistinct("party_qi");
      const sel = $("fQi");
      qis.forEach(q => { const o = document.createElement("option"); o.value = q; o.textContent = q; sel.appendChild(o); });
    } catch (e) { /* 忽略期数下拉失败 */ }
  }

  function bindBrowse() {
    const run = async () => {
      showLoading(true);
      try {
        let rows = await PA.listMembers({
          qi: $("fQi").value,
          stage: $("fStage").value,
          className: $("fClass").value.trim(),
          keyword: $("fKeyword").value.trim()
        });
        const abn = $("fAbn").value;
        if (abn === "pending") rows = rows.filter(r => (r.status_flag || "继续发展") === "待确认");
        else if (abn === "timeline") rows = rows.filter(r => !!timelineIssue(r));
        window.__browseRows = rows;
        renderBrowseTbl(rows);
        const cntEl = $("browseCount"), expEl = $("exportBtn");
        if (cntEl) cntEl.textContent = rows.length ? "共 " + rows.length + " 条档案" : "";
        if (expEl) expEl.disabled = !rows.length;
      } catch (e) { showErr(e.message); }
      finally { showLoading(false); }
    };
    $("browseBtn").addEventListener("click", run);
    $("resetBtn").addEventListener("click", () => {
      $("fQi").value = ""; $("fStage").value = ""; $("fClass").value = ""; $("fKeyword").value = ""; $("fAbn").value = "";
      run();
    });
    // 回车触发
    ["fClass", "fKeyword"].forEach(id => $(id).addEventListener("keydown", e => { if (e.key === "Enter") run(); }));
    window.__browseRun = run;
  }

  function renderBrowseTbl(rows) {
    const tb = $("browseTbl").querySelector("tbody");
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="9" class="empty">暂无符合条件的档案</td></tr>`;
      return;
    }
    tb.innerHTML = rows.map((r, i) => {
      const abn = timelineIssue(r);
      const st = r.status_flag || "继续发展";
      return `<tr class="${abn ? "row-abn" : ""}">
        <td>${esc(r.party_qi || "-")}</td><td>${esc(r.class_name)}</td><td><b>${esc(r.name)}</b></td>
        <td>${esc(r.gender || "-")}</td><td>${esc(r.ethnicity || "-")}</td><td>${esc(r.political_status || "-")}</td>
        <td><span class="stage-tag">${esc(r.current_stage || "-")}</span></td>
        <td>${esc(st)}${abn ? ` <span class="abn-badge" title="${esc(abn)}">异常</span>` : ""}</td>
        <td><button class="btn btn-ghost btn-sm" data-bopen="${i}">详情</button></td></tr>`;
    }).join("");
    tb.querySelectorAll("[data-bopen]").forEach(btn => {
      btn.addEventListener("click", () => {
        $("browseDetail").innerHTML = memberDetailCard(rows[+btn.dataset.bopen]);
        $("browseDetail").scrollIntoView({ behavior: "smooth" });
      });
    });
    $("browseTbl").closest(".tbl-wrap").scrollTop = 0;
  }

  // 统计概览：拉取轻量列后渲染数字卡片
  async function loadStats() {
    const box = $("statsCards");
    if (!box) return;
    box.innerHTML = `<div class="stat-hint">统计加载中…</div>`;
    try {
      const rows = await PA.fetchLightRows();
      if (!rows || !rows.length) { box.innerHTML = `<div class="stat-hint">暂无档案数据</div>`; return; }
      const total = rows.length;
      const qiSet = [...new Set(rows.map(r => r.party_qi).filter(Boolean))];
      let qiMain = "--", qiSub = "已覆盖期数";
      if (qiSet.length) {
        const nums = qiSet.map(v => parseFloat(String(v).replace(/[^\d.]/g, ""))).filter(v => isFinite(v));
        qiMain = nums.length
          ? (Math.min(...nums) === Math.max(...nums) ? String(Math.min(...nums)) : Math.min(...nums) + "~" + Math.max(...nums))
          : String(qiSet[0]);
        qiSub = "已覆盖期数 " + qiSet.length + " 期";
      }
      const stage = {}; STAGE_CARDS.forEach(s => stage[s] = 0);
      rows.forEach(r => { if (r.current_stage && r.current_stage in stage) stage[r.current_stage] += 1; });
      const stat = {}; STATUS_CARDS.forEach(s => stat[s] = 0);
      rows.forEach(r => { const s = r.status_flag || "继续发展"; if (s in stat) stat[s] += 1; });
      const card = (num, label, small) => `<div class="stat-card"><div class="num${small ? " small" : ""}">${esc(String(num))}</div><div class="lbl">${esc(label)}</div></div>`;
      let html = `<div class="stats-cards">`;
      html += card(total, "总人数");
      html += card(qiMain, qiSub, true);
      STAGE_CARDS.forEach(s => html += card(stage[s], s));
      STATUS_CARDS.forEach(s => html += card(stat[s], s));
      html += `</div>`;
      box.innerHTML = html;
    } catch (e) { box.innerHTML = `<div class="stat-hint">统计加载失败</div>`; }
  }

  // 导出 Excel：使用缓存 window.__browseRows，保持当前筛选结果
  function bindExport() {
    const btn = $("exportBtn");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const rows = window.__browseRows || [];
      if (!rows.length) { btn.disabled = true; return; }
      try {
        if (typeof XLSX === "undefined") await LibLoader.ensureXlsx();
        const d = new Date();
        const stamp = "" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
        const sheetRows = rows.map(r => {
          const o = {};
          EXPORT_COLS.forEach(([cn, f]) => {
            let v = r[f];
            if (f === "birth_date" || f === "join_league_date" || f === "apply_date" || f === "talk_date" || f === "recommend_date" || f === "activist_date" || f === "develop_date" || f === "probation_date" || f === "full_date") v = fmtDate(v);
            o[cn] = (v == null || v === "") ? "" : String(v);
          });
          return o;
        });
        const ws = XLSX.utils.json_to_sheet(sheetRows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "档案");
        XLSX.writeFile(wb, "党务档案_" + stamp + ".xlsx");
      } catch (e) { showErr("导出失败：" + e.message); }
    });
  }

  // ================================================================
  // 3. 数据更新（管理员）：Excel / Word
  // ================================================================
  // 表头中文 → 字段
  const HEADER_MAP = [
    ["班级", "class_name"], ["姓名", "name"], ["学号", "student_id"], ["性别", "gender"],
    ["出生日期", "birth_date"], ["出生年月", "birth_date"],
    ["民族", "ethnicity"], ["政治面貌", "political_status"], ["身份证号", "id_card"], ["身份证", "id_card"],
    ["入团年月", "join_league_date"], ["入团时间", "join_league_date"],
    ["入党期数", "party_qi"], ["期数", "party_qi"], ["批次", "party_qi"],
    ["发展阶段", "current_stage"], ["当前阶段", "current_stage"], ["身份", "current_stage"], ["培养阶段", "current_stage"],
    ["入党申请时间", "apply_date"], ["申请时间", "apply_date"],
    ["谈话时间", "talk_date"], ["推优时间", "recommend_date"],
    ["积极分子确定时间", "activist_date"], ["确定为积极分子时间", "activist_date"], ["积极分子时间", "activist_date"],
    ["发展对象确定时间", "develop_date"], ["确定为发展对象时间", "develop_date"], ["发展对象时间", "develop_date"],
    ["接收预备党员时间", "probation_date"], ["预备党员时间", "probation_date"], ["接收时间", "probation_date"], ["确定为预备党员时间", "probation_date"],
    ["转正时间", "full_date"], ["转正日期", "full_date"],
    ["介绍人", "introducer"],
    ["状态", "status_flag"], ["发展状态", "status_flag"], ["人员状态", "status_flag"],
    ["备注", "remark"], ["备注信息", "remark"]
  ];
  const DATE_FIELDS = ["birth_date", "join_league_date", "apply_date", "talk_date", "recommend_date", "activist_date", "develop_date", "probation_date", "full_date"];

  function normHeader(h) {
    const s = String(h || "").trim().replace(/\s/g, "");
    const hit = HEADER_MAP.find(([cn]) => cn === s);
    return hit ? hit[1] : null;
  }

  function normDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date && !isNaN(v)) return fmtDate(v);
    if (typeof v === "number" && isFinite(v)) {
      // Excel 序列号日期
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return fmtDate(d);
    }
    let s = String(v).trim();
    s = s.replace(/[年./]/g, "-").replace(/月/g, "-").replace(/日/g, "").replace(/[T\s].*$/, "");
    const m = s.match(/^(\d{4})-(\d{1,2})-?(\d{0,2})$/);
    if (m) {
      const mo = m[2].padStart(2, "0");
      const dd = m[3] ? m[3].padStart(2, "0") : "01";
      return `${m[1]}-${mo}-${dd}`;
    }
    return null;
  }

  function normStage(v) {
    if (!v) return "入党申请人";
    const s = String(v).trim();
    if (s.includes("预备")) return "预备党员";
    if (s.includes("正式") || s.includes("转正")) return "正式党员";
    if (s.includes("发展对象")) return "发展对象";
    if (s.includes("积极")) return "入党积极分子";
    return "入党申请人";
  }
  function normStatus(v) {
    if (!v) return "继续发展";
    const s = String(v).trim();
    return ["继续发展", "已退出", "转出", "转入", "待确认"].find(x => x === s) || "继续发展";
  }

  function rowToMember(fields, rawRow) {
    const m = {};
    fields.forEach((f, idx) => { if (f) m[f] = rawRow[idx]; });
    const member = {
      class_name: String(m.class_name || "").trim(),
      name: String(m.name || "").trim(),
      student_id: m.student_id == null ? null : String(m.student_id).trim() || null,
      gender: m.gender == null ? null : String(m.gender).trim() || null,
      ethnicity: m.ethnicity == null ? null : String(m.ethnicity).trim() || null,
      political_status: m.political_status == null ? null : String(m.political_status).trim() || null,
      id_card: m.id_card == null ? null : String(m.id_card).trim() || null,
      introducer: m.introducer == null ? null : String(m.introducer).trim() || null,
      party_qi: m.party_qi == null ? null : String(m.party_qi).trim() || null,
      remark: m.remark == null ? null : String(m.remark).trim() || null,
      current_stage: normStage(m.current_stage),
      status_flag: normStatus(m.status_flag)
    };
    DATE_FIELDS.forEach(f => { member[f] = normDate(m[f]); });
    // 学号 / 身份证数字可能带 .0 后缀
    ["student_id", "id_card"].forEach(f => {
      if (member[f] && /\.0$/.test(member[f])) member[f] = member[f].replace(/\.0$/, "");
    });
    return member;
  }

  function validateMember(m) {
    if (!m.class_name) return "存在缺少「班级」的行，已跳过";
    if (!m.name) return "存在缺少「姓名」的行，已跳过";
    const order = [["apply_date", "谈话时间早于申请时间"], ["talk_date", "推优时间早于谈话时间"], ["recommend_date", "积极分子时间早于推优时间"], ["activist_date", "发展对象时间早于积极分子时间"], ["develop_date", "预备党员时间早于发展对象时间"], ["probation_date", "转正时间早于预备党员时间"]];
    for (const [f, msg] of order) {
      const prev = order[order.findIndex(o => o[0] === f) - 1];
      if (prev) {
        const a = member[prev[0]], b = member[f];
        if (a && b && new Date(b) < new Date(a)) return `${member.class_name} ${member.name}：${msg}`;
      }
    }
    return null;
  }

  function buildRowsFromGrid(headerRow, dataRows) {
    const fields = headerRow.map(h => normHeader(h));
    const keyIdx = fields.findIndex(f => f === "class_name");
    const nameIdx = fields.findIndex(f => f === "name");
    if (keyIdx < 0 || nameIdx < 0) {
      return { ok: false, error: "未识别到「班级」「姓名」列，请检查表头（表头需在第一行）" };
    }
    const rows = [];
    const issues = [];
    dataRows.forEach((raw, ri) => {
      if (!raw || raw.every(c => c == null || String(c).trim() === "")) return;
      const m = rowToMember(fields, raw);
      const err = validateMember(m);
      if (err) { issues.push(`第${ri + 2}行：` + err); return; }
      rows.push(m);
    });
    return { ok: true, rows, issues };
  }

  function renderPreview(tableId, rows, fields, issueText) {
    const box = rows.length ? tableId : null;
    const statEl = tableId === "#excelPreviewTbl" ? $("excelStat") : $("wordStat");
    const actionBox = tableId === "#excelPreviewTbl" ? $("excelPreviewBox") : $("wordPreviewBox");
    statEl.innerHTML = issueText + (rows.length ? ` 共识别 <b>${rows.length}</b> 条有效档案` : "");
    const head = Object.keys(rows[0] || {});
    const tblHead = `<tr><th>#</th>${head.map(h => "<th>" + esc(h) + "</th>").join("")}</tr>`;
    const body = rows.slice(0, 8).map((r, i) => {
      const show = f => {
        const v = r[f];
        if (v == null || v === "") return '<span style="color:#ccc">—</span>';
        if (DATE_FIELDS.includes(f)) return esc(v);
        return esc(String(v));
      };
      return `<tr><td>${i + 1}</td>${head.map(h => "<td>" + show(h) + "</td>").join("")}</tr>`;
    }).join("");
    const table = document.querySelector(tableId);
    table.querySelector("thead").innerHTML = tblHead;
    table.querySelector("tbody").innerHTML = body + (rows.length > 8 ? `<tr><td colspan="${head.length + 1}" style="color:#999">… 其余 ${rows.length - 8} 条略（导入时会全量处理）</td></tr>` : "");
    actionBox.classList.remove("hidden");
  }

  // ---- Excel 导入 ----
  function bindExcelUpload() {
    const zone = $("excelZone"), fileEl = $("excelFile");
    zone.addEventListener("click", () => fileEl.click());
    fileEl.addEventListener("change", () => { if (fileEl.files[0]) handleExcel(fileEl.files[0]); });
    ["dragover", "drop"].forEach(ev => {
      zone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); });
    });
    zone.addEventListener("dragover", () => zone.classList.add("drag"));
    zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
    zone.addEventListener("drop", e => {
      zone.classList.remove("drag");
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleExcel(f);
    });

    async function handleExcel(file) {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { showErr("请选择 .xlsx / .xls / .csv 文件"); return; }
      showLoading(true);
      try {
        await LibLoader.ensureXlsx();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
        if (!grid.length || grid.length < 2) { showErr("表格内容为空"); return; }
        const dataRows = grid.slice(1);
        const res = buildRowsFromGrid(grid[0], dataRows);
        if (!res.ok) { showErr(res.error); return; }
        window.__pendingRows = { type: "excel", rows: res.rows, fileName: file.name };
        let issueText = res.issues.length ? `<span style="color:#c0392b">${res.issues.slice(0, 3).join("；")}${res.issues.length > 3 ? "…" : ""}</span><br>` : "";
        $("excelStat").innerHTML = "";
        renderPreview("#excelPreviewTbl", res.rows, null, issueText);
        $("excelPreviewBox").classList.remove("hidden");
      } catch (e) { showErr("解析失败：" + e.message); }
      finally { showLoading(false); }
    }
  }

  // ---- Word 导入（解析 docx 中的表格） ----
  function bindWordUpload() {
    const zone = $("wordZone"), fileEl = $("wordFile");
    zone.addEventListener("click", () => fileEl.click());
    fileEl.addEventListener("change", () => { if (fileEl.files[0]) handleWord(fileEl.files[0]); });
    ["dragover", "drop"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
    zone.addEventListener("dragover", () => zone.classList.add("drag"));
    zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
    zone.addEventListener("drop", e => {
      zone.classList.remove("drag");
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleWord(f);
    });

    async function handleWord(file) {
      if (!/\.docx$/i.test(file.name)) { showErr("请选择 .docx 文件"); return; }
      showLoading(true);
      try {
        await LibLoader.ensureMammoth();
        const buf = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        const doc = new DOMParser().parseFromString(result.value, "text/html");
        const tables = doc.querySelectorAll("table");
        if (!tables.length) {
          showErr("文档中未识别到表格。请使用含表头（班级、姓名等列名）的 Word 表格档案表");
          return;
        }
        const grid = [];
        for (const tbl of tables) {
          tbl.querySelectorAll("tr").forEach(tr => {
            const cells = Array.from(tr.querySelectorAll("td,th")).map(c => c.textContent.trim());
            grid.push(cells);
          });
        }
        if (grid.length < 2) { showErr("Word 表格内容为空"); return; }
        const dataRows = grid.slice(1);
        const res = buildRowsFromGrid(grid[0], dataRows);
        if (!res.ok) { showErr(res.error); return; }
        window.__pendingRows = { type: "word", rows: res.rows, fileName: file.name };
        let issueText = res.issues.length ? `<span style="color:#c0392b">${res.issues.slice(0, 3).join("；")}${res.issues.length > 3 ? "…" : ""}</span><br>` : "";
        $("wordStat").innerHTML = "";
        renderPreview("#wordPreviewTbl", res.rows, null, issueText);
        $("wordPreviewBox").classList.remove("hidden");
      } catch (e) { showErr("解析失败：" + e.message); }
      finally { showLoading(false); }
    }
  }

  // ---- 导入提交 ----
  async function commitRows(type) {
    const pending = window.__pendingRows;
    if (!pending || pending.type !== type) return;
    if (!confirm(`确认将 ${pending.rows.length} 条档案写入数据库？同班级同姓名同学号匹配唯一的将更新，无匹配将新增，匹配多条将跳过。`)) return;
    showLoading(true);
    try {
      const CHUNK = 100;
      const agg = { inserted: 0, updated: 0, skipped: 0, conflicts: [] };
      for (let i = 0; i < pending.rows.length; i += CHUNK) {
        const st = await PA.upsertMembers(pending.rows.slice(i, i + CHUNK));
        agg.inserted += st.inserted;
        agg.updated += st.updated;
        agg.skipped += st.skipped;
        agg.conflicts.push(...(st.conflicts || []));
      }
      await PA.logUpdate("upload_" + (type === "excel" ? "excel" : "word"), pending.fileName, { rows: pending.rows.length, inserted: agg.inserted, updated: agg.updated, skipped: agg.skipped });
      showLoading(false);
      let msg = `导入完成：新增 ${agg.inserted} 条，更新 ${agg.updated} 条，跳过 ${agg.skipped} 条`;
      if (agg.conflicts.length) {
        const shown = agg.conflicts.slice(0, 3).join("；");
        msg += `；匹配多条跳过 ${agg.conflicts.length} 条：${shown}${agg.conflicts.length > 3 ? "…" : ""}`;
      }
      toast(msg, 6000);
      // 清空预览与文件
      window.__pendingRows = null;
      const boxId = type === "excel" ? "excelPreviewBox" : "wordPreviewBox";
      $(boxId).classList.add("hidden");
      if (type === "excel") $("excelFile").value = ""; else $("wordFile").value = "";
      loadLogs(true);
      loadQiOptions();
      loadStats();
    } catch (e) {
      showLoading(false);
      showErr("导入失败：" + e.message);
    }
  }

  function bindCommit() {
    $("excelCommit").addEventListener("click", () => commitRows("excel"));
    $("excelCancel").addEventListener("click", () => { window.__pendingRows = null; $("excelPreviewBox").classList.add("hidden"); $("excelFile").value = ""; });
    $("wordCommit").addEventListener("click", () => commitRows("word"));
    $("wordCancel").addEventListener("click", () => { window.__pendingRows = null; $("wordPreviewBox").classList.add("hidden"); $("wordFile").value = ""; });
  }

  // ================================================================
  // 4. 操作日志（管理员）
  // ================================================================
  const ACTION_CN = { insert: "新增档案", update: "更新档案", upload_excel: "Excel导入", upload_word: "Word导入" };
  const LOG_PAGE = 20;
  let logOffset = 0;
  let logDone = false;
  const logRowHtml = l => {
    const detail = l.detail ? (typeof l.detail === "object" ? JSON.stringify(l.detail) : l.detail) : "";
    return `<div class="log-item">
      <span class="time">${esc((l.created_at || "").replace("T", " ").slice(0, 19))}</span>
      <span><b>${esc(l.operator)}</b><span class="act">${esc(ACTION_CN[l.action] || l.action)}</span>${esc(l.target || "")}${detail ? `<br><span style="color:#999;font-size:12px">${esc(detail)}</span>` : ""}</span>
    </div>`;
  };
  async function loadLogs(reset) {
    const box = $("logsList");
    const wrap = $("logMoreWrap");
    if (reset) { logOffset = 0; logDone = false; box.innerHTML = ""; if (wrap) wrap.classList.add("hidden"); }
    if (logDone) return;
    try {
      const logs = await PA.getLogs(LOG_PAGE, logOffset);
      if (!logs.length) {
        if (!box.children.length) box.innerHTML = `<div class="card" style="text-align:center;color:#999;">暂无操作日志</div>`;
        logDone = true; if (wrap) wrap.classList.add("hidden");
        return;
      }
      box.insertAdjacentHTML("beforeend", logs.map(logRowHtml).join(""));
      logOffset += logs.length;
      if (logs.length < LOG_PAGE) { logDone = true; if (wrap) wrap.classList.add("hidden"); }
      else if (wrap) wrap.classList.remove("hidden");
    } catch (e) {
      if (!box.children.length) box.innerHTML = `<div class="card" style="color:#c0392b">日志加载失败</div>`;
    }
  }

  // ---------- 初始化 ----------
  document.addEventListener("DOMContentLoaded", () => {
    bindSearch();
    bindBrowse();
    bindExport();
    bindExcelUpload();
    bindWordUpload();
    bindCommit();
    $("refreshLogs").addEventListener("click", () => loadLogs(true));
    const moreBtn = $("loadMoreLogs");
    if (moreBtn) moreBtn.addEventListener("click", () => loadLogs(false));
    bootstrap();
  });
})();
