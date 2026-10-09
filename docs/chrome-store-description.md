# GitHub Linker Chrome 插件说明

GitHub Linker 是一个面向研发团队的浏览器插件，用来增强 GitHub 和 GitLab 的日常协作，并把代码页面中的人员、项目编号和问题单串起来。

## 为什么值得安装

- **找人更快**：在 GitHub 用户 hovercard、assignee 和 reviewer 选择器中补充团队目录里的中文名、拼音和邮箱前缀，减少只看到登录名却不知道对应成员的情况。
- **多个 Org 一起管理**：每个 GitHub Org 可以配置自己的用户目录仓库，插件会根据当前仓库地址自动识别 Org，不需要手动切换配置。
- **代码和项目保持关联**：开启可选的飞书项目关联后，Commit、Issue 和 PR 中的 `#XX-xxx`、`#M-xxx`、`#F-xxx` 等编号可以直接跳转到项目，并根据 `fix`、`feat` 等提交类型识别 Issue 或 Story。
- **故障处理更顺畅**：在 Sentry Issue 页面直接创建飞书工单，自动带入标题、描述和问题 URL，减少复制粘贴。
- **按需使用**：GitHub 用户映射和搜索增强无需配置飞书；飞书、GitLab 和 Sentry 能力都在“更多设置”中，需要时再开启。

## 安装后可以做什么

1. 在扩展选项中添加一个或多个 GitHub Org 的用户目录仓库地址。
2. 打开 GitHub 仓库、Issue 或 PR，直接查看成员中文名，并在 assignee/reviewer 搜索中使用中文名、拼音或邮箱前缀。
3. 如果团队使用飞书项目管理，在“更多设置”中开启飞书项目关联，让代码中的项目编号变成可点击链接。
4. 如果团队使用 Sentry，在 Issue 页面直接创建关联的飞书工单。

GitHub Linker 适合需要频繁在 GitHub、GitLab、Sentry 和项目管理工具之间切换的研发、测试、产品和项目管理团队。

项目主页：https://github.com/wangbax/git-project-linker

问题反馈：https://github.com/wangbax/git-project-linker/issues
