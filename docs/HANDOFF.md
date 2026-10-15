# 上传 GitHub 与协作说明

目标仓库：`SilentGenesisLab/ad-database-v1.0`。本次产物是交接压缩包，未推送该仓库。

## 上传

先解压完整文件夹。同事应使用对该仓库有写入权限的账号，建议 Git 或 GitHub Desktop 导入完整目录。浏览器上传容易漏掉隐藏目录；务必确认 `runtime/.next`、`.gitignore`、`.github/workflows/verify.yml` 都在提交中。

仓库确实为空时，可以在解压目录执行：

```bash
git init
git branch -M main
git add .
git status --short
# 检查没有实际 .env、node_modules、业务数据和私密文件
git commit -m "Add website runtime, recovered historical source and database schema"
git remote add origin https://github.com/SilentGenesisLab/ad-database-v1.0.git
git push -u origin main
```

如果仓库已有提交，先 clone，再将包内文件复制进去（包括隐藏文件），检查 diff 后提交；不要强推或覆盖历史。

## 协作规则

- `runtime/.next` 是目前部署快照的主体，保留并跟踪；`recovered-source/.next` 是可重建文件，不提交。
- 三个 lockfile 与 package.json 同步更新，安装用 npm ci。
- 新数据库改动以迁移脚本管理；`schema.sql` 只用于独立空库基线。
- 需求或缺陷记录至少包含复现步骤、预期、实际、影响版本、脱敏日志。
- PR 写清修改的是历史源码还是当前运行快照，附构建和相关检查结果；禁止把两套版本混为一套最新源码。
- 不提交密码、令牌、真实 .env、SSH 信息、业务数据、素材和私人聊天。
- 上传后的 GitHub Actions 会构建历史源码并测试两个版本；运行权限受仓库策略控制。

## 本次变更

2026-10-15 最终交接包：再次核对现用服务器、刷新数据库结构，新增统一验证和演示入口及接手说明。

2026-10-14 v2：恢复历史源码及开发配置；导出 32 表结构；新增合成演示数据；生成三个 npm 锁文件；加入构建、核心读写检查与演示入口；移除 7 个确认无引用的运行备份文件；补充说明及截图。

## 许可

没有替权利人选择开源许可证。本包 `private: true` 仅为防止误发布到 npm，不是法律授权或 GitHub 可见性设置；仓库是否公开及使用授权由权利人确定。
