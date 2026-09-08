# 党务档案管理系统（网页版）

基于 GitHub Pages + Supabase 的党务档案管理网页应用，支持双账号登录（管理员/查询员）、班级+姓名精确查询、列表筛选、Excel/Word 数据上传实时更新与操作日志审计。

## 架构

- 前端：纯静态 HTML/CSS/JS（无构建步骤），部署到 GitHub Pages
- 后端：Supabase（Postgres 数据库 + Auth + RLS 行级安全）
- 数据表：`profiles`（账号角色）、`members`（党务档案）、`update_logs`（操作日志）

## 目录结构

```
party-archive/
├── index.html          # 登录页
├── app.html            # 主应用页
├── css/style.css       # 红白党建风格样式
├── js/
│   ├── supabase-config.js  # Supabase URL / publishable key（可公开）
│   ├── api.js              # Supabase 数据访问封装
│   ├── loader.js           # 第三方库多源加载（本地→CDN兜底）
│   ├── login.js            # 登录页逻辑
│   └── app.js              # 主应用逻辑（查询/列表/导入/日志）
├── lib/
│   ├── sheetjs.full.min.js # Excel 解析（本地优先）
│   └── mammoth.browser.min.js # Word(.docx) 解析
├── schema.sql           # 数据库初始化脚本（已在 Supabase 执行）
└── .gitignore
```

## 登录账号（邮箱域 party.local，登录时只需填账号名）

| 账号 | 密码 | 角色 | 权限 |
|------|------|------|------|
| ZNZZXYXSDZBSJ | shixun2-204 | 管理员 | 查询 + 列表浏览 + 数据导入 + 日志 |
| ZNZZXYXSDZBDAB | shixun2-206 | 查询员 | 仅精确查询 |

## 功能说明

1. **精确查询**：输入班级与姓名查询档案（班级、姓名可二选一或同填）；单条命中自动展开完整详情，多条命中展示列表点击查看。
2. **列表浏览（管理员）**：按入党期数、发展阶段、班级关键词、姓名/学号关键字筛选，点击行查看完整档案。
3. **数据更新（管理员）**：
   - Excel：.xlsx/.xls/.csv，第一行为表头，自动识别中文字段名（班级、姓名、学号、性别、发展阶段、入党期数、各时间节点、备注等）
   - Word：.docx 含表格的档案表（表头需含"班级、姓名"等列名）
   - 解析后先预览再确认入库；按「班级+姓名+学号」唯一键 upsert，重复上传会更新不重复新增；入库前做各阶段时间线先后校验。
4. **操作日志（管理员）**：记录每次导入操作人、时间、目标与条数。

## Excel 表头字段映射（第一行中文表头）

| 中文表头（示例） | 数据库字段 |
|------|------|
| 班级 | class_name（必填） |
| 姓名 | name（必填） |
| 学号 / 身份证号 / 性别 / 民族 / 政治面貌 | student_id / id_card / gender / ethnicity / political_status |
| 入党期数 / 期数 | party_qi |
| 发展阶段 / 当前阶段 | current_stage（自动归一化） |
| 入党申请时间 / 谈话时间 / 推优时间 | apply_date / talk_date / recommend_date |
| 积极分子确定时间 / 发展对象确定时间 | activist_date / develop_date |
| 接收预备党员时间 / 转正时间 | probation_date / full_date |
| 入团年月 / 出生日期 | join_league_date / birth_date |
| 介绍人 / 状态 / 备注 | introducer / status_flag / remark |

日期支持 `2023-05-01`、`2023/5/1`、`2023年5月`、Excel 日期序列号等格式；无法识别的留空。

## 本地运行 / 部署

1. 任意静态服务器打开即可（本地双击 index.html 亦可，但建议起本地服务以加载第三方库 CDN 兜底）。示例：`npx serve .`
2. 部署 GitHub Pages：把本目录推送到仓库，Settings → Pages → 选择分支根目录。
3. 配置域名白名单：Supabase Dashboard → Authentication → URL Configuration，把 GitHub Pages 地址加入 Site URL / Redirect URLs（本地 localhost 需加入才能本地登录）。

## 安全说明

- 所有表已启用 RLS；查询员仅能查询 members，无法写入；管理员写入受服务端 `is_admin()` 二次校验。
- `supabase-config.js` 仅含 publishable key（设计上可公开）；服务端密钥（service_role）严禁放入前端。
- 请及时在 Supabase Auth 中修改默认登录密码，避免共享账号泄露。
