# Lark Project Linker

一个浏览器插件，连接 GitLab/GitHub/Sentry 与飞书项目。自动将项目 ID（如 `#XX-xxx`）转换为可点击的飞书链接，支持智能类型识别（Story/Issue）和一键创建飞书工单。让你的 DevOps 工作流更高效！

[飞书参考资料](https://bytedance.larkoffice.com/wiki/XusFwYp2ZiqltkkSTaJc7eMdnYb)

## ✨ 主要功能

### GitLab/GitHub 集成
- 🔗 **自动转换链接**：将 GitLab/GitHub 中的 `#XX-xxx`、`#M-xxx`、`#F-xxx` 等格式自动转换为飞书链接
- 🎯 **智能类型识别**：根据 commit 类型前缀自动判断是 Issue 还是 Story
  - `fix:`、`bugfix:`、`hotfix:` → Issue
  - `feat:`、`chore:`、`refactor:` → Story
- 💡 **自定义 Tooltip**：显示 "Issue in Lark" 或 "Story in Lark"，替代原生的 tooltip
- 👤 **GitHub 用户 hovercard 补中文名**：可基于 GitHub 目录仓库 README 的 `GitHub / Name / Email` 映射，在 GitHub 原生 hovercard 名称区域补上中文名
- 🚀 **实时监听**：自动检测页面变化、标签切换、URL 变化
- ⚡ **性能优化**：防抖机制、智能缓存、避免重复处理
- 🔄 **类型统一**：确保同一 tid 的所有链接类型一致
- 🌐 **多平台支持**：同时支持 GitLab 和 GitHub

### Sentry 集成
- 🎫 **快速创建工单**：在 Sentry Issue 页面一键创建飞书 Issue
- 📝 **自动填充信息**：自动提取 Sentry Issue 标题、描述和 URL
- 🔗 **智能按钮定位**：自动在 Issue Tracking 区域添加"创建飞书 Issue"按钮

## 功能预览

### GitLab/GitHub 链接转换
<p align="center">
  <img src="./docs/preview-1.png" alt="GitLab MR 列表" width="48%" />
  <img src="./docs/preview-2.png" alt="GitHub Commits" width="48%" />
</p>

## 安装

### 商店安装

[Chrome 应用商店](https://chromewebstore.google.com/detail/lark-project-linker/kekfhompghbimkcldfjjdhmgnnfkmfbd?authuser=0&hl=zh-CN)

### 本地开发安装

#### 1. 克隆项目

```bash
git clone https://github.com/wangbax/lark-project-linker.git
cd lark-project-linker
```

#### 2. 安装依赖

要求：Node.js >= 18

```bash
# 使用 yarn（推荐）
yarn install

# 或使用 npm
npm install
```

#### 3. 构建项目

```bash
# 使用 yarn
yarn build

# 或使用 npm
npm run build
```

构建完成后，产物会生成在 `dist` 目录中。

#### 4. 在浏览器中加载扩展

##### Chrome/Edge 浏览器

1. 打开浏览器，访问扩展管理页面：
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`

2. 开启右上角的「开发者模式」

3. 点击「加载已解压的扩展程序」

<p align="center">
  <img src="./docs/install-1.png" alt="install" width="42%" />
  <img src="./docs/install-2.png" alt="install" width="42%" />
</p>

4. 选择项目的 `dist` 文件夹，扩展安装成功！

## 配置

安装完成后，点击扩展图标或在扩展管理页面点击「选项」进行配置

### GitLab/GitHub 配置
- **飞书命名空间**：你的飞书项目空间名称，支持多个，用逗号分隔（如：`pojq34,app1,app2`）
  - 插件会自动尝试每个命名空间，直到找到有效的那个
- **域名地址**：用于匹配激活插件（如：`gitlab.com,github.com`），支持多个域名，用逗号分隔
- **项目 ID 前缀**：项目中使用的项目 ID 前缀，多个用逗号分隔（如：`XX,M,F,XX`）
  - 支持大小写，如 `XX` 可匹配 `#XX-6616715346`
- **GitHub 用户映射目录**：可选，填写 GitHub 目录仓库地址（如：`https://github.com/[org]/org`）
  - 插件会读取 README 中 `GitHub / Name / Email` 表格，优先使用 `Name` 列，并在 GitHub 原生 hovercard 名称区域追加如 `([中文名])` 的显示
  - GitHub Issue/PR assignees 搜索框也支持输入映射表中的 `Name`、中文名拼音或邮箱前缀，并在候选结果中补充展示映射信息；通过映射追加的候选会复用 GitHub 原生选择与保存流程

### Sentry 配置（可选）
- **Sentry 域名地址**：你的 Sentry 域名（如：`sentry.com`），支持多个，用逗号分隔
- **Sentry Issue 创建地址**：后端 API 地址（如：`http://localhost:8080/api/feishu-sentry`）
  - 用于创建飞书工单、查询现有工单、获取字段选项

**注意**：
- `M-xxx` 会自动识别为 Story 类型
- `F-xxx` 会自动识别为 Issue 类型  
- 其他自定义前缀（如 `XX-xxx`）会根据上下文智能判断：
  - commit message 包含 `fix:`、`bugfix:`、`hotfix:` → Issue
  - commit message 包含 `feat:`、`chore:`、`refactor:` → Story
  - 后端会进一步验证并自动更正类型
- 多个飞书命名空间会按配置顺序依次尝试，并缓存有效的结果

## 使用场景

### GitLab/GitHub 使用

#### Merge Request/Pull Request 标题
```
fix: [AutoTest] Android 三方授权页面顶部无 title #XX-6581113659
                                              ↓
                                   自动识别为 Issue
```

#### Commit 列表
```
feat: 新增分享功能 #XX-123456789
                ↓
        自动识别为 Story
```

#### GitHub Commits 页面示例
```
feat: 修复 detekt 报错 # XX-6616715346
                     ↓
          点击项目 ID 跳转到飞书
          悬浮显示 Lark Tooltip
```

在 GitHub commits 页面（如 `https://github.com/XXXX/XXSDK-Monorepo/commits/branch-name/`）：
- 📍 commit 标题中的 `# XX-6616715346` 会被识别
- 🎯 点击项目 ID 部分直接跳转到飞书
- 💡 悬浮显示飞书项目信息
- 🔄 自动根据 commit 类型判断 Issue/Story
- 👤 配置 GitHub 用户映射目录后，hover 用户名时会在 GitHub 原生 hovercard 中显示中文名

**配置示例：**
- 域名地址：`github.com`
- 项目 ID 前缀：`XX,XX,M,F`（根据实际项目配置）

#### 页面自动刷新
- ✅ 切换到 Commits 标签 → 自动扫描新链接
- ✅ 切换到 Changes 标签 → 自动扫描新链接
- ✅ 浏览器前进/后退 → 自动扫描新链接
- ✅ GitHub Turbo 导航 → 自动扫描新链接

### Sentry 使用

#### 快速创建飞书工单

1. 打开任意 Sentry Issue 页面
2. 在 Issue Tracking 区域找到"Feishu Issue"按钮
3. 点击"+"按钮打开创建工单弹窗
4. 弹窗会自动填充：
   - **标题**：Sentry 异常信息（带 `[Sentry]` 前缀）
   - **描述**：包含异常堆栈、环境、版本等信息
   - **报告人**：当前登录的 Sentry 用户（可搜索修改）
   - **经办人**：可搜索 Sentry 成员
   - **动态字段**：优先级、严重程度等（根据后端配置）
5. 填写完毕后点击"创建"
6. 创建成功后页面会自动显示工单号（如 `XX-6663198368`），点击可跳转

#### 查看已创建的工单

如果 Sentry Issue 已关联飞书工单：
- 按钮会显示工单号（如 `XX-6663148821`）
- 点击工单号直接跳转到飞书工单详情
- "+"按钮会被隐藏，避免重复创建

## 开发说明

### 目录结构

```
├── dist/               # 构建产物
├── src/
│   ├── js/            # JavaScript 源码
│   │   ├── index.js           # 主入口，核心通用功能
│   │   ├── gitlab-handler.js  # GitLab 平台处理器
│   │   ├── github-handler.js  # GitHub 平台处理器
│   │   ├── background.js      # 后台脚本
│   │   ├── sentry.js          # Sentry 内容脚本
│   │   ├── options.js         # 配置页面
│   │   ├── store.js           # 配置存储与缓存管理
│   │   ├── utils.js           # 工具函数
│   │   └── event.js           # 事件常量
│   ├── html/          # HTML 页面
│   └── assets/        # 静态资源
├── gulpfile.js        # 构建配置
└── package.json
```

### 开发模式

```bash
# 监听文件变化并自动构建
npm run watch
```

修改代码后，需要在浏览器扩展管理页面点击「重新加载」按钮。

### 代码架构

项目采用模块化架构，平台特定逻辑独立管理：

```
┌─────────────────────────────────────────────┐
│              index.js (主入口)               │
│  - 初始化配置和缓存                          │
│  - 提供核心功能（Popover、链接生成等）      │
│  - 监听通用事件                              │
│  - 初始化平台处理器                          │
└────────────┬────────────────────────────────┘
             │ 使用
             ↓
┌────────────────────────┐
│     store.js           │
│  - 配置管理            │
│  - 缓存管理            │
└────────────────────────┘

             │ 创建处理器
     ┌───────┴────────┐
     ↓                ↓
┌──────────────┐  ┌──────────────┐
│gitlab-handler│  │github-handler│
│   GitLab     │  │   GitHub     │
│   平台处理   │  │   平台处理   │
└──────────────┘  └──────────────┘
```

### 添加新平台支持

添加新平台只需3步：

#### 1. 创建处理器文件
```javascript
// src/js/bitbucket-handler.js
export function createBitbucketHandler(context) {
  function init() {
    // 初始化逻辑
  }
  
  return { init };
}
```

#### 2. 导入处理器
```javascript
// src/js/index.js
import { createBitbucketHandler } from "./bitbucket-handler";
```

#### 3. 初始化处理器
```javascript
// src/js/index.js
const isBitbucket = window.location.host.includes('bitbucket');

if (isBitbucket) {
  platformHandler = createBitbucketHandler(context);
  platformHandler.init();
}
```

### 调试技巧

#### 查看缓存
```javascript
// 在浏览器控制台中
chrome.storage.local.get('LARK_PROJECT_TYPE_CACHE', (result) => {
  console.log(result);
});
```

#### 清除缓存
```javascript
// 在浏览器控制台中
chrome.storage.local.remove('LARK_PROJECT_TYPE_CACHE');
```

## 更新日志

详细版本记录已迁移到 [CHANGELOG.md](./CHANGELOG.md)。

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 许可证

MIT License
