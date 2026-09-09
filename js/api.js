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

  // 写入（upsert，按班级+姓名+学号匹配）—— 管理员
  async function upsertMembers(rows) {
    const client = await getClient();
    const { data, error } = await client.from("members").upsert(rows, {
      onConflict: "class_name,name,student_id",
      ignoreDuplicates: false
    });
    if (error) throw new Error("写入失败：" + error.message);
    return data;
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

  async function getLogs(limit = 100) {
    const client = await getClient();
    const { data, error } = await client.from("update_logs")
      .select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error("日志读取失败");
    return data || [];
  }

  window.PA = {
    login, signOut, currentProfile, loadProfile, getProfile, isAdmin,
    queryMembers, listMembers, listDistinct, upsertMembers, logUpdate, getLogs
  };
})();
