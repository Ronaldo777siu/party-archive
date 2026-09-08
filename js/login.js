// 登录页逻辑
(function () {
  const $ = id => document.getElementById(id);
  const usernameEl = $("username"), passwordEl = $("password");
  const errorEl = $("errorMsg"), btn = $("loginBtn");

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.add("show");
  }
  function clearError() { errorEl.classList.remove("show"); }

  async function doLogin() {
    const username = usernameEl.value.trim();
    const password = passwordEl.value;
    if (!username || !password) { showError("请输入账号和密码"); return; }
    clearError();
    btn.disabled = true; btn.textContent = "登录中...";
    try {
      const profile = await window.PA.login(username, password);
      localStorage.setItem("pa_last_user", profile.username);
      window.location.href = "app.html";
    } catch (e) {
      showError(e.message || "登录失败，请重试");
      btn.disabled = false; btn.textContent = "登 录";
    }
  }

  btn.addEventListener("click", doLogin);
  passwordEl.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  usernameEl.addEventListener("keydown", e => { if (e.key === "Enter") passwordEl.focus(); });

  // 记忆上次账号
  const last = localStorage.getItem("pa_last_user");
  if (last) usernameEl.value = last;
  usernameEl.focus();
})();
