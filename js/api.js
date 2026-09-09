// API 封装：登录、档案查询、列表筛选、写入、日志
(function () {
  const CFG = window.APP_CONFIG;
  let _client = null;
  let _profile = null;

  async function getClient() {
    if (_client) return _client;
    if (!window.supabase) {
      const sources = [
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
        "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/supabase-js/2.45.0/umd/supabase.min.js"
      ];
      let ok = false;
      for (const src of sources) {
        try {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = src; s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          });
          if (window.supabase) { ok = true; break; }
        } catch (e) { /* next */ }
      }
      if (!ok) throw new Error("supabase 客户端加载失败，请检查网络后刷新");
    }
    _client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    return _client;
  }

  async function login(username, password) {
    const client = await getClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: username + "@" + CFG.authDomain,
      password: password
    });
    if (error) throw new Error("账号或密码错误");
    await loadProfile();
    return _profile;
  }

  async function loadProfile() {
    const client = await getClient();
    const { data, error } = await client.rpc("get_my_profile");
    if (error) throw new Error("无法获取用户信息");
    _profile = data || null;
    return _profile;
  }

  async function currentProfile() {
    if (_profile) return _profile;
    const client = await getClient();
    const { data: sess } = await client.auth.getSession();
    if (!sess || !sess.session) return null;
    try { return await loadProfile(); } catch (e) { return null; }
  }

  function getProfile() { return _profile; }

  function isAdmin() { return !!(_profile && _profile.role === "admin"); }

  async function signOut() {
    const client = await getClient();
    await client.auth.signOut();
    _profile = null;
  }

  // 分页拉取全量（Supabase 单请求默认最多返回 1000 行，超量需循环 range）
  async function fetchAll(builder, pageSize = 1000) {
    const all = [];
    let from = 0;
    for (;;) {
      const { data, error } = await builder.range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return all;
  }

  // 精确查询：班级 + 姓名
  async function queryMembers(className, name) {
    const client = await getClient();
    let q = client.from("members").select("*");
    if (className) q = q.eq("class_name", className.trim());
    if (name) q = q.eq("name", name.trim());
    const { data, error } = await q.order("party_qi", { ascending: false }).limit(50);
    if (error) throw new Error("查询失败：" + error.message);
    return data || [];
  }

  // 列表浏览：期数/阶段/班级/关键字 筛选（分页全量）
  async function listMembers({ qi, stage, className, keyword } = {}) {
    const client = await getClient();
    let q = client.from("members").select("*");
    if (qi) q = q.eq("party_qi", qi);
    if (stage) q = q.eq("current_stage", stage);
    if (className) q = q.ilike("class_name", "%" + className + "%");
    if (keyword) q = q.or(`name.ilike.%${keyword}%,student_id.ilike.%${keyword}%`);
    q = q.order("party_qi", { ascending: true }).order("class_name");
    const data = await fetchAll(q);
    return data || [];
  }

  async function listDistinct(column) {
    const client = await getClient();
    const q = client.from("members").select(column);
    const data = await fetchAll(q);
    return [...new Set((data || []).map(r => r[column]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
  }

  // 轻量统计：仅拉取期数/阶段/状态三列
  async function fetchLightRows() {
    const client = await getClient();
    const q = client.from("members").select("party_qi,current_stage,status_flag");
    const data = await fetchAll(q);
    return data || [];
  }

  // 写入（先查后写，按班级+姓名+学号匹配）—— 管理员
  // 匹配规则：行 student_id 非空 -> 匹配 (class_name+name+student_id) 完全相等；
  //          行 student_id 为空 -> 匹配 (class_name+name 且库内 student_id 为空) 的记录。
  // 匹配唯一 -> update（按 id 单条更新该行全部字段）；匹配多条 -> 跳过并计入 conflicts（不改库）；
  // 无匹配 -> insert。返回 { inserted, updated, skipped, conflicts }，不抛错返回 error。
  async function upsertMembers(rows) {
    const stats = { inserted: 0, updated: 0, skipped: 0, conflicts: [] };
    if (!rows || !rows.length) return stats;
    const client = await getClient();

    // 拉取现有关键列（id/班级/姓名/学号）
    let existing = [];
    try {
      existing = await fetchAll(client.from("members").select("id,class_name,name,student_id"));
    } catch (e) {
      throw new Error("写入前读取档案失败：" + e.message);
    }
    const bucketKeyed = new Map(); // key: 班级|姓名|学号 -> [id...]
    const bucketNoSid = new Map(); // key: 班级|姓名 -> [id...]（库内学号为空）
    const pushMap = (map, k, id) => { if (!map.has(k)) map.set(k, []); map.get(k).push(id); };
    existing.forEach(r => {
      const c = String(r.class_name || "").trim();
      const n = String(r.name || "").trim();
      const sid = r.student_id == null ? "" : String(r.student_id).trim();
      if (!c || !n) return;
      if (sid) pushMap(bucketKeyed, c + "|" + n + "|" + sid, r.id);
      else pushMap(bucketNoSid, c + "|" + n, r.id);
    });

    // 用于批内去重：同一批中前面已写入的 key -> id（后续重复行直接更新该条）
    const addedId = new Map();
    const FIELDS = ["gender", "birth_date", "ethnicity", "political_status", "id_card", "join_league_date", "party_qi", "current_stage", "apply_date", "talk_date", "recommend_date", "activist_date", "develop_date", "probation_date", "full_date", "introducer", "status_flag", "remark"];

    for (const row of rows) {
      const c = String(row.class_name || "").trim();
      const n = String(row.name || "").trim();
      const sid = row.student_id == null ? "" : String(row.student_id).trim();
      if (!c || !n) { stats.skipped += 1; continue; }
      const label = c + " " + n + (sid ? "（" + sid + "）" : "");

      // 构造写入负载（按该行全字段更新）
      const payload = { class_name: c, name: n, student_id: sid || null };
      FIELDS.forEach(f => { payload[f] = row[f] == null ? null : row[f]; });

      const key = sid ? (c + "|" + n + "|" + sid) : (c + "|" + n);
      const bucket = sid ? bucketKeyed : bucketNoSid;
      let targetIds = addedId.has(key) ? [addedId.get(key)] : (bucket.get(key) || []);

      if (targetIds.length === 1) {
        const { error } = await client.from("members").update(payload).eq("id", targetIds[0]);
        if (error) {
          stats.skipped += 1;
          stats.conflicts.push(label + "（更新失败：" + error.message + "）");
          continue;
        }
        stats.updated += 1;
        addedId.set(key, targetIds[0]); // 后续同 key 行走批内更新，避免重复插入
      } else if (targetIds.length > 1) {
        stats.skipped += 1;
        stats.conflicts.push(label);
      } else {
        const ins = { ...payload };
        delete ins.id;
        const { data, error } = await client.from("members").insert(ins).select("id");
        if (error || !data || !data.length || !data[0].id) {
          stats.skipped += 1;
          stats.conflicts.push(label + (error ? "（写入失败：" + error.message + "）" : "（写入无返回）"));
          continue;
        }
        stats.inserted += 1;
        const nid = data[0].id;
        addedId.set(key, nid);
        pushMap(bucket, key, nid);
      }
    }
    return stats;
  }

  // 单条编辑（管理员）：按 id 更新；payload 仅含用户可编辑字段，空字符串统一转 null
  async function updateMember(id, payload) {
    const clean = {};
    Object.keys(payload || {}).forEach(k => {
      let v = payload[k];
      if (v == null || String(v).trim() === "") clean[k] = null;
      else clean[k] = v;
    });
    const client = await getClient();
    const { error } = await client.from("members").update(clean).eq("id", id);
    return { error };
  }

  async function logUpdate(action, target, detail) {
    const client = await getClient();
    const me = getProfile();
    await client.from("update_logs").insert({
      operator: me ? me.username : "unknown",
      action: action,
      target: target,
      detail: detail || null
    });
  }

  // 日志分页读取（时间倒序）
  async function getLogs(limit = 20, offset = 0) {
    const client = await getClient();
    const { data, error } = await client.from("update_logs")
      .select("*").order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw new Error("日志读取失败");
    return data || [];
  }

  window.PA = {
    login, signOut, currentProfile, loadProfile, getProfile, isAdmin,
    queryMembers, listMembers, listDistinct, fetchLightRows, upsertMembers, updateMember, logUpdate, getLogs
  };
})();
