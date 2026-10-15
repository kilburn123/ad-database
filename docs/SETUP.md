# 运行、数据库与部署

## 环境

推荐先在根目录执行 `node tools/verify.mjs`，自动完成下面的安装、构建与核心检查。

本机实际验证环境：Node.js 24.19.0，npm 12.2.0，Next.js 14.2.35。建议同事先使用 Node.js 24。三个目录的依赖各自安装，不能只在顶层执行 npm install。

```bash
npm ci --prefix runtime
npm ci --prefix recovered-source
npm ci --prefix checks
DATABASE_URL=postgresql://demo:demo@127.0.0.1:1/demo npm --prefix recovered-source run build
npm --prefix checks test
npm --prefix checks run test:source
```

结果写入 `checks/runtime-smoke-results.json` 和 `checks/recovered-source-smoke-results.json`。源码测试要求先 build。检查只对独立临时数据库的合成记录进行修改及删除，不连接生产数据库。

## 演示

`npm --prefix checks run demo` 启动当前部署快照；`npm --prefix checks run demo:source` 启动已构建的历史源码。访问输出 URL，Ctrl+C 退出。每次都是新临时数据库，修改不保存到下次启动。演示视频未提供，因此视频播放和缩略图不能作为通过项。

## 原生 PostgreSQL 16 开发库

由数据库管理员预先创建一个专用空库和具备建表权限的账号，将连接串保存在本机环境变量 `DATABASE_URL`。使用 PostgreSQL 16.14 或支持 `\restrict` 的兼容新版 psql 客户端：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seed-demo.sql
```

第二步演示数据可选。`schema.sql` 是完整空库初始化快照，不是增量迁移脚本；不要对已有业务库重复执行。结构来源包括现有历史备份表的定义，但不包含其记录。导出使用 `--schema-only --no-owner --no-privileges`，账号、权限分配和扩展服务需要部署者自行配置。

此次已在 PGlite 验证导入和核心读写；未声称在另一台原生 PostgreSQL 16 上完成全流程复现。后续 schema 变更应新建带版本号迁移并先测试，不直接覆盖这个基线文件。

## 历史源码开发

```bash
cd recovered-source
cp .env.example .env.local
# 编辑 .env.local，填写独立开发库和本机目录
npm run dev
```

访问 `http://localhost:3000/tiktok-ad-assistant`。生产方式为 `npm run build` 后 `npm start`。这是早期功能版本，不能当作当前线上版本直接发布。

## 当前快照启动

```bash
cd runtime
npm ci --omit=dev
cp .env.example .env
# 编辑 .env 后启动
npm start
```

默认访问 `http://127.0.0.1:3000/tiktok-ad-assistant`。必须连同隐藏目录 `.next` 一起部署。反向代理转发时保留 `/tiktok-ad-assistant` 路径；basePath 已编译固定，修改环境变量不能重新构建它。推荐先部署在独立测试域名与数据库，通过验证后再按团队发布流程切换。

## 配置说明

| 配置 | 用途 |
| --- | --- |
| DATABASE_URL | PostgreSQL 连接串；不要提交真实值 |
| PORT / HOSTNAME | 监听端口和地址，快照默认本机 3000 |
| NEXT_PUBLIC_BASE_PATH | 模板中的路径前缀；构建配置固定 `/tiktok-ad-assistant` |
| TIKTOK_AD_DATA_DIR | 可写素材与任务目录，生产中配置持久目录 |
| OSS_BUCKET / OSS_ENDPOINT / OSS_PREFIX | OSS 桶、区域 endpoint、对象前缀 |
| OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET | OSS 凭据，经环境或团队密钥系统提供 |
| OSS_PUBLIC_BASE_URL / OSS_REQUIRE_UPLOAD | 素材访问域名与上传策略，需与桶权限对应 |
| ARK_API_KEY / DEEPSEEK_API_KEY | 当前快照对应模型服务凭据；演示无需填写 |
| DEEPSEEK_BASE_URL / DEEPSEEK_TEXT2SQL_MODEL | 数据助手模型接口与模型名，需运营方确认可用性 |
| WORKSTATION_GW / WORKSTATION_API_KEY | 外部工作站服务，完整能力还依赖相应服务实现 |
| DOUBAO_ANALYSIS_SCRIPT / DOUBAO_JOB_ROOT / DOUBAO_SITE_URL | 分析脚本、本机任务目录、网站地址 |
| FFMPEG_PATH | FFmpeg 可执行程序路径 |

Python 分析脚本依赖、模型接口、工作站、采集任务、OSS 授权尚未完整复现；不能将核心测试通过等同于所有功能已部署。

## 常见问题

- 缺少 DATABASE_URL：检查运行目录及 `.env`/`.env.local`，历史源码的 Next.js 会读取自身目录中的环境文件。
- relation does not exist：确认指向专用开发库并完成 schema 初始化。
- 页面或静态资源 404：确认 URL 有 `/tiktok-ad-assistant`，代理未删前缀，快照 `.next` 已完整复制。
- 演示视频不能播放：本包只提供两条合成元数据，无真实视频。
- OSS/AI/采集失败：核心演示未接这些服务，需要独立配置并测试；检查运行日志，不要把含密钥的日志提交仓库。
- `runtime` 没有 build 命令：它是编译快照；可构建源码在 `recovered-source`，功能版本较早。

## Python 脚本依赖核查

包内三个 Python 脚本的显式导入是标准库及同目录脚本，无需凭空补第三方 pip 依赖清单；仍需 Python 3、相关模型服务、网站接口及视频处理工具。已做 AST 语法检查，未执行真实分析或计费调用。

本次依赖安装存在旧依赖弃用提示，保留在 `verification-execution.log` 中；依赖升级和漏洞审计未作为本次交接完成项。
