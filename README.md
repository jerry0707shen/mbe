# MBE 刷题器：独立账号与私有云存储

网页地址：https://jerry0707shen.github.io/mbe/

前端继续托管于 GitHub Pages。新增的独立云功能使用 Supabase Auth、PostgreSQL 和私有 Storage bucket。空的 `cloud-config.js` 会显示“云同步尚未启用”，保留原有本机使用方式；仅上传代码不等于已开通云服务。

## 启用云服务

1. 在自己的 Supabase 免费组织中新建专用项目 `mbe`。使用密码生成器设置数据库密码并自行保存。无需把数据库密码放入网页。
2. 打开 SQL Editor，运行 [`backend/setup.sql`](backend/setup.sql)。它建立进度表、私有题库清单、合并函数、账号隔离策略和 `mbe-private` 私有 bucket。不应应用到已有同名业务表的其他项目。
3. 在 Authentication → URL Configuration 中，将 Site URL 和允许的 Redirect URL 设置为 `https://jerry0707shen.github.io/mbe/`。保持邮箱登录启用。邮箱确认、密码恢复使用该地址返回应用。
4. 从 Connect 面板取得项目 URL 和公开的 publishable key，写入 `cloud-config.js` 的 `url` 和 `publishableKey`。不要写入数据库密码、`sb_secret_...`、service-role key 或访问令牌。前端会拒绝私密密钥。
5. 提交配置后等待 Pages 发布，在“更多”注册或登录。注册邮件是否可送达还取决于项目的邮箱服务、收件人限制和发送额度；这需要在实际项目上验证。

公开配置是正常的；数据访问由用户登录令牌、数据库 RLS 和 Storage RLS 控制。相关依据：[Supabase 前端数据安全](https://supabase.com/docs/guides/database/secure-data)、[Storage 访问策略](https://supabase.com/docs/guides/storage/security/access-control)。

## 日常使用

- **首次迁入**：登录后点击“更多 → 导入本机旧数据”，明确将此浏览器原来未登录时的数据合并到账号。原始本机数据库继续保留；既有同科账号题库不会被迁入过程覆盖。旧 Claude 页面上的数据需先在旧页面导出进度备份，再在新网页导入，PDF 也需导入新网页。
- **进度同步**：做题记录、笔记、错题标记和未完成题组自动同步。在线时定期读取云端，切回网页或恢复网络时也会同步。每次作答按独立事件合并；笔记、标记和同一题组的状态按较新的更新时间处理。避免两台设备同时操作同一个未完成题组。
- **PDF 备份**：导入时可选“同时备份题库和 PDF 到此账号的私有云”。也可手动点击“备份本机题库到云端”。列表会分别显示“题库及 PDF”或“仅题库”，只有上传成功后才更新清单。单个 PDF 当前限制为 50 MiB。
- **换设备**：在同一网址登录同一账号，进度会同步；在“私有云题库”点击“下载到本机”，恢复题库和已备份 PDF。下载会核验 SHA-256，成功后以一个本机事务替换同科文件。
- **退出或换账号**：每个账号使用独立的本机数据库和云端空间。退出后回到原来的未登录本机空间，账号数据不会出现在其他账号里。退出不删除原本机数据。
- **JSON 备份**：包含进度、笔记和题组，不含题目或 PDF。请另保留原 PDF。浏览器可能清理本机存储，云端尚未同步成功的数据仍需要手动备份。

私有文件使用账号 UUID 目录和内容哈希文件名。对象上传后不可由普通客户端覆盖或删除；同一内容重复上传可复用。网页仓库不包含用户 PDF、题目或实际学习记录。删除本机题库不会删除云端文件。

## 文件与维护

- `index.html`：原有刷题、PDF 解析、统计与导出功能，增加独立云功能入口及真实存储提示。
- `cloud.js`：登录、账号隔离、进度同步和私有题库上传恢复。
- `cloud-config.js`：仅公开项目配置。
- `backend/setup.sql`：可重复执行的数据库初始化及访问策略。
- `vendor/supabase.js`：随网页发布的固定版本官方 SDK 2.118.0；来源、哈希和许可证见 `vendor/`，登录不依赖临时下载第三方 CDN 脚本。

改动前的原 HTML 可从 Git 历史中的提交 `feae370c2723c5682a9d62bba76be9962fe75b2a` 恢复，原 HTML 的 SHA-256 为 `875dbc56a8234fe461055ed930c7f5624976655e6535ae5773db49ace76d1451`。

验证使用真实 Chrome、官方 SDK 和模拟云端 HTTP，并在隔离的 PostgreSQL 17 上执行初始化、RLS 和并发合并测试。测试不使用用户题库或学习记录。这些验证不代替实际 Supabase 项目的注册邮件、跨设备网络和额度验收。

免费方案的限制以 [Supabase 当前说明](https://supabase.com/pricing) 为准；免费项目不活动后可能暂停，届时需要到后台恢复。代码和数据库结构均可迁移，云服务仍需用户自己的账号管理。
