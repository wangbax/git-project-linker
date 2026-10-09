---
name: project-release-workflow
description: 项目发布工作流。当用户说“发布”“发版”“release”“打 tag”“创建 release”或要求发布当前仓库新版本时使用。负责检查未合并 PR，确认需要合并的 PR 并帮助合并，拉取最新 main，按仓库历史规范更新版本和 CHANGELOG，构建、打 tag 并创建 GitHub Release。
---

# 项目发布工作流

用于当前仓库发布版本。合并和发布都是实时远端操作：先验证，合并 PR 前先让用户确认，确认后再执行。

## 工作流

1. 检查发布状态：
   - 执行 `git fetch origin --prune --tags`。
   - 用 `git symbolic-ref refs/remotes/origin/HEAD` 检测默认分支；除非远端另有指向，否则默认按 `origin/main` 处理。
   - 查看最近发布规范：
     - `git tag --sort=-creatordate | head`
     - `gh release list --limit 10`
     - `git log --oneline --decorate -10`
     - `CHANGELOG.md`
     - `package.json`
     - `src/manifest.json`
     - `.github/workflows/release.yml`

2. 检查所有未合并 PR：
   - 用 `gh pr list --state open --limit 100` 列出 open PR。
   - 对每个 PR 检查标题、作者、分支、目标分支、review 状态、checks 和是否可合并。
   - 汇总哪些 PR 看起来可合并、被阻塞、过期或与本次发布无关。
   - 除非用户已经给出明确列表，否则必须让用户确认具体要合并哪些 PR。

3. 合并已确认 PR：
   - 每个 PR 合并前重新检查 checks、review 和 mergeability。
   - 跟随仓库历史合并方式。如果最近 `main` 上是 squash 风格且提交标题以 `(#PR)` 结尾，优先使用 `gh pr merge <number> --squash --delete-branch`。
   - 没有用户明确确认时，不要合并被阻塞的 PR。
   - 合并完成后执行 `git fetch origin --prune`。

4. 准备最新 `main`：
   - 切到 `main`。
   - 执行 `git pull --ff-only origin main`。
   - 确认本地 `main` 与 `origin/main` 一致。
   - 修改版本前确保工作区干净。

5. 确定下一个版本：
   - 读取最新 tag/release、当前 `package.json` 版本、`src/manifest.json` 版本和 `CHANGELOG.md` 顶部版本。
   - 除非合并 PR 明确需要 minor/major，或用户指定版本，否则默认 patch bump。
   - 保持版本文件同步。

6. 更新发布文件：
   - 更新 `package.json` 版本。
   - 如果存在 `src/manifest.json`，同步更新版本。
   - 按现有标题、emoji 和分类风格在 `CHANGELOG.md` 顶部新增版本记录。
   - 记录本次合并 PR 和用户可感知改动。

7. 验证和打包：
   - 执行 `corepack yarn build`。
   - 如果仓库维护 zip 产物，按历史方式重建，例如从 `dist` 打包。
   - 执行 `git diff --check`。

8. 提交、打 tag 并推送：
   - 按历史风格提交发布准备改动，例如 `chore: 🔖 发布 vX.Y.Z`。
   - 按历史方式创建 tag；本仓库使用 `vX.Y.Z`。
   - 将 `main` 和 tag 推送到 `origin`。

9. 创建 GitHub Release：
   - 使用 `gh release create vX.Y.Z` 创建 release。
   - 从 `gh release list` 参考历史 release 标题风格，例如 `✨ vX.Y.Z - ...` 或 `🐛 vX.Y.Z - ...`。
   - Release 正文必须包含本次发布涉及的合并 PR 列表；每条至少包含 PR 编号、PR 标题和 PR 作者的 `@login`，并链接到对应 PR。
   - 合并 PR 列表建议使用以下格式，便于回溯发布内容和贡献者：
     - `- [#123](https://github.com/owner/repo/pull/123) PR 标题 — @author`
   - 如果本次发布没有合并 PR，正文中明确写出“本次发布无新增 PR”。
   - 如果 `.github/workflows/release.yml` 会在 release 创建时上传产物，除非历史显示需要本地上传，否则让 workflow 自动附加构建产物。
   - 验证 release 已创建，并检查 release workflow 状态。

10. 最终回复：
   - 汇报已合并 PR、发布提交、tag、release URL 和验证结果。
   - 最终回复中的发布摘要也要列出本次发布涉及的 PR 和对应 `@author`。
   - 说明仍在运行或失败的 GitHub Actions。
