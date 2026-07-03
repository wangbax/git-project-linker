/**
 * GitHub 平台特定处理逻辑
 */

import {
  getLarkConfig,
  loadGitHubUserAliasCache,
  saveGitHubUserAliasCache
} from "./store";
import { pinyin as toPinyin } from "../../node_modules/pinyin-pro/dist/index.mjs";

export function createGitHubHandler(context) {
  const {
    nodeMap,
    tidTypeMap,
    getLarkProjectLink,
    fetchLarkProjectInfo,
    bindPopoverEvent,
    replaceLarkLinks,
    replaceProjectIdToLarkProjectLink,
    getLarkConfigSync,
    enterHandler,
    leaveHandler,
    removeGitLabTooltipAttributes,
    isGitHubPullRequestPage
  } = context;
  const githubUserAliasState = {
    sourceUrl: "",
    promise: null,
    refreshSourceUrl: "",
    refreshPromise: null,
    map: new Map(),
  };
  let githubUserHovercardObserver = null;
  let githubAssigneePickerObserver = null;
  let githubAssigneePickerScanTimer = null;
  const githubAssigneeFilterInputs = new WeakSet();
  const githubAssigneeAliasPickerEvents = new WeakSet();
  const githubAssigneeAliasPrefetchState = new WeakMap();
  const githubLegacyUserPickerMenus = new WeakSet();
  const githubLegacyUserPickerItemCache = new WeakMap();
  const githubLegacyUserPickerFilterTimers = new WeakMap();
  const githubLegacyAssigneeFallbackState = new WeakMap();
  const githubLegacyAssigneeFallbackActivationState = new WeakMap();
  const githubLegacyAssigneeFallbackContainers = new WeakSet();
  const githubLegacyAssigneeFallbackSaveBound = new WeakSet();
  const githubLegacyAssigneeFallbackFormSelections = new WeakMap();
  const githubAssigneeAliasSelectionState = new WeakMap();
  const githubAssigneeActorCache = new Map();
  const githubAssigneeAssignableContextCache = new Map();
  let githubFetchNonce = "";
  let githubContentScanTimer = null;
  const githubDebugCounters = new Map();
  const githubDebugEntries = [];
  let githubDebugFlushTimer = null;
  const MAX_GITHUB_TEXT_SCAN_LENGTH = 20000;
  const GITHUB_ASSIGNEE_FILTER_INPUT_SELECTOR = 'input[aria-label="Filter assignees"], input[placeholder="Filter assignees"]';
  const GITHUB_LEGACY_ASSIGNEE_FILTER_INPUT_SELECTOR = [
    'details-menu input#assignee-filter-field',
    'details-menu input#review-filter-field',
    'details-menu input.js-filterable-field',
    'details-menu input[type="text"][aria-label="Find a user"]',
    'details-menu input[type="text"][aria-label="Type or choose a user"]'
  ].join(', ');
  const GITHUB_ASSIGNEE_REPLACE_ACTORS_QUERY_ID = "5b6e41ee455f3851175cbb618af2aa29";
  const GITHUB_ASSIGNEE_REPLACE_ACTORS_QUERY_NAME = "replaceActorsForAssignableRelayMutation";
  const GITHUB_ASSIGNEE_ALIAS_MAP_MESSAGE_TYPE = "LARK_LINKER_GITHUB_ASSIGNEE_ALIAS_MAP";
  const GITHUB_ASSIGNEE_ALIAS_MAP_SCRIPT_ID = "lark-linker-github-assignee-alias-map";
  const GITHUB_LEGACY_ALIAS_MATCH_ATTRIBUTE = "data-lark-legacy-user-picker-alias-match";
  const GITHUB_LEGACY_ALIAS_HIDDEN_ATTRIBUTE = "data-lark-legacy-user-picker-alias-hidden";
  const GITHUB_LEGACY_ASSIGNEE_FALLBACK_ATTRIBUTE = "data-lark-legacy-assignee-fallback";
  const GITHUB_LEGACY_ASSIGNEE_FALLBACK_BOUND_ATTRIBUTE = "data-lark-legacy-assignee-fallback-bound";
  const GITHUB_LEGACY_ASSIGNEE_FALLBACK_DIRTY_ATTRIBUTE = "data-lark-legacy-assignee-fallback-dirty";
  const GITHUB_LEGACY_ASSIGNEE_FALLBACK_SAVE_INPUT_ATTRIBUTE = "data-lark-legacy-assignee-save-input";
  const GITHUB_LEGACY_ASSIGNEE_FALLBACK_SUBMITTING_ATTRIBUTE = "data-lark-legacy-assignee-submitting";
  const ignoredGitHubDynamicSelector = [
    '#partial-pull-merging',
    '.branch-action',
    '.merge-pr',
    '.merge-status-list',
    '.js-merge-box',
    '.js-checks-dropdown',
    '.js-checks-status-button',
    '[data-channel*="check"]',
    '[data-channel*="merge"]',
    'turbo-frame[src*="check"]',
    'turbo-frame[id*="check"]',
    '[id*="checks"]',
    '[class*="Checks"]',
    '[class*="checks"]'
  ].join(', ');

  /**
   * 初始化 GitHub 处理器
   */
  function init() {
    // 隐藏 GitHub 的默认 tooltip
    hideGitHubTooltips();

    // 初始化页面监听
    initPageListener();

    // 监听 GitHub 特定的导航事件
    setupNavigationListeners();

    // GitHub 用户别名只在 hovercard 或 assignees picker 出现时懒加载，避免拖慢 PR 首屏和 Checks 渲染。
    ensureGitHubHovercardObserver();
    ensureGitHubAssigneePickerObserver();
    ensureGitHubAssigneeFetchAliasMap();
  }

  function isGitHubDebugEnabled() {
    try {
      return window.localStorage?.getItem("LARK_LINKER_DEBUG") === "1" ||
        new URLSearchParams(window.location.search).has("lark_linker_debug");
    } catch (error) {
      return false;
    }
  }

  function scheduleGitHubDebugFlush() {
    if (githubDebugFlushTimer || typeof chrome === "undefined" || !chrome.storage?.local) return;

    githubDebugFlushTimer = setTimeout(() => {
      githubDebugFlushTimer = null;
      try {
        const result = chrome.storage.local.set({
          LARK_LINKER_DEBUG_LOGS: githubDebugEntries,
        });
        if (result?.catch) {
          result.catch(() => {});
        }
      } catch (error) {
        // Debug logging must never affect the page.
      }
    }, 500);
  }

  function debugGitHubLog(label, data = {}) {
    if (!isGitHubDebugEnabled()) return;

    const count = (githubDebugCounters.get(label) || 0) + 1;
    githubDebugCounters.set(label, count);
    console.debug("[Lark Linker][GitHub]", label, {
      count,
      url: window.location.href,
      ...data,
    });

    githubDebugEntries.push({
      at: new Date().toISOString(),
      label,
      count,
      url: window.location.href,
      ...data,
    });
    if (githubDebugEntries.length > 100) {
      githubDebugEntries.shift();
    }
    scheduleGitHubDebugFlush();
  }

  function measureGitHubDebug(label, callback) {
    if (!isGitHubDebugEnabled()) {
      return callback();
    }

    const startedAt = performance.now();
    const result = callback();
    debugGitHubLog(label, {
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
    return result;
  }

  function scanGitHubContent() {
    measureGitHubDebug("scanGitHubContent", () => {
      replaceGitHubCommits();
      replaceGitHubPullRequests({
        observeTitle: !isGitHubPullRequestPage,
      });
    });
  }

  function scheduleGitHubContentScan(delay = 100) {
    debugGitHubLog("scheduleGitHubContentScan", { delay });

    if (githubContentScanTimer) {
      clearTimeout(githubContentScanTimer);
    }

    githubContentScanTimer = setTimeout(() => {
      githubContentScanTimer = null;
      scanGitHubContent();
    }, delay);
  }

  /**
   * 隐藏 GitHub 的默认 tooltip
   */
  function hideGitHubTooltips() {
    const style = document.createElement("style");
    style.id = "hide-github-tooltips";
    style.innerHTML = `
      /* 隐藏 GitHub 的 tooltip */
      .lark-project-link[aria-label],
      .lark-project-link tool-tip {
        pointer-events: none;
      }
      .github-user-real-name {
        color: var(--fgColor-muted, #656d76);
        font-weight: 400;
        margin-left: 4px;
      }
      .github-assignee-alias {
        color: var(--fgColor-muted, #656d76);
        font-weight: 400;
      }
      .github-assignee-alias-result {
        cursor: pointer;
      }
      .github-assignee-alias-result[aria-selected="true"],
      .github-assignee-alias-result:hover {
        background: var(--control-transparent-bgColor-hover, #f6f8fa);
      }
      .github-assignee-alias-result[aria-busy="true"] {
        opacity: 0.65;
      }
      .github-assignee-alias-result[data-lark-assignee-error="true"] {
        color: var(--fgColor-danger, #cf222e);
      }
      .github-assignee-prefetched-native-result {
        display: none !important;
      }
      .js-issue-title .github-lark-id,
      .js-issue-title .lark-project-link,
      .markdown-title .github-lark-id,
      .markdown-title .lark-project-link,
      a.Link--primary .github-lark-id,
      a.Link--primary .lark-project-link,
      bdi[data-testid="issue-title"] .github-lark-id,
      bdi[data-testid="issue-title"] .lark-project-link,
      div[class*="Title-module__container"] .github-lark-id,
      div[class*="Title-module__container"] .lark-project-link {
        color: inherit;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 初始化 GitHub 页面监听
   */
  async function initPageListener() {
    const config = await getLarkConfig();
    if (!config) return;
  }

  /**
   * 设置 GitHub 导航监听
   */
  function setupNavigationListeners() {
    // GitHub 使用 turbo 进行页面导航
    document.addEventListener('turbo:load', () => {
      scheduleGitHubContentScan(500);
    });

    // 也监听 pjax（旧版 GitHub）
    document.addEventListener('pjax:end', () => {
      scheduleGitHubContentScan(500);
    });
  }

  /**
   * 替换 GitHub commits 列表中的项目 ID
   */
  function replaceGitHubCommits() {
    return measureGitHubDebug("replaceGitHubCommits", () => {
    // GitHub commits 页面 - commit 标题链接（支持 PR commits tab 的新版 commit row）
    const commitTitleLinks = document.querySelectorAll([
      'a[href*="/commit/"]',
      'a[href*="/commits/"]',
      'a[href*="/pull/"][href*="/changes/"]',
      'a.commit-row-message',
      '[data-testid="commit-row-item"] a.Link--primary',
      '[data-testid="commit-row-item"] a[class*="Commit"]',
      '[class*="CommitRow-module__ListItem"] a.Link--primary',
      '[class*="CommitRow-module__ListItem"] a[class*="Commit"]'
    ].join(', '));

    commitTitleLinks.forEach(link => {
      if (nodeMap.has(link)) return;
      if (isIgnoredGitHubDynamicNode(link)) return;

      // 跳过导航用的覆盖层链接（position-absolute 且没有实际文本内容）
      if (link.classList.contains('position-absolute') &&
          (link.textContent.trim() === '' || link.getAttribute('aria-label')?.includes('Link to'))) {
        return;
      }

      const text = link.textContent || "";
      const hasMatch = replaceTaskIdsInTextNodes(link, text, { allowAnchors: true });
      if (hasMatch) {
        nodeMap.add(link);
      }
    });

    // GitHub commits 页面 - commit 组
    const commitGroups = document.querySelectorAll([
      '.commit-group',
      '.commits-list-item',
      '.commit',
      '.commit-content',
      '[data-commit-link]',
      '[data-testid="commit-row-item"]',
      '[class*="CommitRow-module__ListItem"]'
    ].join(', '));

    commitGroups.forEach(group => {
      if (nodeMap.has(group)) return;
      if (isIgnoredGitHubDynamicNode(group)) return;

      // 在整个 commit 容器中查找链接
      let hasReplaced = replaceLarkLinks(group);

      // 如果没有找到链接，尝试旧方法处理纯文本（向后兼容）
      if (!hasReplaced) {
        const commitMessage = group.querySelector([
          '.commit-row-message',
          '.commit-row-description',
          '.commit-title',
          '.commit-message',
          '[class*="CommitMessage"]',
          '[class*="CommitRow-module__Message"]',
          '[class*="CommitRow-module__Title"]'
        ].join(', '));
        if (commitMessage) {
          hasReplaced = replaceTaskIdsInTextNodes(
            commitMessage,
            commitMessage.textContent || group.textContent || "",
            { allowAnchors: commitMessage.tagName === 'A' }
          );
        }
      }

      if (hasReplaced) {
        nodeMap.add(group);
      }
    });

    // GitHub commit 详情页 - commit message 容器（新版 UI，使用 CSS Modules）
    const commitMessageContainers = document.querySelectorAll('[class*="commitMessageContainer"], [class*="CommitHeader"], .commit-desc');

    commitMessageContainers.forEach(container => {
      if (nodeMap.has(container)) return;
      if (isIgnoredGitHubDynamicNode(container)) return;

      const LarkConfig = getLarkConfigSync();
      if (!LarkConfig) return;

      const prefixes = LarkConfig?.prefixes || "m,f";
      const prefixList = prefixes.split(",").map(p => p.trim().toLowerCase()).filter(p => p);

      // 查找所有可能包含 commit message 的元素
      const messageElements = container.querySelectorAll('div, span, p');

      messageElements.forEach(element => {
        if (nodeMap.has(element)) return;
        if (isIgnoredGitHubDynamicNode(element)) return;

        // 跳过已经处理过的元素和链接
        if (element.tagName === 'A' ||
            element.closest('.github-lark-id, .lark-project-link') ||
            element.closest('a.lark-project-link') ||
            element.querySelector('.lark-project-link')) {
          return;
        }

        const text = element.textContent;
        if (!text) return;

        // 检查是否包含项目 ID
        const reg = new RegExp(`#(${prefixList.join("|")})-\\d{7,}`, "i");
        if (!reg.test(text)) return;

        // 只处理直接包含文本的叶子节点（没有其他元素子节点）
        const hasElementChildren = Array.from(element.children).some(
          child => child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR'
        );

        if (hasElementChildren) return;

        const result = replaceProjectIdToLarkProjectLink(element);
        if (result[0]) {
          element.innerHTML = result[1];
          // 为所有创建的链接绑定事件
          const links = element.querySelectorAll(".lark-project-link");
          links.forEach(link => {
            bindPopoverEvent(link);
          });
          nodeMap.add(element);
        }
      });

      nodeMap.add(container);
    });
    });
  }

  /**
   * 替换 GitHub Pull Request / Issue 标题、描述和评论中的项目 ID
   */
  function replaceGitHubPullRequests(options = {}) {
    const {
      includeTitles = true,
      includeComments = true,
      observeTitle = true,
    } = options;

    return measureGitHubDebug("replaceGitHubPullRequests", () => {
    // PR/Issue 标题（支持多种选择器）
    const prTitleSelectors = [
      '.js-issue-title',                          // Conversation 标签页
      '.markdown-title',                          // Commits/Files changed 标签页 & Issue 详情页
      'bdi.js-issue-title',                       // 某些版本的 GitHub
      'div[class*="Title-module__container"]',    // Issue 列表标题
      'bdi[data-testid="issue-title"]',          // Issue 详情页标题
      'a.Link--primary[href*="/pull/"]',         // PR 列表页标题链接
      'a.Link--primary[href*="/issues/"]'        // Issue 列表页标题链接
    ];
    if (includeTitles) {
      prTitleSelectors.forEach(selector => {
        const prTitles = document.querySelectorAll(selector);

        prTitles.forEach(prTitle => {
          if (isIgnoredGitHubDynamicNode(prTitle)) {
            return;
          }

          // GitHub 新版 commit history 也复用了 Title-module 容器，避免误按 PR/Issue 标题处理
          if (isCommitRowElement(prTitle)) {
            return;
          }

          // 检查是否是 PR/Issue 列表中的导航链接
          if (prTitle.tagName === 'A') {
            const isNavigationLink =
              prTitle.classList.contains('js-navigation-open') ||
              prTitle.classList.contains('Link--primary') ||
              prTitle.id?.startsWith('issue_') ||
              prTitle.closest('.js-issue-row') !== null ||
              prTitle.closest('[data-hovercard-type="pull_request"]') !== null ||
              prTitle.closest('[data-hovercard-type="issue"]') !== null ||
              (prTitle.href && (prTitle.href.includes('/pull/') || prTitle.href.includes('/issues/')));

            // 如果是导航链接，检查是否需要重新处理
            if (isNavigationLink) {
              const needsReprocessing =
                prTitle.href.includes('project.feishu.cn') || // href 被错误修改为飞书链接
                prTitle.classList.contains('lark-project-link'); // 被错误地添加了类

              if (needsReprocessing && nodeMap.has(prTitle)) {
                nodeMap.delete(prTitle);
                // 清理错误的类和属性
                if (prTitle.classList.contains('lark-project-link')) {
                  prTitle.classList.remove('lark-project-link');
                }
                // 清理可能存在的 data 属性
                prTitle.removeAttribute('data-tid');
                prTitle.removeAttribute('data-lark-type');
                prTitle.removeAttribute('data-lark-url');
              }
            }
          }

          if (nodeMap.has(prTitle)) {
            return;
          }

          // 检查是否是 PR/Issue 列表中的导航链接
          if (prTitle.tagName === 'A') {
            const isNavigationLink =
              prTitle.classList.contains('js-navigation-open') ||
              prTitle.classList.contains('Link--primary') ||
              prTitle.id?.startsWith('issue_') ||
              prTitle.closest('.js-issue-row') !== null ||
              prTitle.closest('[data-hovercard-type="pull_request"]') !== null ||
              prTitle.closest('[data-hovercard-type="issue"]') !== null ||
              (prTitle.href && (prTitle.href.includes('/pull/') || prTitle.href.includes('/issues/')));

            if (isNavigationLink) {
              // 特殊处理：保留原始 PR 链接，在后面追加独立的飞书链接
              handleNavigationLink(prTitle, { observeHref: observeTitle });
              return;
            }
          }

          // 非导航链接的正常处理（包括 div、bdi 等非链接元素）
          handleNormalElement(prTitle, { observeReact: observeTitle });
        });
      });
    }

    // PR/Issue 评论和描述
    if (!includeComments) {
      return;
    }

    const comments = document.querySelectorAll('.comment-body, .markdown-body');
    comments.forEach(comment => {
      if (nodeMap.has(comment)) return;
      if (isIgnoredGitHubDynamicNode(comment)) return;

      const processedAncestor = comment.parentElement?.closest('.comment-body, .markdown-body');
      if (processedAncestor && nodeMap.has(processedAncestor)) return;

      // 跳过编辑态的 markdown（在 textarea 或 contenteditable 容器中）
      const isEditing =
        comment.closest('textarea') !== null ||
        comment.closest('[contenteditable="true"]') !== null ||
        comment.closest('.js-write-bucket') !== null ||
        comment.closest('.is-comment-editing') !== null;

      if (isEditing) {
        return;
      }

      const commentText = comment.textContent || "";

      // 首先尝试处理已有的链接
      const hasReplacedLinks = replaceLarkLinks(comment);

      // 再处理纯文本中的项目 ID（针对 .markdown-body）
      const hasReplacedText = shouldScanGitHubTextContainer(comment, commentText)
        ? handleMarkdownBody(comment, commentText)
        : false;

      if (hasReplacedLinks || hasReplacedText) {
        nodeMap.add(comment);
      }
    });
    });
  }

  function isCommitRowElement(element) {
    return Boolean(
      element.closest(
        '[data-testid="commit-row-item"], [data-commit-link], [class*="CommitRow-module__ListItem"], .commits-list-item, .commit-group'
      )
    );
  }

  function isIgnoredGitHubDynamicNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    return node.matches(ignoredGitHubDynamicSelector) || Boolean(node.closest(ignoredGitHubDynamicSelector));
  }

  function getGitHubPrefixConfig() {
    const LarkConfig = getLarkConfigSync();
    if (!LarkConfig) {
      return { LarkConfig: null, prefixList: [] };
    }

    let prefixList = LarkConfig.prefixes;
    if (typeof prefixList === 'string') {
      prefixList = prefixList.split(',').map(p => p.trim()).filter(p => p);
    }

    return {
      LarkConfig,
      prefixList: (prefixList || []).map(prefix => prefix.toLowerCase())
    };
  }

  function inferTidType(tid, contextText = '') {
    let type = tidTypeMap.get(tid);
    if (type) {
      return type;
    }

    const prefix = tid.split('-')[0].toLowerCase();
    const lowerContext = contextText.toLowerCase();

    type = 'story';
    if (prefix === 'f') {
      type = 'issue';
    } else if (prefix !== 'm') {
      if (/^(fix|bugfix|hotfix|bug)[\s:]/i.test(lowerContext)) {
        type = 'issue';
      } else if (/^(feat|feature|chore|refactor|perf|style|test|docs|build|ci)[\s:]/i.test(lowerContext)) {
        type = 'story';
      }
    }

    tidTypeMap.set(tid, type);
    return type;
  }

  function bindGitHubLarkSpan(span) {
    span.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const tid = span.dataset.tid;
      const projectId = tid.split('-')[1];
      const larkType = tidTypeMap.get(tid) || span.dataset.larkType;
      const url = getLarkProjectLink(projectId, larkType);
      window.open(url, '_blank');
    });

    span.addEventListener('mouseenter', enterHandler);
    span.addEventListener('mouseleave', leaveHandler);
  }

  function createGitHubLarkSpan(tid, type, url) {
    const span = document.createElement('span');
    span.className = 'github-lark-id';
    span.dataset.tid = tid;
    span.dataset.larkType = type;
    span.dataset.larkUrl = url;
    span.style.cursor = 'pointer';
    span.style.fontWeight = '500';
    span.style.textDecoration = 'none';
    span.textContent = `#${tid}`;
    bindGitHubLarkSpan(span);
    return span;
  }

  function replaceTaskIdsInTextNodes(root, contextText, options = {}) {
    const { allowAnchors = false } = options;
    const { LarkConfig, prefixList } = getGitHubPrefixConfig();
    if (!LarkConfig || prefixList.length === 0) {
      return false;
    }

    const reg = new RegExp(`#\\s*(${prefixList.join("|")})-\\d{7,}`, "gi");
    if (!reg.test(contextText || "")) {
      reg.lastIndex = 0;
      return false;
    }
    reg.lastIndex = 0;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.parentElement) {
            return NodeFilter.FILTER_REJECT;
          }

          if (!node.textContent || !reg.test(node.textContent)) {
            reg.lastIndex = 0;
            return NodeFilter.FILTER_REJECT;
          }

          reg.lastIndex = 0;

          const skippedSelector = allowAnchors
            ? 'button, input, select, textarea, [role="button"], .github-lark-id, .lark-project-link, [contenteditable="true"], script, style'
            : 'a, button, input, select, textarea, [role="button"], .github-lark-id, .lark-project-link, [contenteditable="true"], script, style';

          if (node.parentElement.closest(skippedSelector)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    let hasReplaced = false;

    textNodes.forEach(textNode => {
      const text = textNode.textContent || '';
      const matches = Array.from(text.matchAll(reg));
      reg.lastIndex = 0;

      if (matches.length === 0 || !textNode.parentNode) {
        return;
      }

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      matches.forEach(match => {
        const startIndex = match.index ?? 0;
        if (startIndex > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, startIndex)));
        }

        const tid = match[0].replace(/^#\s*/, '');
        const projectId = tid.split('-')[1];
        const type = inferTidType(tid, contextText);
        const url = getLarkProjectLink(projectId, type);

        fragment.appendChild(createGitHubLarkSpan(tid, type, url));

        fetchLarkProjectInfo({
          tid,
          app: LarkConfig.app,
        });

        lastIndex = startIndex + match[0].length;
        hasReplaced = true;
      });

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      textNode.parentNode.replaceChild(fragment, textNode);
    });

    return hasReplaced;
  }

  /**
   * 处理导航链接
   */
  function handleNavigationLink(prTitle, options = {}) {
    const { observeHref = true } = options;
    const originalText = prTitle.textContent;
    const LarkConfig = getLarkConfigSync();
    if (!LarkConfig) return;

    // 确保 prefixList 是数组
    let prefixList = LarkConfig.prefixes;
    if (typeof prefixList === 'string') {
      prefixList = prefixList.split(',').map(p => p.trim()).filter(p => p);
    }

    if (!prefixList || prefixList.length === 0) return;

    const reg = new RegExp(`#\\s*(${prefixList.join("|")})-\\d{7,}`, "gi");
    const matches = originalText.match(reg);

    if (matches && matches.length > 0) {
      // 保存原始的 href（从 DOM 恢复或使用当前值）
      let originalGithubHref = prTitle.href;

      // 如果 href 已被修改为飞书链接，从覆盖层链接恢复
      if (originalGithubHref.includes('project.feishu.cn')) {
        const issueRow = prTitle.closest('.js-issue-row');
        if (issueRow) {
          const overlayLink = issueRow.querySelector('a.position-absolute[href*="/pull/"], a.position-absolute[href*="/issues/"]');
          if (overlayLink) {
            originalGithubHref = overlayLink.href;
          }
        }
      }

      // 清理导航链接上可能存在的错误属性
      prTitle.removeAttribute('data-tid');
      prTitle.removeAttribute('data-lark-type');
      prTitle.removeAttribute('data-lark-url');
      prTitle.removeAttribute('target');  // 移除 target="_blank"

      // 使用 innerHTML 在文本中插入飞书链接，保持原始链接的所有属性和行为
      let newHTML = originalText;

      // 为每个匹配的项目 ID 创建替换
      matches.forEach(match => {
        const tid = match.replace(/^#\s*/, '');
        const projectId = tid.split("-")[1];
        const cachedType = tidTypeMap.get(tid);
        let larkType = cachedType || 'story';
        let larkUrl = `https://project.feishu.cn/${LarkConfig.app}/${larkType}/detail/${projectId}`;

        // 创建内嵌飞书链接（使用 span 模拟链接，避免 a 嵌套问题）
        const larkSpan = `<span class="github-lark-id" data-tid="${tid}" data-lark-type="${larkType}" data-lark-url="${larkUrl}" style="cursor: pointer; font-weight: 500; text-decoration: none;">#${tid}</span>`;

        // 替换文本中的项目 ID
        newHTML = newHTML.replace(match, larkSpan);

        // 触发后台验证
        fetchLarkProjectInfo({
          app: LarkConfig.app,
          tid: tid
        });
      });

      // 更新 innerHTML
      prTitle.innerHTML = newHTML;

      // 强制恢复原始的 href（防止被其他代码修改）
      prTitle.href = originalGithubHref;
      prTitle.removeAttribute('target');  // 确保不是新窗口打开

      // 为所有 span.github-lark-id 绑定点击事件
      const larkSpans = prTitle.querySelectorAll('.github-lark-id');
      larkSpans.forEach(span => {
        // 点击事件：阻止冒泡，打开飞书链接
        span.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const tid = span.dataset.tid;
          const larkType = tidTypeMap.get(tid) || span.dataset.larkType;
          const larkUrl = span.dataset.larkUrl;
          window.open(larkUrl, '_blank');
        });

        // hover 事件：显示 tooltip（使用已有的 enterHandler 和 leaveHandler）
        span.addEventListener('mouseenter', enterHandler);
        span.addEventListener('mouseleave', leaveHandler);
      });

      if (observeHref) {
        // 使用 MutationObserver 监控 href 变化，防止被其他代码修改
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'href') {
              const currentHref = prTitle.href;
              if (currentHref.includes('project.feishu.cn')) {
                prTitle.href = originalGithubHref;
                prTitle.removeAttribute('target');
              }
            }
          });
        });

        observer.observe(prTitle, {
          attributes: true,
          attributeFilter: ['href', 'target']
        });
      }

      nodeMap.add(prTitle);
    } else {
      nodeMap.add(prTitle);
    }
  }

  /**
   * 处理普通元素（非导航链接）
   */
  function handleNormalElement(prTitle, options = {}) {
    const { observeReact = true } = options;
    let hasReplaced = false;

    // 对于非 <a> 标签，使用内联 span 方式替换项目 ID
    if (prTitle.tagName !== 'A') {
      const originalText = prTitle.textContent || '';
      hasReplaced = replaceTaskIdsInTextNodes(prTitle, originalText);

      if (hasReplaced && observeReact) {
        // 使用 MutationObserver 监控 React 元素的重新渲染
        setupReactObserver(prTitle, () => replaceTaskIdsInTextNodes(prTitle, prTitle.textContent || originalText));
      }
    } else {
      // 对于 <a> 标签，使用原有逻辑
      hasReplaced = replaceLarkLinks(prTitle);

      if (!hasReplaced) {
        const result = replaceProjectIdToLarkProjectLink(prTitle);
        if (result[0]) {
          prTitle.innerHTML = result[1];
          // 为所有创建的链接绑定事件（可能有多个项目 ID）
          const links = prTitle.querySelectorAll(".lark-project-link");
          links.forEach(link => {
            bindPopoverEvent(link);
          });
          hasReplaced = true;
        }
      }
    }

    if (hasReplaced) {
      nodeMap.add(prTitle);
    }
  }

  /**
   * 设置 React 元素观察器
   */
  function setupReactObserver(prTitle, reapplyHandler) {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          // 检查是否还有我们的 span 元素
          const currentSpans = prTitle.querySelectorAll('.github-lark-id');
          if (currentSpans.length === 0 && prTitle.textContent.includes('#')) {
            // 元素被 React 重置了，重新应用修改

            // 临时断开观察，避免无限循环
            observer.disconnect();

            reapplyHandler();

            // 重新连接观察
            observer.observe(prTitle, {
              childList: true,
              characterData: true,
              subtree: true
            });
          }
        }
      }
    });

    // 开始观察
    observer.observe(prTitle, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  /**
   * 处理 markdown body 中的项目 ID
   */
  function handleMarkdownBody(comment, commentText) {
    return replaceTaskIdsInTextNodes(comment, commentText || "");
  }

  function shouldScanGitHubTextContainer(element, text) {
    if (!element) return false;

    if (element.closest('.blob-wrapper, .blob-code, .file, .js-file, .js-diff-progressive-container')) {
      return false;
    }

    return (text || "").length <= MAX_GITHUB_TEXT_SCAN_LENGTH;
  }

  function normalizeGitHubDirectoryUrl(rawUrl) {
    if (!rawUrl) return "";

    try {
      const url = new URL(rawUrl.trim());
      if (url.hostname !== "github.com") return "";

      const pathSegments = url.pathname.split("/").filter(Boolean);
      if (pathSegments.length < 2) return "";

      return `${url.origin}/${pathSegments[0]}/${pathSegments[1]}`;
    } catch (error) {
      return "";
    }
  }

  function normalizeTableHeader(text) {
    return text.replace(/\s+/g, "").trim().toLowerCase();
  }

  function extractGitHubLoginFromLink(link) {
    if (!link) return "";

    const href = link.getAttribute("href") || "";
    const rawText = (link.textContent || "").trim();
    const textLogin = rawText.replace(/^@/, "").trim();

    try {
      const url = new URL(href, window.location.origin);
      if (url.hostname !== "github.com") {
        return textLogin;
      }

      const pathSegments = url.pathname.split("/").filter(Boolean);
      if (pathSegments.length === 1) {
        return pathSegments[0];
      }
    } catch (error) {
      return textLogin;
    }

    return textLogin;
  }

  function extractEmailPrefix(text) {
    const emailMatch = text.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
    if (!emailMatch) return "";

    return emailMatch[1].split("@")[0];
  }

  function buildGitHubUserDisplayName(userInfo) {
    if (!userInfo) return "";

    return (userInfo.name || userInfo.emailPrefix || "").trim();
  }

  function normalizeGitHubAliasSearchText(text) {
    if (!text) return "";

    let value = String(text).trim().replace(/^@/, "").trim();
    const emailPrefix = extractEmailPrefix(value);
    if (emailPrefix) {
      value = emailPrefix;
    } else if (value.includes("@")) {
      value = value.split("@")[0];
    }

    return value.trim().toLowerCase();
  }

  function getGitHubNamePinyinCandidates(text) {
    const value = String(text || "").trim();
    if (!value || !/[\u3400-\u9fff]/.test(value)) return [];

    try {
      const syllables = toPinyin(value, {
        mode: "surname",
        nonZh: "removed",
        surname: "head",
        toneType: "none",
        type: "array",
      }).map(normalizeGitHubAliasSearchText).filter(Boolean);
      if (syllables.length === 0) return [];

      const full = syllables.join("");
      const initials = syllables.map(syllable => syllable[0]).join("");
      return Array.from(new Set([full, initials].filter(Boolean)));
    } catch (error) {
      return [];
    }
  }

  function getGitHubAssigneeAliasCandidateTexts(login, userInfo, includeLogin = true) {
    return [
      ...(includeLogin ? [login] : []),
      userInfo?.name,
      ...getGitHubNamePinyinCandidates(userInfo?.name),
      userInfo?.emailPrefix,
    ].map(normalizeGitHubAliasSearchText).filter(Boolean);
  }

  function getGitHubUserInfoByLogin(login) {
    const normalizedLogin = normalizeGitHubAliasSearchText(login);
    if (!normalizedLogin) return null;

    const directUserInfo = githubUserAliasState.map.get(login);
    if (directUserInfo) return directUserInfo;

    for (const [entryLogin, userInfo] of githubUserAliasState.map.entries()) {
      if (normalizeGitHubAliasSearchText(entryLogin) === normalizedLogin) {
        return userInfo;
      }
    }

    return null;
  }

  function resolveGitHubAssigneeLogin(value) {
    const normalizedValue = normalizeGitHubAliasSearchText(value);
    if (!normalizedValue) return "";

    let partialAliasLogin = "";
    let partialAliasCount = 0;
    for (const [login, userInfo] of githubUserAliasState.map.entries()) {
      const candidates = getGitHubAssigneeAliasCandidateTexts(login, userInfo, true);

      if (candidates.includes(normalizedValue)) {
        return login;
      }

      const aliasCandidates = getGitHubAssigneeAliasCandidateTexts(login, userInfo, false);
      if (aliasCandidates.some(candidate => candidate.includes(normalizedValue))) {
        partialAliasLogin = login;
        partialAliasCount += 1;
      }
    }

    if (partialAliasCount === 1) {
      return partialAliasLogin;
    }

    return String(value || "").trim().replace(/^@/, "");
  }

  function serializeGitHubUserAliasMap(aliasMap = githubUserAliasState.map) {
    return Array.from(aliasMap.entries()).map(([login, userInfo]) => [
      login,
      {
        name: userInfo?.name || "",
        emailPrefix: userInfo?.emailPrefix || "",
        pinyinCandidates: getGitHubNamePinyinCandidates(userInfo?.name),
      },
    ]);
  }

  function updateGitHubAssigneeAliasMapScript(entries) {
    try {
      let script = document.getElementById(GITHUB_ASSIGNEE_ALIAS_MAP_SCRIPT_ID);
      if (!script) {
        script = document.createElement("script");
        script.id = GITHUB_ASSIGNEE_ALIAS_MAP_SCRIPT_ID;
        script.type = "application/json";
        script.setAttribute("data-lark-linker", "github-assignee-alias-map");
        (document.head || document.documentElement).appendChild(script);
      }

      script.textContent = JSON.stringify(entries);
    } catch (error) {
      // DOM bridge is best-effort; postMessage below is the other delivery path.
    }
  }

  function syncGitHubAssigneeFetchAliasMap(aliasMap = githubUserAliasState.map) {
    const entries = serializeGitHubUserAliasMap(aliasMap);
    updateGitHubAssigneeAliasMapScript(entries);

    try {
      window.postMessage({
        type: GITHUB_ASSIGNEE_ALIAS_MAP_MESSAGE_TYPE,
        entries,
      }, window.location.origin);
    } catch (error) {
      // Main-world fetch patch is best-effort only.
    }
  }

  function ensureGitHubAssigneeFetchAliasMap() {
    if (!getGitHubIssuePageInfo()) {
      syncGitHubAssigneeFetchAliasMap();
      return;
    }

    ensureGitHubUserAliasMap().then(syncGitHubAssigneeFetchAliasMap);
  }

  function buildGitHubAssigneeAliasDisplayText(userInfo) {
    if (!userInfo) return "";

    return (userInfo.name || userInfo.emailPrefix || "").trim();
  }

  function findGitHubAssigneeAliasMatches(query) {
    const normalizedQuery = normalizeGitHubAliasSearchText(query);
    if (!normalizedQuery || normalizedQuery.length < 2) return [];

    const matches = [];
    githubUserAliasState.map.forEach((userInfo, login) => {
      const candidates = getGitHubAssigneeAliasCandidateTexts(login, userInfo, false);

      const normalizedLogin = normalizeGitHubAliasSearchText(login);
      if (normalizedLogin === normalizedQuery) {
        return;
      }

      if (candidates.some(candidate => candidate.includes(normalizedQuery))) {
        matches.push({ login, userInfo });
      }
    });

    const seenLogins = new Set();
    return matches
      .filter(match => {
        const normalizedLogin = normalizeGitHubAliasSearchText(match.login);
        if (!normalizedLogin || seenLogins.has(normalizedLogin)) return false;

        seenLogins.add(normalizedLogin);
        return true;
      })
      .slice(0, 5);
  }

  function safeParseJSON(text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }

  function getGitHubIssuePageInfo() {
    const pathSegments = window.location.pathname.split("/").filter(Boolean);
    if (pathSegments.length < 4) return null;

    const [owner, repo, type, numberText] = pathSegments;
    if (type !== "issues" && type !== "pull") return null;

    const number = Number.parseInt(numberText, 10);
    if (!owner || !repo || !Number.isFinite(number)) return null;

    return { owner, repo, type, number };
  }

  function walkGitHubData(value, visitor, seen = new WeakSet()) {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;

    seen.add(value);
    visitor(value);

    if (Array.isArray(value)) {
      value.forEach(item => walkGitHubData(item, visitor, seen));
      return;
    }

    Object.values(value).forEach(item => walkGitHubData(item, visitor, seen));
  }

  function getGitHubEmbeddedData(root = document) {
    const scripts = new Set();
    root.querySelectorAll([
      'script[type="application/json"]',
      'script[data-target*="embeddedData"]',
      'script[data-target*="embedded-data"]',
    ].join(", ")).forEach(script => {
      scripts.add(script);
    });

    return Array.from(scripts)
      .map(script => safeParseJSON(script.textContent || ""))
      .filter(Boolean);
  }

  function getGitHubActorField(actor, fieldNames) {
    if (!actor || typeof actor !== "object") return "";

    for (const fieldName of fieldNames) {
      const value = actor[fieldName];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    return "";
  }

  function normalizeGitHubAssigneeActor(rawActor, fallbackLogin = "") {
    if (!rawActor || typeof rawActor !== "object") return null;

    const login = getGitHubActorField(rawActor, ["login", "userLogin", "username"]) || fallbackLogin;
    const normalizedLogin = normalizeGitHubAliasSearchText(login);
    if (!normalizedLogin) return null;

    const id = getGitHubActorField(rawActor, ["id", "nodeId", "node_id"]);
    const name = getGitHubActorField(rawActor, ["name", "displayName"]);
    const avatarUrl = getGitHubActorField(rawActor, ["avatarUrl", "avatar_url"]);
    const profileResourcePath = getGitHubActorField(rawActor, ["profileResourcePath", "profileUrl"]);

    return {
      __typename: rawActor.__typename || "User",
      id,
      login,
      name,
      avatarUrl: avatarUrl || `https://github.com/${encodeURIComponent(login)}.png?size=40`,
      profileResourcePath: profileResourcePath || `/${login}`,
    };
  }

  function cacheGitHubAssigneeActor(actor) {
    if (!actor?.id || !actor?.login) return null;

    const normalizedLogin = normalizeGitHubAliasSearchText(actor.login);
    if (!normalizedLogin) return null;

    const cachedActor = {
      __typename: actor.__typename || "User",
      id: actor.id,
      login: actor.login,
      name: actor.name || null,
      avatarUrl: actor.avatarUrl || `https://github.com/${encodeURIComponent(actor.login)}.png?size=40`,
      profileResourcePath: actor.profileResourcePath || `/${actor.login}`,
    };
    githubAssigneeActorCache.set(normalizedLogin, cachedActor);
    return cachedActor;
  }

  function getCachedGitHubAssigneeActor(login) {
    const normalizedLogin = normalizeGitHubAliasSearchText(login);
    return normalizedLogin ? githubAssigneeActorCache.get(normalizedLogin) || null : null;
  }

  function extractGitHubAssigneeActorsFromConnection(connection) {
    if (!connection || typeof connection !== "object") return [];

    const nodes = Array.isArray(connection.nodes)
      ? connection.nodes
      : Array.isArray(connection.edges)
        ? connection.edges.map(edge => edge?.node).filter(Boolean)
        : [];

    return nodes
      .map(node => normalizeGitHubAssigneeActor(node))
      .filter(actor => actor?.id && actor?.login)
      .map(cacheGitHubAssigneeActor)
      .filter(Boolean);
  }

  function getGitHubAssigneeConnection(assignable) {
    return assignable?.assignedActors || assignable?.assignees || null;
  }

  function getGitHubAssignableTypeScore(typeName, pageInfo) {
    if (
      (pageInfo.type === "pull" && typeName === "PullRequest") ||
      (pageInfo.type === "issues" && typeName === "Issue")
    ) {
      return 3;
    }

    if (typeName === "Issue" || typeName === "PullRequest") {
      return 1;
    }

    return 0;
  }

  function getGitHubAssignableContextCacheKey(pageInfo) {
    if (!pageInfo) return "";

    return `${pageInfo.owner}/${pageInfo.repo}/${pageInfo.type}/${pageInfo.number}`;
  }

  function getGitHubAssignableObjectScore(value, pageInfo) {
    if (!value || typeof value !== "object") return -1;
    if (!value.id || Number(value.number) !== pageInfo.number) return -1;

    const repository = value.repository || {};
    const ownerLogin = repository.owner?.login || "";
    const repoName = repository.name || "";
    const repoMatches =
      !repoName ||
      (
        repoName.toLowerCase() === pageInfo.repo.toLowerCase() &&
        (!ownerLogin || ownerLogin.toLowerCase() === pageInfo.owner.toLowerCase())
      );
    if (!repoMatches) return -1;

    const typeName = value.__typename || value.__isIssueOrPullRequest || value.__isNode || "";
    const typeScore = getGitHubAssignableTypeScore(typeName, pageInfo);
    const hasAssignees = getGitHubAssigneeConnection(value) ? 3 : 0;
    const repoScore = ownerLogin && repoName ? 2 : 0;
    const permissionScore = value.viewerCanAssign || value.viewerCanUpdateMetadata ? 1 : 0;

    return typeScore + hasAssignees + repoScore + permissionScore;
  }

  function buildGitHubAssignableContextFromObject(pageInfo, assignable) {
    return {
      ...pageInfo,
      issueId: assignable?.id || "",
      assignedActors: extractGitHubAssigneeActorsFromConnection(getGitHubAssigneeConnection(assignable)),
    };
  }

  function cacheGitHubAssignableContext(context) {
    const cacheKey = getGitHubAssignableContextCacheKey(context);
    if (cacheKey && context?.issueId) {
      githubAssigneeAssignableContextCache.set(cacheKey, context);
    }

    return context;
  }

  function getGitHubEmbeddedTextParts(root = document) {
    return Array.from(root.querySelectorAll([
      'script[type="application/json"]',
      'script[data-target*="embeddedData"]',
      'script[data-target*="embedded-data"]',
    ].join(", ")))
      .map(script => script.textContent || "")
      .filter(Boolean);
  }

  function extractGitHubAssignableIdFromText(text, pageInfo) {
    if (!text) return "";

    const numberTokens = [
      `"number":${pageInfo.number}`,
      `"number": ${pageInfo.number}`,
    ];
    for (const token of numberTokens) {
      let index = text.indexOf(token);
      while (index !== -1) {
        const before = text.slice(Math.max(0, index - 1200), index);
        const after = text.slice(index, Math.min(text.length, index + 12000));
        const windowText = `${before}${after}`;
        const typeMatches =
          windowText.includes('"__typename":"Issue"') ||
          windowText.includes('"__typename":"PullRequest"') ||
          windowText.includes('"__isIssueOrPullRequest":"Issue"') ||
          windowText.includes('"__isIssueOrPullRequest":"PullRequest"');
        const repoMatches =
          windowText.includes(`"name":"${pageInfo.repo}"`) ||
          windowText.includes(`"nameWithOwner":"${pageInfo.owner}/${pageInfo.repo}"`) ||
          windowText.includes(`"owner":{"__typename"`);

        if (typeMatches || repoMatches) {
          const idMatches = Array.from(before.matchAll(/"id":"([^"]+)"/g));
          const id = idMatches[idMatches.length - 1]?.[1] || "";
          if (id) return id;
        }

        index = text.indexOf(token, index + token.length);
      }
    }

    return "";
  }

  function getGitHubAssignableContextFromText(pageInfo, root = document) {
    for (const text of getGitHubEmbeddedTextParts(root)) {
      const issueId = extractGitHubAssignableIdFromText(text, pageInfo);
      if (issueId) {
        return cacheGitHubAssignableContext({
          ...pageInfo,
          issueId,
          assignedActors: [],
        });
      }
    }

    return null;
  }

  function findGitHubAssignableContextInData(pageInfo, embeddedData) {
    const candidates = [];
    embeddedData.forEach(data => {
      walkGitHubData(data, value => {
        const score = getGitHubAssignableObjectScore(value, pageInfo);
        if (score < 0) return;
        candidates.push({
          assignable: value,
          score,
        });
      });
    });

    candidates.sort((a, b) => b.score - a.score);
    const assignable = candidates[0]?.assignable;
    return assignable
      ? cacheGitHubAssignableContext(buildGitHubAssignableContextFromObject(pageInfo, assignable))
      : null;
  }

  function getGitHubAssignableContext() {
    const pageInfo = getGitHubIssuePageInfo();
    if (!pageInfo) return null;

    const cacheKey = getGitHubAssignableContextCacheKey(pageInfo);
    const cachedContext = githubAssigneeAssignableContextCache.get(cacheKey);
    if (cachedContext?.issueId) return cachedContext;

    return findGitHubAssignableContextInData(pageInfo, getGitHubEmbeddedData()) ||
      getGitHubAssignableContextFromText(pageInfo) ||
      {
        ...pageInfo,
        issueId: "",
        assignedActors: [],
      };
  }

  async function fetchGitHubAssignableContext() {
    const pageInfo = getGitHubIssuePageInfo();
    if (!pageInfo) return null;

    const cacheKey = getGitHubAssignableContextCacheKey(pageInfo);
    const cachedContext = githubAssigneeAssignableContextCache.get(cacheKey);
    if (cachedContext?.issueId) return cachedContext;

    const response = await fetch(window.location.href, {
      credentials: "include",
      headers: {
        ...getGitHubGraphQLHeaders(),
        accept: "text/html",
      },
    });
    updateGitHubFetchNonce(response);
    if (!response.ok) return null;

    const htmlText = await response.text();
    const doc = new DOMParser().parseFromString(htmlText, "text/html");
    return findGitHubAssignableContextInData(pageInfo, getGitHubEmbeddedData(doc)) ||
      getGitHubAssignableContextFromText(pageInfo, doc);
  }

  function buildGitHubAssigneeIssueKey(context) {
    if (!context) return "";

    return [
      context.owner,
      context.repo,
      context.type,
      context.number,
      context.issueId,
    ].join("/");
  }

  function createGitHubAssigneeActorMap(actors) {
    const actorMap = new Map();
    (actors || []).forEach(actor => {
      const cachedActor = cacheGitHubAssigneeActor(actor);
      const normalizedLogin = normalizeGitHubAliasSearchText(cachedActor?.login);
      if (normalizedLogin) {
        actorMap.set(normalizedLogin, cachedActor);
      }
    });

    return actorMap;
  }

  function parseGitHubUserAliasMap(htmlText) {
    const aliasMap = new Map();
    const doc = new DOMParser().parseFromString(htmlText, "text/html");
    const tables = Array.from(doc.querySelectorAll(".markdown-body table"));

    tables.forEach(table => {
      const headerCells = Array.from(table.querySelectorAll("tr:first-child th"));
      if (headerCells.length === 0) return;

      const headers = headerCells.map(cell => normalizeTableHeader(cell.textContent || ""));
      const githubIndex = headers.indexOf("github");
      const nameIndex = headers.indexOf("name");
      const emailIndex = headers.indexOf("email");

      if (githubIndex === -1 || emailIndex === -1) return;

      const rows = Array.from(table.querySelectorAll("tr")).slice(1);
      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length <= Math.max(githubIndex, emailIndex, nameIndex)) return;

        const githubLink = cells[githubIndex].querySelector("a[href]");
        const login = extractGitHubLoginFromLink(githubLink || cells[githubIndex]);
        const name = nameIndex >= 0 ? (cells[nameIndex].textContent || "").trim() : "";
        const emailPrefix = extractEmailPrefix(cells[emailIndex].textContent || "");

        if (login && (name || emailPrefix)) {
          aliasMap.set(login, {
            name,
            emailPrefix,
          });
        }
      });
    });

    return aliasMap;
  }

  async function ensureGitHubUserAliasMap() {
    const LarkConfig = getLarkConfigSync();
    const sourceUrl = normalizeGitHubDirectoryUrl(LarkConfig?.githubUserDirectoryUrl);

    if (!sourceUrl) {
      githubUserAliasState.sourceUrl = "";
      githubUserAliasState.promise = null;
      githubUserAliasState.refreshSourceUrl = "";
      githubUserAliasState.refreshPromise = null;
      githubUserAliasState.map = new Map();
      syncGitHubAssigneeFetchAliasMap(githubUserAliasState.map);
      return githubUserAliasState.map;
    }

    if (githubUserAliasState.promise && githubUserAliasState.sourceUrl === sourceUrl) {
      return githubUserAliasState.promise;
    }

    githubUserAliasState.sourceUrl = sourceUrl;
    githubUserAliasState.promise = loadGitHubUserAliasCache(sourceUrl, { allowExpired: true })
      .then(cachedMap => {
        if (cachedMap) {
          githubUserAliasState.map = cachedMap;
          syncGitHubAssigneeFetchAliasMap(cachedMap);
          refreshGitHubUserAliasMap(sourceUrl);
          return cachedMap;
        }

        return fetchAndCacheGitHubUserAliasMap(sourceUrl);
      })
      .catch(async error => {
        console.error("[GitHub Handler] 加载 GitHub 用户映射失败:", error);
        githubUserAliasState.map = new Map();
        return githubUserAliasState.map;
      });

    return githubUserAliasState.promise;
  }

  async function fetchAndCacheGitHubUserAliasMap(sourceUrl) {
    const response = await fetch(sourceUrl, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`GitHub user directory request failed: ${response.status}`);
    }

    const htmlText = await response.text();
    const aliasMap = parseGitHubUserAliasMap(htmlText);
    githubUserAliasState.map = aliasMap;
    syncGitHubAssigneeFetchAliasMap(aliasMap);
    await saveGitHubUserAliasCache(sourceUrl, aliasMap);
    return aliasMap;
  }

  function refreshGitHubUserAliasMap(sourceUrl) {
    if (githubUserAliasState.refreshPromise && githubUserAliasState.refreshSourceUrl === sourceUrl) {
      return githubUserAliasState.refreshPromise;
    }

    githubUserAliasState.refreshSourceUrl = sourceUrl;
    githubUserAliasState.refreshPromise = fetchAndCacheGitHubUserAliasMap(sourceUrl)
      .then(aliasMap => {
        collectGitHubHovercardContainers(document.body).forEach(enhanceGitHubHovercard);
        scanGitHubAssigneePickers(document.body);
        return aliasMap;
      })
      .catch(error => {
        console.error("[GitHub Handler] 刷新 GitHub 用户映射缓存失败:", error);
        return githubUserAliasState.map;
      });

    return githubUserAliasState.refreshPromise;
  }

  function extractLoginFromHovercard(container) {
    if (!container) return "";

    const hydroNode = container.querySelector("[data-hydro-view]");
    const hydroPayload = hydroNode?.getAttribute("data-hydro-view");
    if (hydroPayload) {
      try {
        const parsed = JSON.parse(hydroPayload);
        const loginFromPayload = parsed?.payload?.card_user_login;
        if (loginFromPayload) {
          return loginFromPayload;
        }
      } catch (error) {
        // ignore malformed payloads and fall through to DOM-based extraction
      }
    }

    const loginLink = container.querySelector('section[aria-label="User login and name"] a[href]');
    if (loginLink) {
      return extractGitHubLoginFromLink(loginLink);
    }

    return "";
  }

  function appendDisplayNameToHovercard(container, displayName) {
    if (!container || !displayName) return false;

    const nameSection = container.querySelector('section[aria-label="User login and name"]');
    if (!nameSection) return false;

    const loginLink = nameSection.querySelector('a[href]');
    if (!loginLink) return false;

    const displayNameTarget = nameSection.querySelector(".Truncate") || loginLink;
    const displayNameText = `(${displayName})`;
    const existing = nameSection.querySelector(".github-user-real-name");
    if (existing) {
      const isAlreadyPlaced = existing.previousElementSibling === displayNameTarget;
      if (existing.textContent !== displayNameText) {
        existing.textContent = displayNameText;
      }
      if (!isAlreadyPlaced) {
        displayNameTarget.insertAdjacentElement("afterend", existing);
      }
      return true;
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "github-user-real-name";
    nameSpan.textContent = displayNameText;
    displayNameTarget.insertAdjacentElement("afterend", nameSpan);

    return true;
  }

  function collectGitHubHovercardContainers(root = document.body) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return [];

    const containerSet = new Set();
    if (root.matches?.(".Popover-message")) {
      containerSet.add(root);
    }

    const ancestorPopover = root.closest?.(".Popover-message");
    if (ancestorPopover) {
      containerSet.add(ancestorPopover);
    }

    root.querySelectorAll(".Popover-message").forEach(container => {
      containerSet.add(container);
    });

    return Array.from(containerSet);
  }

  function getGitHubHovercardContainerFromAddedNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
    if (node.classList?.contains("github-user-real-name")) return null;

    if (node.matches?.(".Popover-message")) {
      return node;
    }

    return node.closest?.(".Popover-message") || null;
  }

  function enhanceGitHubHovercard(container) {
    if (!container) return;

    const login = extractLoginFromHovercard(container);
    if (!login) return;

    const userInfo = getGitHubUserInfoByLogin(login);
    const displayName = buildGitHubUserDisplayName(userInfo);
    if (!displayName) return;

    appendDisplayNameToHovercard(container, displayName);
  }

  function isGitHubAssigneeFilterInput(element) {
    return Boolean(
      element?.matches?.(GITHUB_ASSIGNEE_FILTER_INPUT_SELECTOR) ||
      isGitHubLegacyAssigneeFilterInput(element)
    );
  }

  function getGitHubLegacyAssigneeMenu(element) {
    const menu = element?.closest?.("details-menu.select-menu-modal, details-menu.js-discussion-sidebar-menu");
    return isGitHubLegacyAssigneeMenu(menu) ? menu : null;
  }

  function getGitHubLegacyUserPickerMenuType(menu) {
    if (!menu) return false;

    const title = (menu.querySelector(".select-menu-title")?.textContent || "").toLowerCase();
    const filterSources = Array.from(menu.querySelectorAll("[data-filterable-src]"))
      .map(element => (element.getAttribute("data-filterable-src") || "").toLowerCase());
    const inputIds = Array.from(menu.querySelectorAll("input.js-filterable-field"))
      .map(input => (input.id || "").toLowerCase());
    const inputNames = Array.from(menu.querySelectorAll('input[type="checkbox"][name]'))
      .map(input => (input.name || "").toLowerCase());

    const hasReviewerEvidence =
      title.includes("reviewer") ||
      title.includes("review request") ||
      filterSources.some(source => source.includes("review-requests")) ||
      inputIds.some(id => id.includes("review-filter")) ||
      inputNames.some(name => name.includes("reviewer_user_ids") || name.includes("reviewer"));

    if (hasReviewerEvidence) {
      return "reviewer";
    }

    const hasAssigneeEvidence =
      title.includes("assign up to") ||
      title.includes("assignee") ||
      title.includes("assignees") ||
      filterSources.some(source => source.includes("assignees_menu_content") || source.includes("/assignees")) ||
      inputIds.some(id => id.includes("assignee-filter")) ||
      inputNames.some(name => name.includes("user_assignee_ids") || name.includes("assignee"));

    return hasAssigneeEvidence ? "assignee" : "";
  }

  function isGitHubLegacyAssigneeMenu(menu) {
    return Boolean(getGitHubLegacyUserPickerMenuType(menu));
  }

  function isGitHubLegacyReviewerMenu(menu) {
    return getGitHubLegacyUserPickerMenuType(menu) === "reviewer";
  }

  function isGitHubLegacyIssueAssigneeMenu(menu) {
    return getGitHubLegacyUserPickerMenuType(menu) === "assignee";
  }

  function isGitHubLegacyAssigneeFilterInput(element) {
    return Boolean(
      element?.matches?.(GITHUB_LEGACY_ASSIGNEE_FILTER_INPUT_SELECTOR) &&
      getGitHubLegacyAssigneeMenu(element)
    );
  }

  function collectGitHubAssigneeFilterInputs(root = document.body) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return [];

    const inputs = new Set();
    if (isGitHubAssigneeFilterInput(root)) {
      inputs.add(root);
    }

    root.querySelectorAll?.(GITHUB_ASSIGNEE_FILTER_INPUT_SELECTOR).forEach(input => {
      inputs.add(input);
    });
    root.querySelectorAll?.(GITHUB_LEGACY_ASSIGNEE_FILTER_INPUT_SELECTOR).forEach(input => {
      if (isGitHubLegacyAssigneeFilterInput(input)) {
        inputs.add(input);
      }
    });

    return Array.from(inputs);
  }

  function isInsideGitHubAssigneePicker(element) {
    const picker = element.closest?.('[data-testid="filtered-action-list"]');
    return Boolean(picker?.querySelector?.(GITHUB_ASSIGNEE_FILTER_INPUT_SELECTOR));
  }

  function collectGitHubAssigneePickerItems(root = document.body) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return [];

    const itemSelector = '[data-component="ActionList.Item"][role="option"]';
    const itemSet = new Set();
    if (root.matches?.(itemSelector)) {
      itemSet.add(root);
    }

    root.querySelectorAll?.(itemSelector).forEach(item => {
      itemSet.add(item);
    });

    return Array.from(itemSet).filter(item => {
      return (
        isInsideGitHubAssigneePicker(item) &&
        !item.classList?.contains("github-assignee-alias-result") &&
        !item.classList?.contains("github-assignee-prefetched-native-result")
      );
    });
  }

  function collectGitHubLegacyAssigneeItems(root = document.body) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return [];

    const itemSet = new Set();
    if (root.matches?.(".select-menu-item[role='menuitemcheckbox']")) {
      itemSet.add(root);
    }

    root.querySelectorAll?.(".select-menu-item[role='menuitemcheckbox']").forEach(item => {
      itemSet.add(item);
    });

    return Array.from(itemSet).filter(item => {
      const menu = getGitHubLegacyAssigneeMenu(item);
      return Boolean(menu && !item.closest("template"));
    });
  }

  function getGitHubAssigneeItemText(element) {
    if (!element) return "";

    return Array.from(element.childNodes)
      .map(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent || "";
        }

        if (
          node.nodeType === Node.ELEMENT_NODE &&
          !node.classList?.contains("github-assignee-alias")
        ) {
          return node.textContent || "";
        }

        return "";
      })
      .join("")
      .trim();
  }

  function getGitHubLegacyAssigneeElementText(element) {
    if (!element) return "";

    return Array.from(element.childNodes)
      .map(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent || "";
        }

        if (
          node.nodeType === Node.ELEMENT_NODE &&
          !node.classList?.contains("github-assignee-alias") &&
          !node.classList?.contains("github-assignee-legacy-search-tokens")
        ) {
          return node.textContent || "";
        }

        return "";
      })
      .join("")
      .trim();
  }

  function getGitHubAssigneeItemLogin(item) {
    const label = item?.querySelector?.('[data-component="ActionList.Item.Label"]');
    if (!label) return "";

    return getGitHubAssigneeItemText(label).replace(/^@/, "");
  }

  function getGitHubAssigneeItemDescription(item) {
    const description = item?.querySelector?.('[data-component="ActionList.Description"]:not(.github-assignee-alias)');
    return getGitHubAssigneeItemText(description);
  }

  function getGitHubLegacyAssigneeItemLogin(item) {
    return getGitHubLegacyAssigneeElementText(item?.querySelector?.(".js-username")).replace(/^@/, "");
  }

  function getGitHubLegacyAssigneeItemDescription(item) {
    return getGitHubLegacyAssigneeElementText(item?.querySelector?.(".js-description"));
  }

  function getGitHubLegacyUserPickerFilterContainer(input) {
    const menu = getGitHubLegacyAssigneeMenu(input);
    if (!menu) return null;

    const inputId = input?.id || "";
    return Array.from(menu.querySelectorAll("[data-filterable-for]")).find(container => {
      return container.getAttribute("data-filterable-for") === inputId;
    }) || menu.querySelector("[data-filterable-src]") || null;
  }

  function getGitHubLegacyUserPickerCache(menu) {
    if (!menu) return null;

    let cache = githubLegacyUserPickerItemCache.get(menu);
    if (!cache) {
      cache = {
        items: new Map(),
      };
      githubLegacyUserPickerItemCache.set(menu, cache);
    }
    return cache;
  }

  function cacheGitHubLegacyUserPickerItem(item) {
    const menu = getGitHubLegacyAssigneeMenu(item);
    if (!isGitHubLegacyReviewerMenu(menu)) return;

    const login = getGitHubLegacyAssigneeItemLogin(item);
    const normalizedLogin = normalizeGitHubAliasSearchText(login);
    if (!menu || !normalizedLogin) return;

    const cache = getGitHubLegacyUserPickerCache(menu);
    if (cache) {
      cache.items.set(normalizedLogin, item);
    }
  }

  function getGitHubLegacyUserPickerCachedItems(menu) {
    const cache = githubLegacyUserPickerItemCache.get(menu);
    return cache ? Array.from(cache.items.values()) : [];
  }

  function getGitHubLegacyUserPickerInsertAnchor(container) {
    const template = container?.querySelector?.("template");
    if (!template) return container?.firstChild || null;

    let anchor = template.nextSibling;
    while (
      anchor &&
      (
        (anchor.nodeType === Node.TEXT_NODE && !anchor.textContent.trim()) ||
        (
          anchor.nodeType === Node.ELEMENT_NODE &&
          anchor.hasAttribute?.(GITHUB_LEGACY_ALIAS_MATCH_ATTRIBUTE)
        )
      )
    ) {
      anchor = anchor.nextSibling;
    }
    return anchor || null;
  }

  function getGitHubLegacySafeInsertAnchor(container, anchor, movingNodes = []) {
    if (!container || !anchor) return null;

    const movingNodeSet = new Set(movingNodes.filter(Boolean));
    let safeAnchor = anchor;
    while (safeAnchor && movingNodeSet.has(safeAnchor)) {
      safeAnchor = safeAnchor.nextSibling;
    }

    return safeAnchor?.parentNode === container ? safeAnchor : null;
  }

  function insertGitHubLegacyFragment(container, fragment, anchor, movingNodes = []) {
    if (!container || !fragment?.childNodes?.length) return false;

    const safeAnchor = getGitHubLegacySafeInsertAnchor(container, anchor, movingNodes);
    container.insertBefore(fragment, safeAnchor);
    return true;
  }

  function getGitHubLegacyUserPickerTopAliasLogins(container) {
    const template = container?.querySelector?.("template");
    let node = template ? template.nextSibling : container?.firstChild;
    const logins = [];

    while (node) {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
        node = node.nextSibling;
        continue;
      }

      if (
        node.nodeType !== Node.ELEMENT_NODE ||
        !node.hasAttribute?.(GITHUB_LEGACY_ALIAS_MATCH_ATTRIBUTE)
      ) {
        break;
      }

      logins.push(normalizeGitHubAliasSearchText(getGitHubLegacyAssigneeItemLogin(node)));
      node = node.nextSibling;
    }

    return logins.filter(Boolean);
  }

  function isGitHubLegacyUserPickerAliasOrderCurrent(container, items) {
    const expectedLogins = items
      .map(item => normalizeGitHubAliasSearchText(getGitHubLegacyAssigneeItemLogin(item)))
      .filter(Boolean);
    const currentLogins = getGitHubLegacyUserPickerTopAliasLogins(container);

    return (
      expectedLogins.length === currentLogins.length &&
      expectedLogins.every((login, index) => currentLogins[index] === login) &&
      items.every(item => item.parentElement === container)
    );
  }

  function hideGitHubLegacyUserPickerAliasItem(item) {
    item.removeAttribute(GITHUB_LEGACY_ALIAS_MATCH_ATTRIBUTE);
    item.setAttribute(GITHUB_LEGACY_ALIAS_HIDDEN_ATTRIBUTE, "true");
    item.hidden = true;
    item.setAttribute("aria-hidden", "true");
    item.style.display = "none";
  }

  function showGitHubLegacyAssigneeItemsAtTop(input, items) {
    const container = getGitHubLegacyUserPickerFilterContainer(input);
    const uniqueItems = [];
    const seenLogins = new Set();
    (items || []).forEach(item => {
      const normalizedLogin = normalizeGitHubAliasSearchText(getGitHubLegacyAssigneeItemLogin(item));
      if (!item || !normalizedLogin || seenLogins.has(normalizedLogin)) return;

      seenLogins.add(normalizedLogin);
      uniqueItems.push(item);
    });

    if (!container || uniqueItems.length === 0) return false;

    if (isGitHubLegacyUserPickerAliasOrderCurrent(container, uniqueItems)) {
      uniqueItems.forEach(item => {
        showGitHubLegacyAssigneeItem(item);
        cacheGitHubLegacyUserPickerItem(item);
      });
      return true;
    }

    container.querySelectorAll?.(`[${GITHUB_LEGACY_ALIAS_MATCH_ATTRIBUTE}="true"]`).forEach(item => {
      item.removeAttribute(GITHUB_LEGACY_ALIAS_MATCH_ATTRIBUTE);
      if (!seenLogins.has(normalizeGitHubAliasSearchText(getGitHubLegacyAssigneeItemLogin(item)))) {
        hideGitHubLegacyUserPickerAliasItem(item);
      }
    });

    const anchor = getGitHubLegacySafeInsertAnchor(
      container,
      getGitHubLegacyUserPickerInsertAnchor(container),
      uniqueItems
    );
    const fragment = document.createDocumentFragment();
    uniqueItems.forEach(item => {
      item.setAttribute(GITHUB_LEGACY_ALIAS_MATCH_ATTRIBUTE, "true");
      item.removeAttribute(GITHUB_LEGACY_ALIAS_HIDDEN_ATTRIBUTE);
      showGitHubLegacyAssigneeItem(item);
      cacheGitHubLegacyUserPickerItem(item);
      fragment.appendChild(item);
    });
    return insertGitHubLegacyFragment(container, fragment, anchor);
  }

  function clearGitHubLegacyUserPickerAliasMatches(input, { restore = false } = {}) {
    const container = getGitHubLegacyUserPickerFilterContainer(input);
    container?.querySelectorAll?.([
      `[${GITHUB_LEGACY_ALIAS_MATCH_ATTRIBUTE}="true"]`,
      `[${GITHUB_LEGACY_ALIAS_HIDDEN_ATTRIBUTE}="true"]`,
    ].join(", ")).forEach(item => {
      item.removeAttribute(GITHUB_LEGACY_ALIAS_MATCH_ATTRIBUTE);
      item.removeAttribute(GITHUB_LEGACY_ALIAS_HIDDEN_ATTRIBUTE);
      if (restore) {
        showGitHubLegacyAssigneeItem(item);
      } else {
        hideGitHubLegacyUserPickerAliasItem(item);
      }
    });
  }

  function isGitHubLegacyAssigneeAliasItemMatch(item, normalizedQuery) {
    const login = getGitHubLegacyAssigneeItemLogin(item);
    const userInfo = getGitHubUserInfoByLogin(login);
    if (!userInfo || !normalizedQuery) return false;

    const candidates = getGitHubAssigneeAliasCandidateTexts(login, userInfo, false);
    return candidates.some(candidate => candidate.includes(normalizedQuery));
  }

  function isGitHubLegacyAssigneeLocalItemMatch(item, normalizedQuery) {
    if (!item || !normalizedQuery) return false;

    const login = getGitHubLegacyAssigneeItemLogin(item);
    const description = getGitHubLegacyAssigneeItemDescription(item);
    const userInfo = getGitHubUserInfoByLogin(login);
    const candidates = [
      login,
      description,
      ...(userInfo ? getGitHubAssigneeAliasCandidateTexts(login, userInfo, false) : []),
    ].map(normalizeGitHubAliasSearchText).filter(Boolean);

    return candidates.some(candidate => candidate.includes(normalizedQuery));
  }

  function getGitHubLegacyIssueAssigneeLocalMatches(input, normalizedQuery) {
    const menu = getGitHubLegacyAssigneeMenu(input);
    if (!isGitHubLegacyIssueAssigneeMenu(menu) || !normalizedQuery) return [];

    const itemsByLogin = new Map();
    collectGitHubLegacyAssigneeItems(menu).forEach(item => {
      if (item.getAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_ATTRIBUTE) === "true") return;

      const normalizedLogin = normalizeGitHubAliasSearchText(getGitHubLegacyAssigneeItemLogin(item));
      if (normalizedLogin && !itemsByLogin.has(normalizedLogin)) {
        itemsByLogin.set(normalizedLogin, item);
      }
    });

    return Array.from(itemsByLogin.values()).filter(item => {
      return isGitHubLegacyAssigneeLocalItemMatch(item, normalizedQuery);
    });
  }

  function getGitHubLegacyAssigneeFallbackLogins(input) {
    const query = input?.value || "";
    const normalizedQuery = normalizeGitHubAliasSearchText(query);
    if (!normalizedQuery || normalizedQuery.length < 2) return [];

    const logins = [];
    const seenLogins = new Set();
    const addLogin = login => {
      const normalizedLogin = normalizeGitHubAliasSearchText(login);
      if (!normalizedLogin || seenLogins.has(normalizedLogin)) return;

      seenLogins.add(normalizedLogin);
      logins.push(String(login || "").trim().replace(/^@/, ""));
    };

    findGitHubAssigneeAliasMatches(query).forEach(match => addLogin(match.login));
    addLogin(resolveGitHubAssigneeLogin(query));
    return logins.slice(0, 6);
  }

  function findGitHubLegacyAssigneeItemByLogin(menu, login, { includeFallback = true } = {}) {
    const normalizedLogin = normalizeGitHubAliasSearchText(login);
    if (!menu || !normalizedLogin) return null;

    return collectGitHubLegacyAssigneeItems(menu).find(item => {
      if (!includeFallback && item.getAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_ATTRIBUTE) === "true") {
        return false;
      }

      return normalizeGitHubAliasSearchText(getGitHubLegacyAssigneeItemLogin(item)) === normalizedLogin;
    }) || null;
  }

  function removeGitHubLegacyAssigneeFallbackItems(input) {
    const container = getGitHubLegacyUserPickerFilterContainer(input);
    container?.querySelectorAll?.(`[${GITHUB_LEGACY_ASSIGNEE_FALLBACK_ATTRIBUTE}="true"]`).forEach(item => {
      item.remove();
    });
  }

  function removeDuplicateGitHubLegacyAssigneeFallbackItems(menu, login, keepItem) {
    const normalizedLogin = normalizeGitHubAliasSearchText(login);
    if (!menu || !normalizedLogin) return;

    collectGitHubLegacyAssigneeItems(menu).forEach(item => {
      if (
        item !== keepItem &&
        item.getAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_ATTRIBUTE) === "true" &&
        normalizeGitHubAliasSearchText(getGitHubLegacyAssigneeItemLogin(item)) === normalizedLogin
      ) {
        item.remove();
      }
    });
  }

  function buildGitHubLegacyAssigneeFallbackFetchUrl(input, query) {
    const container = getGitHubLegacyUserPickerFilterContainer(input);
    const source = container?.getAttribute?.("data-filterable-src") || "";
    if (!source || !query) return "";

    try {
      const url = new URL(source, window.location.origin);
      if (url.origin !== window.location.origin) return "";

      url.searchParams.set("q", query);
      if (container.hasAttribute("data-filterable-type-ahead") || input?.hasAttribute?.("type-ahead")) {
        url.searchParams.set("typeAhead", "true");
      }
      return url.toString();
    } catch (error) {
      return "";
    }
  }

  function normalizeGitHubLegacyAssigneeUser(user) {
    const login = String(user?.login || "").trim().replace(/^@/, "");
    if (!login) return null;

    return {
      id: String(user?.id || ""),
      login,
      name: String(user?.name || "").trim(),
      selected: Boolean(user?.selected),
      avatar: String(user?.avatar || user?.avatarUrl || ""),
      className: String(user?.class || "").trim(),
    };
  }

  async function fetchGitHubLegacyAssigneeUsers(input, query) {
    const url = buildGitHubLegacyAssigneeFallbackFetchUrl(input, query);
    if (!url) return [];

    const headers = {
      accept: "application/json",
      "GitHub-Verified-Fetch": "true",
      "X-Requested-With": "XMLHttpRequest",
    };
    const fetchNonce = getGitHubFetchNonce();
    if (fetchNonce) {
      headers["X-Fetch-Nonce"] = fetchNonce;
    }

    const clientVersion = getGitHubClientVersion();
    if (clientVersion) {
      headers["X-GitHub-Client-Version"] = clientVersion;
    }

    const response = await fetch(url, {
      credentials: "include",
      headers,
    });
    updateGitHubFetchNonce(response);
    if (!response.ok) return [];

    const responseData = await response.json().catch(() => null);
    return (Array.isArray(responseData?.users) ? responseData.users : [])
      .map(normalizeGitHubLegacyAssigneeUser)
      .filter(Boolean);
  }

  function createGitHubLegacyAssigneeFallbackItem(container) {
    const templateItem = container?.querySelector?.("template")?.content?.querySelector?.(".select-menu-item[role='menuitemcheckbox']");
    if (templateItem) {
      return templateItem.cloneNode(true);
    }

    const item = document.createElement("label");
    item.className = "select-menu-item text-normal";
    item.setAttribute("role", "menuitemcheckbox");
    item.setAttribute("tabindex", "0");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "issue[user_assignee_ids][]";
    checkbox.style.display = "none";
    item.appendChild(checkbox);

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "select-menu-item-gravatar";
    const avatar = document.createElement("img");
    avatar.className = "avatar-small mr-1 js-avatar";
    avatarWrap.appendChild(avatar);
    item.appendChild(avatarWrap);

    const text = document.createElement("div");
    text.className = "select-menu-item-text lh-condensed";
    const heading = document.createElement("span");
    heading.className = "select-menu-item-heading";
    const username = document.createElement("span");
    username.className = "js-username";
    const description = document.createElement("span");
    description.className = "description js-description";
    heading.appendChild(username);
    heading.appendChild(description);
    text.appendChild(heading);
    item.appendChild(text);

    return item;
  }

  function getGitHubLegacyAssigneeItemCheckbox(item) {
    return item?.querySelector?.('input[type="checkbox"][name*="assignee"]') ||
      item?.querySelector?.('input[type="checkbox"]') ||
      null;
  }

  function getGitHubLegacyAssigneeFallbackInput(item) {
    const container = item?.closest?.("[data-filterable-for]");
    const inputId = container?.getAttribute?.("data-filterable-for") || "";
    if (inputId) {
      const input = document.getElementById(inputId);
      if (input) return input;
    }

    return getGitHubLegacyAssigneeMenu(item)?.querySelector?.(GITHUB_LEGACY_ASSIGNEE_FILTER_INPUT_SELECTOR) || null;
  }

  function getGitHubLegacyAssigneeFallbackForm(inputOrItem) {
    const menu = getGitHubLegacyAssigneeMenu(inputOrItem);
    return menu?.closest?.("form.js-issue-sidebar-form, form") || null;
  }

  function getGitHubLegacyAssigneeFallbackState(inputOrItem) {
    const input = isGitHubLegacyAssigneeFilterInput(inputOrItem)
      ? inputOrItem
      : getGitHubLegacyAssigneeFallbackInput(inputOrItem);
    return input ? githubLegacyAssigneeFallbackState.get(input) : null;
  }

  function markGitHubLegacyAssigneeFallbackDirty(item) {
    const form = getGitHubLegacyAssigneeFallbackForm(item);
    if (!form) return;

    form.setAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_DIRTY_ATTRIBUTE, "true");
  }

  function getGitHubLegacyAssigneeFallbackItemUser(item) {
    const checkbox = getGitHubLegacyAssigneeItemCheckbox(item);
    const login = getGitHubLegacyAssigneeItemLogin(item);
    const id = checkbox?.value || item?.getAttribute?.("data-lark-assignee-user-id") || "";
    if (!login || !id) return null;

    return {
      id: String(id),
      login,
    };
  }

  function updateGitHubLegacyAssigneeFallbackFormSelection(item, selected) {
    const form = getGitHubLegacyAssigneeFallbackForm(item);
    const user = getGitHubLegacyAssigneeFallbackItemUser(item);
    if (!form || !user) return;

    let selections = githubLegacyAssigneeFallbackFormSelections.get(form);
    if (!selections) {
      selections = new Map();
      githubLegacyAssigneeFallbackFormSelections.set(form, selections);
    }

    if (selected) {
      selections.set(user.id, {
        ...user,
        selected: true,
      });
    } else {
      selections.delete(user.id);
    }
    syncGitHubLegacyAssigneeFallbackSaveInputs(form);
  }

  function updateGitHubLegacyAssigneeFallbackStateSelection(item, selected) {
    const input = getGitHubLegacyAssigneeFallbackInput(item);
    const state = input ? githubLegacyAssigneeFallbackState.get(input) : null;
    const normalizedLogin = normalizeGitHubAliasSearchText(getGitHubLegacyAssigneeItemLogin(item));
    if (!state?.users || !normalizedLogin) return;

    state.users = state.users.map(user => (
      normalizeGitHubAliasSearchText(user.login) === normalizedLogin
        ? { ...user, selected }
        : user
    ));
  }

  function dispatchGitHubLegacyAssigneeSelectionEvents(item) {
    const checkbox = getGitHubLegacyAssigneeItemCheckbox(item);
    if (checkbox) {
      checkbox.dispatchEvent(new Event("input", { bubbles: true }));
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const menu = getGitHubLegacyAssigneeMenu(item);
    menu?.dispatchEvent?.(new Event("change", { bubbles: true }));
    item.closest?.("form")?.dispatchEvent?.(new Event("change", { bubbles: true }));
  }

  function setGitHubLegacyAssigneeItemSelected(item, selected, { dispatch = false } = {}) {
    const checkbox = getGitHubLegacyAssigneeItemCheckbox(item);
    if (checkbox) {
      checkbox.checked = selected;
      if (selected) {
        checkbox.setAttribute("checked", "checked");
      } else {
        checkbox.removeAttribute("checked");
      }
    }

    item.setAttribute("aria-checked", selected ? "true" : "false");
    item.classList.toggle("selected", selected);
    if (item.getAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_ATTRIBUTE) === "true") {
      updateGitHubLegacyAssigneeFallbackStateSelection(item, selected);
      if (dispatch) {
        updateGitHubLegacyAssigneeFallbackFormSelection(item, selected);
        markGitHubLegacyAssigneeFallbackDirty(item);
      }
    }
    if (dispatch) {
      dispatchGitHubLegacyAssigneeSelectionEvents(item);
    }
  }

  function getGitHubLegacyAssigneeFallbackSelectedUsers(form, state = null) {
    const usersById = new Map();
    (state?.users || []).forEach(user => {
      if (user?.selected && user?.id) {
        usersById.set(String(user.id), user);
      }
    });

    const formSelections = githubLegacyAssigneeFallbackFormSelections.get(form);
    formSelections?.forEach(user => {
      if (user?.selected && user?.id) {
        usersById.set(String(user.id), user);
      }
    });

    return Array.from(usersById.values());
  }

  function syncGitHubLegacyAssigneeFallbackSaveInputs(form, state = null) {
    if (!form) return [];

    form.querySelectorAll?.(`[${GITHUB_LEGACY_ASSIGNEE_FALLBACK_SAVE_INPUT_ATTRIBUTE}="true"]`).forEach(input => {
      input.remove();
    });

    const selectedUsers = getGitHubLegacyAssigneeFallbackSelectedUsers(form, state);
    const selectedIds = [];
    selectedUsers.forEach(user => {
      const value = String(user.id || "");
      if (!value || selectedIds.includes(value)) return;

      selectedIds.push(value);
      const existingCheckedInput = Array.from(form.querySelectorAll('input[name="issue[user_assignee_ids][]"]')).find(input => {
        return input.value === value && input.checked;
      });
      if (existingCheckedInput) return;

      const hiddenInput = document.createElement("input");
      hiddenInput.type = "hidden";
      hiddenInput.name = "issue[user_assignee_ids][]";
      hiddenInput.value = value;
      hiddenInput.setAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_SAVE_INPUT_ATTRIBUTE, "true");
      form.appendChild(hiddenInput);
    });

    return selectedIds;
  }

  function submitGitHubLegacyAssigneeFallbackForm(input, reason = "close") {
    const form = getGitHubLegacyAssigneeFallbackForm(input);
    if (
      !form ||
      form.getAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_DIRTY_ATTRIBUTE) !== "true" ||
      form.getAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_SUBMITTING_ATTRIBUTE) === "true"
    ) {
      return false;
    }

    const state = getGitHubLegacyAssigneeFallbackState(input);
    syncGitHubLegacyAssigneeFallbackSaveInputs(form, state);

    form.removeAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_DIRTY_ATTRIBUTE);
    form.setAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_SUBMITTING_ATTRIBUTE, "true");

    const submitButton = document.createElement("button");
    submitButton.type = "submit";
    submitButton.hidden = true;
    submitButton.style.display = "none";
    form.appendChild(submitButton);

    try {
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit(submitButton);
      } else {
        submitButton.click();
      }
    } catch (error) {
      form.setAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_DIRTY_ATTRIBUTE, "true");
      form.removeAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_SUBMITTING_ATTRIBUTE);
      return false;
    } finally {
      window.setTimeout(() => {
        submitButton.remove();
        form.removeAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_SUBMITTING_ATTRIBUTE);
      }, 1000);
    }

    return true;
  }

  function bindGitHubLegacyAssigneeFallbackSaveOnClose(inputOrItem) {
    const input = isGitHubLegacyAssigneeFilterInput(inputOrItem)
      ? inputOrItem
      : getGitHubLegacyAssigneeFallbackInput(inputOrItem);
    const menu = getGitHubLegacyAssigneeMenu(input || inputOrItem);
    const details = menu?.closest?.("details");
    if (!input || !details || githubLegacyAssigneeFallbackSaveBound.has(details)) return;

    githubLegacyAssigneeFallbackSaveBound.add(details);
    details.addEventListener("toggle", () => {
      if (details.open) return;

      submitGitHubLegacyAssigneeFallbackForm(input, "details close");
    });
  }

  function getGitHubLegacyAssigneeFallbackItemFromEvent(event) {
    return event.target?.closest?.(`[${GITHUB_LEGACY_ASSIGNEE_FALLBACK_ATTRIBUTE}="true"]`);
  }

  function activateGitHubLegacyAssigneeFallbackItem(item, event, reason = "click") {
    if (!item) return;

    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();

    const now = Date.now();
    const lastActivation = githubLegacyAssigneeFallbackActivationState.get(item);
    if (
      lastActivation &&
      now - lastActivation.time < 350 &&
      (
        reason === "click" ||
        lastActivation.reason === reason
      )
    ) {
      return;
    }
    githubLegacyAssigneeFallbackActivationState.set(item, {
      time: now,
      reason,
    });

    const selected = item.getAttribute("aria-checked") !== "true";
    setGitHubLegacyAssigneeItemSelected(item, selected, { dispatch: true });
  }

  function bindGitHubLegacyAssigneeFallbackContainerEvents(container) {
    if (!container || githubLegacyAssigneeFallbackContainers.has(container)) return;

    githubLegacyAssigneeFallbackContainers.add(container);
    const handlePointerEvent = event => {
      const item = getGitHubLegacyAssigneeFallbackItemFromEvent(event);
      if (!item || !container.contains(item)) return;

      activateGitHubLegacyAssigneeFallbackItem(item, event, event.type);
    };

    container.addEventListener("mousedown", handlePointerEvent, true);
    container.addEventListener("click", handlePointerEvent, true);
    container.addEventListener("keydown", event => {
      if (event.key !== " " && event.key !== "Enter") return;

      const item = getGitHubLegacyAssigneeFallbackItemFromEvent(event);
      if (!item || !container.contains(item)) return;

      activateGitHubLegacyAssigneeFallbackItem(item, event, "keydown");
    }, true);
  }

  function bindGitHubLegacyAssigneeFallbackItemEvents(item) {
    if (!item || item.getAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_BOUND_ATTRIBUTE) === "true") return;

    item.setAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_BOUND_ATTRIBUTE, "true");

    item.addEventListener("mousedown", event => activateGitHubLegacyAssigneeFallbackItem(item, event, "mousedown"), true);
    item.addEventListener("click", event => activateGitHubLegacyAssigneeFallbackItem(item, event, "click"), true);
    item.addEventListener("keydown", event => {
      if (event.key === " " || event.key === "Enter") {
        activateGitHubLegacyAssigneeFallbackItem(item, event, "keydown");
      }
    }, true);
  }

  function fillGitHubLegacyAssigneeFallbackItem(item, user) {
    const selected = item.isConnected &&
      item.getAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_ATTRIBUTE) === "true"
      ? getGitHubLegacyAssigneeItemCheckbox(item)?.checked ||
        item.getAttribute("aria-checked") === "true"
      : user.selected;

    item.setAttribute("role", "menuitemcheckbox");
    item.setAttribute("aria-checked", selected ? "true" : "false");
    if (!item.hasAttribute("tabindex")) {
      item.setAttribute("tabindex", "0");
    }

    let checkbox = item.querySelector('input[type="checkbox"][name*="assignee"]') ||
      item.querySelector('input[type="checkbox"]');
    if (!checkbox) {
      checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.style.display = "none";
      item.insertBefore(checkbox, item.firstChild);
    }
    checkbox.name = "issue[user_assignee_ids][]";
    checkbox.value = user.id;

    const username = item.querySelector(".js-username");
    if (username) {
      username.textContent = user.login;
    }

    const description = item.querySelector(".js-description");
    if (description) {
      description.textContent = user.name;
    }

    const avatar = item.querySelector(".js-avatar, img");
    if (avatar) {
      if (user.avatar) {
        avatar.src = user.avatar;
      }
      avatar.alt = `@${user.login}`;
      avatar.width = avatar.width || 20;
      avatar.height = avatar.height || 20;
      const classNames = new Set([
        "avatar-small",
        "mr-1",
        "js-avatar",
        ...user.className.split(/\s+/).filter(Boolean),
      ]);
      avatar.className = Array.from(classNames).join(" ");
    }

    item.setAttribute("data-lark-assignee-login", user.login);
    item.setAttribute("data-lark-assignee-user-id", user.id);
    setGitHubLegacyAssigneeItemSelected(item, selected);
    if (item.getAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_ATTRIBUTE) === "true") {
      bindGitHubLegacyAssigneeFallbackSaveOnClose(item);
      bindGitHubLegacyAssigneeFallbackContainerEvents(item.closest("[data-filterable-for]"));
      bindGitHubLegacyAssigneeFallbackItemEvents(item);
    }
    enhanceGitHubLegacyAssigneeItem(item);
    return item;
  }

  function getGitHubLegacyAssigneeFallbackInsertAnchor(container) {
    const template = container?.querySelector?.("template");
    let anchor = template ? template.nextSibling : container?.firstChild;

    while (
      anchor &&
      (
        (anchor.nodeType === Node.TEXT_NODE && !anchor.textContent.trim()) ||
        (
          anchor.nodeType === Node.ELEMENT_NODE &&
          (
            anchor.getAttribute?.(GITHUB_LEGACY_ASSIGNEE_FALLBACK_ATTRIBUTE) === "true" ||
            anchor.getAttribute?.(GITHUB_LEGACY_ALIAS_MATCH_ATTRIBUTE) === "true"
          )
        )
      )
    ) {
      anchor = anchor.nextSibling;
    }

    return anchor || null;
  }

  function insertGitHubLegacyAssigneeFallbackUsers(input, users) {
    const menu = getGitHubLegacyAssigneeMenu(input);
    const container = getGitHubLegacyUserPickerFilterContainer(input);
    if (!isGitHubLegacyIssueAssigneeMenu(menu) || !container || !users?.length) return false;

    const fragment = document.createDocumentFragment();
    const seenLogins = new Set();
    users.forEach(user => {
      const normalizedLogin = normalizeGitHubAliasSearchText(user.login);
      if (!normalizedLogin || seenLogins.has(normalizedLogin)) return;

      seenLogins.add(normalizedLogin);
      let item = findGitHubLegacyAssigneeItemByLogin(menu, user.login, { includeFallback: false }) ||
        findGitHubLegacyAssigneeItemByLogin(menu, user.login);
      if (!item) {
        item = createGitHubLegacyAssigneeFallbackItem(container);
        item.setAttribute(GITHUB_LEGACY_ASSIGNEE_FALLBACK_ATTRIBUTE, "true");
      }

      removeDuplicateGitHubLegacyAssigneeFallbackItems(menu, user.login, item);
      fillGitHubLegacyAssigneeFallbackItem(item, user);
      showGitHubLegacyAssigneeItem(item);
      fragment.appendChild(item);
    });

    if (fragment.childNodes.length === 0) return false;

    const anchor = getGitHubLegacyAssigneeFallbackInsertAnchor(container);
    if (!insertGitHubLegacyFragment(container, fragment, anchor)) return false;
    container.classList.remove("filterable-empty");
    setGitHubLegacyAssigneeNoResultsHidden(menu, true);
    return true;
  }

  function applyGitHubLegacyIssueAssigneeFallback(input) {
    const menu = getGitHubLegacyAssigneeMenu(input);
    if (!isGitHubLegacyIssueAssigneeMenu(menu)) return;

    const normalizedQuery = normalizeGitHubAliasSearchText(input.value || "");
    if (!normalizedQuery) {
      githubLegacyAssigneeFallbackState.delete(input);
      removeGitHubLegacyAssigneeFallbackItems(input);
      clearGitHubLegacyUserPickerAliasMatches(input, { restore: true });
      setGitHubLegacyAssigneeNoResultsHidden(menu, false);
      return;
    }

    const localMatchedItems = getGitHubLegacyIssueAssigneeLocalMatches(input, normalizedQuery);
    const hasLocalMatches = localMatchedItems.length > 0;
    if (hasLocalMatches) {
      if (!showGitHubLegacyAssigneeItemsAtTop(input, localMatchedItems)) {
        localMatchedItems.forEach(showGitHubLegacyAssigneeItem);
      }
      setGitHubLegacyAssigneeNoResultsHidden(menu, true);
    } else {
      clearGitHubLegacyUserPickerAliasMatches(input);
    }

    const logins = getGitHubLegacyAssigneeFallbackLogins(input);
    if (logins.length === 0) {
      githubLegacyAssigneeFallbackState.delete(input);
      removeGitHubLegacyAssigneeFallbackItems(input);
      setGitHubLegacyAssigneeNoResultsHidden(menu, hasLocalMatches);
      return;
    }

    const key = `${input.value || ""}\n${logins.join("\n")}`;
    const currentState = githubLegacyAssigneeFallbackState.get(input);
    if (currentState?.key === key) {
      if (currentState.users?.length) {
        insertGitHubLegacyAssigneeFallbackUsers(input, currentState.users);
      }
      if (hasLocalMatches || currentState.users?.length) {
        setGitHubLegacyAssigneeNoResultsHidden(menu, true);
      }
      return;
    }

    removeGitHubLegacyAssigneeFallbackItems(input);
    const nextState = {
      key,
      users: [],
      promise: null,
    };
    githubLegacyAssigneeFallbackState.set(input, nextState);

    nextState.promise = Promise.all(
      logins.map(login => fetchGitHubLegacyAssigneeUsers(input, login).catch(() => []))
    ).then(results => {
      if (!input.isConnected || githubLegacyAssigneeFallbackState.get(input) !== nextState) return;

      const usersByLogin = new Map();
      results.flat().forEach(user => {
        const normalizedLogin = normalizeGitHubAliasSearchText(user.login);
        if (normalizedLogin && !usersByLogin.has(normalizedLogin)) {
          usersByLogin.set(normalizedLogin, user);
        }
      });

      nextState.users = Array.from(usersByLogin.values());
      if (nextState.users.length > 0) {
        insertGitHubLegacyAssigneeFallbackUsers(input, nextState.users);
      }
    });
  }

  function getGitHubAssigneeItemAttribute(item, attributeNames) {
    if (!item) return "";

    const elements = [item, ...Array.from(item.querySelectorAll?.("*") || [])];
    for (const element of elements) {
      for (const attributeName of attributeNames) {
        const value = element.getAttribute?.(attributeName);
        if (value) return value;
      }
    }

    return "";
  }

  function getGitHubAssigneeActorFromItem(item, fallbackLogin = "") {
    if (!item) return null;

    const login = getGitHubAssigneeItemLogin(item) || fallbackLogin;
    const id = getGitHubAssigneeItemAttribute(item, [
      "data-lark-assignee-actor-id",
      "data-node-id",
      "data-assignee-id",
      "data-user-id",
    ]);
    const avatarUrl = item.querySelector?.('img[data-testid="github-avatar"], img')?.src || "";
    const name = getGitHubAssigneeItemDescription(item);
    const actor = normalizeGitHubAssigneeActor({
      id,
      login,
      name,
      avatarUrl,
      profileResourcePath: login ? `/${login}` : "",
    }, fallbackLogin);

    return actor?.id ? cacheGitHubAssigneeActor(actor) : actor;
  }

  function getGitHubAssigneePickerRoot(picker) {
    return picker?.querySelector?.('[data-testid="item-picker-root"], [data-component="ActionList"][role="listbox"]') || null;
  }

  function getGitHubAssigneePickerContainer(picker) {
    return picker?.querySelector?.('[class*="FilteredActionList-Container"]') || null;
  }

  function getOrCreateGitHubAssigneeAliasListRoot(picker) {
    const nativeRoot = getGitHubAssigneePickerRoot(picker);
    if (nativeRoot) return nativeRoot;

    const container = getGitHubAssigneePickerContainer(picker);
    if (!container) return null;

    const existingRoot = container.querySelector(".github-assignee-alias-list");
    if (existingRoot) return existingRoot;

    const listRoot = document.createElement("ul");
    listRoot.className = "github-assignee-alias-list prc-ActionList-ActionList-rPFF2 prc-FilteredActionList-ActionList-3-Bxb";
    listRoot.setAttribute("role", "listbox");
    listRoot.setAttribute("data-component", "ActionList");
    listRoot.setAttribute("aria-label", "User results");
    listRoot.setAttribute("aria-multiselectable", "true");
    container.insertBefore(listRoot, container.firstChild);
    return listRoot;
  }

  function removeGitHubAssigneeAliasResults(picker) {
    picker?.querySelectorAll?.(".github-assignee-alias-result").forEach(item => {
      item.remove();
    });
    picker?.querySelectorAll?.(".github-assignee-alias-list").forEach(listRoot => {
      if (listRoot.children.length === 0) {
        listRoot.remove();
      }
    });
  }

  function resetGitHubAssigneeDuplicateItems(picker) {
    picker?.querySelectorAll?.('[data-lark-assignee-alias-duplicate="true"]').forEach(item => {
      item.removeAttribute("data-lark-assignee-alias-duplicate");
      item.style.display = "";
    });
  }

  function resetGitHubAssigneeEmptyState(picker) {
    picker?.querySelectorAll?.('[data-lark-assignee-empty-hidden="true"]').forEach(node => {
      node.removeAttribute("data-lark-assignee-empty-hidden");
      node.style.display = "";
    });
  }

  function hideGitHubAssigneeEmptyState(picker) {
    const container = getGitHubAssigneePickerContainer(picker);
    if (!container) return;

    Array.from(container.children).forEach(child => {
      if (child.matches?.('[data-component="ActionList"], .github-assignee-alias-list')) {
        return;
      }

      const text = child.textContent || "";
      if (
        text.includes("No assignees were found") ||
        text.includes("Try searching for a different name for results")
      ) {
        child.setAttribute("data-lark-assignee-empty-hidden", "true");
        child.style.display = "none";
      }
    });
  }

  function findNativeGitHubAssigneeItemByLogin(picker, login) {
    const normalizedLogin = normalizeGitHubAliasSearchText(login);
    if (!normalizedLogin) return null;

    return collectGitHubAssigneePickerItems(picker).find(item => {
      return normalizeGitHubAliasSearchText(getGitHubAssigneeItemLogin(item)) === normalizedLogin;
    }) || null;
  }

  function getGitHubAssigneeAliasResultFromEvent(event) {
    return event.target?.closest?.(".github-assignee-alias-result") || null;
  }

  function bindGitHubAssigneeAliasPickerEvents(picker) {
    if (!picker || githubAssigneeAliasPickerEvents.has(picker)) return;

    githubAssigneeAliasPickerEvents.add(picker);
    picker.addEventListener("mousedown", event => {
      const item = getGitHubAssigneeAliasResultFromEvent(event);
      if (!item) return;

      event.preventDefault();
      event.stopPropagation();
    }, true);
    picker.addEventListener("click", event => {
      const item = getGitHubAssigneeAliasResultFromEvent(event);
      if (!item) return;

      event.preventDefault();
      event.stopPropagation();
      activateGitHubAssigneeAliasResult(item);
    }, true);
  }

  function getGitHubAssigneeAliasSelectionState(picker) {
    if (!picker) return null;

    const context = getGitHubAssignableContext();
    const issueKey = buildGitHubAssigneeIssueKey(context);
    let state = githubAssigneeAliasSelectionState.get(picker);
    if (!state || state.issueKey !== issueKey) {
      const baseActors = createGitHubAssigneeActorMap(context?.assignedActors || []);
      state = {
        issueKey,
        issueId: context?.issueId || "",
        baseActors,
        selectedActors: new Map(baseActors),
        resolvingActors: new Map(),
        dirty: false,
        saving: null,
      };
      githubAssigneeAliasSelectionState.set(picker, state);
    }

    return state;
  }

  function isGitHubAssigneeAliasSelected(picker, login) {
    const normalizedLogin = normalizeGitHubAliasSearchText(login);
    const nativeItem = findNativeGitHubAssigneeItemByLogin(picker, login);
    if (nativeItem) {
      return nativeItem.getAttribute("aria-selected") === "true";
    }

    const state = getGitHubAssigneeAliasSelectionState(picker);
    return Boolean(normalizedLogin && state?.selectedActors.has(normalizedLogin));
  }

  function syncGitHubAssigneeAliasResultSelection(picker) {
    if (!picker) return;

    picker.querySelectorAll?.(".github-assignee-alias-result").forEach(item => {
      const login = item.getAttribute("data-lark-assignee-login") || "";
      item.setAttribute("aria-selected", isGitHubAssigneeAliasSelected(picker, login) ? "true" : "false");
    });
  }

  function getGitHubAssigneeSelectionActor(login, actor = null) {
    const cachedActor = getCachedGitHubAssigneeActor(login);
    if (cachedActor?.id) return cachedActor;

    return normalizeGitHubAssigneeActor(actor || { login }, login);
  }

  function setGitHubAssigneeSelectedActor(picker, actor) {
    const state = getGitHubAssigneeAliasSelectionState(picker);
    const normalizedLogin = normalizeGitHubAliasSearchText(actor?.login);
    if (!state || !normalizedLogin || !state.selectedActors.has(normalizedLogin)) return false;

    const cachedActor = actor?.id ? cacheGitHubAssigneeActor(actor) : actor;
    state.selectedActors.set(normalizedLogin, cachedActor);
    return true;
  }

  function toggleGitHubAssigneeAliasSelection(picker, login, actor = null) {
    const selectionActor = getGitHubAssigneeSelectionActor(login, actor);
    if (!selectionActor?.login) return { selected: false, actor: null };

    const state = getGitHubAssigneeAliasSelectionState(picker);
    const normalizedLogin = normalizeGitHubAliasSearchText(selectionActor.login);
    if (!state || !normalizedLogin) return { selected: false, actor: null };

    if (state.selectedActors.has(normalizedLogin)) {
      state.selectedActors.delete(normalizedLogin);
      state.resolvingActors.delete(normalizedLogin);
      state.dirty = true;
      syncGitHubAssigneeAliasResultSelection(picker);
      return { selected: false, actor: selectionActor };
    } else {
      const cachedActor = selectionActor.id ? cacheGitHubAssigneeActor(selectionActor) : selectionActor;
      state.selectedActors.set(normalizedLogin, cachedActor);
    }

    state.dirty = true;
    syncGitHubAssigneeAliasResultSelection(picker);
    return { selected: true, actor: selectionActor };
  }

  function resolveGitHubAssigneeSelectedActor(picker, login, item = null) {
    const normalizedLogin = normalizeGitHubAliasSearchText(login);
    const state = getGitHubAssigneeAliasSelectionState(picker);
    if (!state || !normalizedLogin || state.resolvingActors.has(normalizedLogin)) {
      return state?.resolvingActors.get(normalizedLogin) || Promise.resolve(null);
    }

    const promise = fetchGitHubAssigneeActor(login, picker)
      .then(actor => {
        if (actor?.id) {
          setGitHubAssigneeSelectedActor(picker, actor);
          item?.setAttribute?.("data-lark-assignee-actor-id", actor.id);
          item?.removeAttribute?.("data-lark-assignee-error");
          item?.removeAttribute?.("title");
          return actor;
        }

        item?.setAttribute?.("data-lark-assignee-error", "true");
        item?.setAttribute?.("title", "未能取得 GitHub 用户 ID，关闭时可能无法保存");
        return null;
      })
      .catch(error => {
        item?.setAttribute?.("data-lark-assignee-error", "true");
        item?.setAttribute?.("title", "未能取得 GitHub 用户 ID，关闭时可能无法保存");
        console.warn("[GitHub Handler] 解析 assignee actor id 失败:", login, error);
        return null;
      })
      .finally(() => {
        item?.removeAttribute?.("aria-busy");
        state.resolvingActors.delete(normalizedLogin);
      });

    state.resolvingActors.set(normalizedLogin, promise);
    item?.setAttribute?.("aria-busy", "true");
    return promise;
  }

  function createGitHubClientMutationId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }

    return `lark-linker-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getGitHubGraphQLHeaders() {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "GitHub-Verified-Fetch": "true",
      "X-Requested-With": "XMLHttpRequest",
    };

    const fetchNonce = getGitHubFetchNonce();
    if (fetchNonce) {
      headers["X-Fetch-Nonce"] = fetchNonce;
    }

    const clientVersion = getGitHubClientVersion();
    if (clientVersion) {
      headers["X-GitHub-Client-Version"] = clientVersion;
    }

    return headers;
  }

  async function saveGitHubAssigneeActors(issueId, actorIds) {
    const body = JSON.stringify({
      persistedQueryName: GITHUB_ASSIGNEE_REPLACE_ACTORS_QUERY_NAME,
      query: GITHUB_ASSIGNEE_REPLACE_ACTORS_QUERY_ID,
      variables: {
        input: {
          assignableId: issueId,
          actorIds,
          clientMutationId: createGitHubClientMutationId(),
        },
      },
    });

    const response = await fetch("/_graphql", {
      method: "POST",
      credentials: "include",
      headers: getGitHubGraphQLHeaders(),
      body,
    });
    updateGitHubFetchNonce(response);

    const responseData = await response.json().catch(() => null);
    if (!response.ok || responseData?.errors?.length) {
      throw new Error(responseData?.errors?.[0]?.message || `GitHub assignee save failed: ${response.status}`);
    }

    return responseData;
  }

  function renderGitHubAssigneeSidebarActors(actors) {
    const section = document.querySelector('[data-testid="sidebar-assignees-section"]');
    if (!section) return;

    const emptyText = Array.from(section.querySelectorAll("span"))
      .find(span => (span.textContent || "").trim() === "No one assigned");
    if (emptyText) {
      emptyText.style.display = actors.length > 0 ? "none" : "";
    }

    let list = section.querySelector('ul[data-component="ActionList"]');
    if (!list) {
      const container =
        section.querySelector('[class*="hiddenChildrenContainer"]') ||
        section.querySelector('[class*="childrenContainer"]') ||
        section;
      list = document.createElement("ul");
      list.className = "prc-ActionList-ActionList-rPFF2 Assignees-module__assigneesList__ZKD6F";
      list.setAttribute("data-component", "ActionList");
      list.setAttribute("data-dividers", "false");
      list.setAttribute("data-variant", "full");
      container.appendChild(list);
    }

    const listContainer = list.closest('[class*="hiddenChildrenContainer"], [class*="childrenContainer"]');
    if (listContainer) {
      listContainer.hidden = false;
      listContainer.style.display = actors.length > 0 ? "" : "none";
    }

    list.replaceChildren();
    actors.forEach(actor => {
      const item = document.createElement("li");
      item.setAttribute("data-component", "ActionList.Item");
      item.className = "prc-ActionList-ActionListItem-So4vC";

      const link = document.createElement("a");
      link.className = "prc-ActionList-ActionListContent-KBb8- prc-Link-Link-9ZwDx";
      link.setAttribute("data-component", "Link");
      link.href = `https://github.com/${encodeURIComponent(actor.login)}`;

      const avatarWrap = document.createElement("span");
      avatarWrap.className = "prc-ActionList-LeadingVisual-NBr28 prc-ActionList-VisualWrap-bdCsS";
      avatarWrap.setAttribute("data-component", "ActionList.LeadingVisual");
      const avatar = document.createElement("img");
      avatar.className = "prc-Avatar-Avatar-0xaUi";
      avatar.setAttribute("data-component", "Avatar");
      avatar.setAttribute("data-testid", "github-avatar");
      avatar.alt = `@${actor.login}`;
      avatar.width = 20;
      avatar.height = 20;
      avatar.src = actor.avatarUrl || `https://github.com/${encodeURIComponent(actor.login)}.png?size=40`;
      avatarWrap.appendChild(avatar);

      const labelWrap = document.createElement("span");
      labelWrap.className = "prc-ActionList-ActionListSubContent-gKsFp";
      labelWrap.setAttribute("data-component", "ActionList.Item--DividerContainer");
      const label = document.createElement("span");
      label.className = "prc-ActionList-ItemLabel-81ohH";
      label.setAttribute("data-component", "ActionList.Item.Label");
      label.textContent = actor.login;
      labelWrap.appendChild(label);

      link.appendChild(avatarWrap);
      link.appendChild(labelWrap);
      item.appendChild(link);
      list.appendChild(item);
    });
  }

  function getGitHubSidebarAssigneeLogins() {
    const section = document.querySelector('[data-testid="sidebar-assignees-section"]');
    if (!section) return [];

    return Array.from(section.querySelectorAll('a[href^="https://github.com/"], a[href^="/"]'))
      .map(link => {
        try {
          const url = new URL(link.getAttribute("href") || "", window.location.origin);
          if (url.hostname !== "github.com") return "";
          const login = url.pathname.split("/").filter(Boolean)[0] || "";
          return normalizeGitHubAliasSearchText(login);
        } catch (error) {
          return "";
        }
      })
      .filter(Boolean);
  }

  function flushGitHubAssigneeAliasSelectionState(picker) {
    const state = githubAssigneeAliasSelectionState.get(picker);
    if (!state?.dirty || state.saving) return;

    state.saving = (async () => {
      let context = getGitHubAssignableContext();
      if (!state.issueId && !context?.issueId) {
        context = await fetchGitHubAssignableContext();
      }

      const issueId = state.issueId || context?.issueId || "";
      if (!issueId) {
        console.warn("[GitHub Handler] 未能取得 assignable id，无法保存自管 assignee 选择");
        throw new Error("未能取得 assignable id");
      }

      state.issueId = issueId;
      if (context?.assignedActors?.length && state.baseActors.size === 0) {
        state.baseActors = createGitHubAssigneeActorMap(context.assignedActors);
      }

      const sidebarAssigneeLogins = getGitHubSidebarAssigneeLogins();
      if (state.baseActors.size === 0 && sidebarAssigneeLogins.length > 0) {
        console.warn("[GitHub Handler] 无法读取当前 assignees 的 GitHub 用户 ID，取消自管保存以避免覆盖已有 assignees");
        throw new Error("无法读取当前 assignees 的 GitHub 用户 ID");
      }

      const pendingActors = Array.from(state.selectedActors.entries())
        .filter(([, actor]) => !actor?.id);
      for (const [normalizedLogin, actor] of pendingActors) {
        const resolvedActor = await fetchGitHubAssigneeActor(actor?.login || normalizedLogin, picker);
        if (resolvedActor?.id) {
          state.selectedActors.set(normalizedLogin, resolvedActor);
        }
      }

      const unresolvedActors = Array.from(state.selectedActors.values()).filter(actor => !actor?.id);
      if (unresolvedActors.length > 0) {
        throw new Error(`未能取得 GitHub 用户 ID: ${unresolvedActors.map(actor => actor.login).join(", ")}`);
      }

      const selectedActors = Array.from(state.selectedActors.values());
      const actorIds = Array.from(new Set(selectedActors.map(actor => actor.id)));
      await saveGitHubAssigneeActors(issueId, actorIds);
      state.dirty = false;
      state.baseActors = new Map(state.selectedActors);
      renderGitHubAssigneeSidebarActors(selectedActors);
    })()
      .catch(error => {
        state.saving = null;
        state.dirty = true;
        console.error("[GitHub Handler] 保存 assignee 失败:", error);
      });
  }

  function getGitHubAssigneeActorFromPicker(picker, login, item = null) {
    return (
      getCachedGitHubAssigneeActor(login) ||
      getGitHubAssigneeActorFromItem(item, login) ||
      getGitHubAssigneeActorFromItem(findNativeGitHubAssigneeItemByLogin(picker, login), login) ||
      normalizeGitHubAssigneeActor({ login }, login)
    );
  }

  function updateGitHubAssigneeItemActorStatus(item, actor) {
    if (!item || !actor?.id) return;

    item.setAttribute("data-lark-assignee-actor-id", actor.id);
    item.removeAttribute("data-lark-assignee-error");
    item.removeAttribute("title");
  }

  function maybeResolveGitHubAssigneeActorAfterSelection(picker, login, actor, item) {
    if (actor?.id) {
      updateGitHubAssigneeItemActorStatus(item, actor);
      return;
    }

    resolveGitHubAssigneeSelectedActor(picker, login, item);
  }

  function dispatchGitHubNativeAssigneeClick(nativeItem) {
    if (!nativeItem) return false;

    ["mousedown", "mouseup", "click"].forEach(eventName => {
      nativeItem.dispatchEvent(new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    });

    return true;
  }

  function waitForNativeGitHubAssigneeItemByLogin(picker, login, timeout = 1200) {
    const nativeItem = findNativeGitHubAssigneeItemByLogin(picker, login);
    if (nativeItem) return Promise.resolve(nativeItem);
    if (!picker) return Promise.resolve(null);

    return new Promise(resolve => {
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(findNativeGitHubAssigneeItemByLogin(picker, login));
      }, timeout);

      const observer = new MutationObserver(() => {
        const nextItem = findNativeGitHubAssigneeItemByLogin(picker, login);
        if (!nextItem) return;

        clearTimeout(timer);
        observer.disconnect();
        resolve(nextItem);
      });

      observer.observe(picker, {
        childList: true,
        subtree: true,
      });
    });
  }

  async function activateNativeGitHubAssigneeAliasResult(item, picker, login) {
    item?.setAttribute?.("aria-busy", "true");
    const nativeItem = await waitForNativeGitHubAssigneeItemByLogin(picker, login);
    item?.removeAttribute?.("aria-busy");
    if (!nativeItem) return false;

    const activated = dispatchGitHubNativeAssigneeClick(nativeItem);
    if (activated) {
      setTimeout(() => {
        const selected = nativeItem.getAttribute("aria-selected") === "true";
        item?.setAttribute?.("aria-selected", selected ? "true" : "false");
      }, 50);
    }

    return activated;
  }

  async function activateGitHubAssigneeAliasResult(item) {
    const login = item?.getAttribute?.("data-lark-assignee-login") || "";
    if (!login) return;

    const picker = item.closest('[data-testid="filtered-action-list"]');
    if (await activateNativeGitHubAssigneeAliasResult(item, picker, login)) {
      item.removeAttribute("data-lark-assignee-error");
      item.removeAttribute("title");
      return;
    }

    item.setAttribute("data-lark-assignee-error", "true");
    item.setAttribute("title", "未找到 GitHub 原生 assignee 结果，无法复用原生选择");
    console.warn("[GitHub Handler] 未找到 GitHub 原生 assignee 结果，无法复用原生选择:", login);
  }

  function buildGitHubAssigneeAliasDescription(userInfo, fallbackDescription = "") {
    const displayName = buildGitHubAssigneeAliasDisplayText(userInfo);
    const description = (fallbackDescription || "").trim();

    if (!displayName) return description;
    if (!description) return displayName;
    if (normalizeGitHubAliasSearchText(description) === normalizeGitHubAliasSearchText(displayName)) {
      return description;
    }

    return `${description} (${displayName})`;
  }

  function createGitHubAssigneeAliasResult(match, nativeItem = null) {
    const item = document.createElement("li");
    item.tabIndex = -1;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", nativeItem?.getAttribute("aria-selected") === "true" ? "true" : "false");
    item.setAttribute("data-component", "ActionList.Item");
    item.setAttribute("data-lark-assignee-login", match.login);
    if (match.actor?.id) {
      item.setAttribute("data-lark-assignee-actor-id", match.actor.id);
    }
    item.className = "github-assignee-alias-result prc-ActionList-ActionListItem-So4vC AssigneePickerBase-module__Item__krJon";

    const content = document.createElement("div");
    content.className = "prc-ActionList-ActionListContent-KBb8-";
    content.setAttribute("data-size", "medium");

    const spacer = document.createElement("span");
    spacer.className = "prc-ActionList-Spacer-4tR2m";
    content.appendChild(spacer);

    const selection = document.createElement("span");
    selection.className = "prc-ActionList-LeadingAction-hbWbh prc-ActionList-VisualWrap-bdCsS";
    selection.setAttribute("data-component", "ActionList.Selection");
    const checkbox = document.createElement("div");
    checkbox.className = "prc-ActionList-MultiSelectCheckbox-2OqxZ";
    selection.appendChild(checkbox);
    content.appendChild(selection);

    const avatarWrap = document.createElement("span");
    avatarWrap.className = "prc-ActionList-LeadingVisual-NBr28 prc-ActionList-VisualWrap-bdCsS";
    avatarWrap.setAttribute("data-component", "ActionList.LeadingVisual");
    const avatar = document.createElement("img");
    avatar.className = "prc-Avatar-Avatar-0xaUi";
    avatar.setAttribute("data-component", "Avatar");
    avatar.setAttribute("data-testid", "github-avatar");
    avatar.alt = "";
    avatar.width = 20;
    avatar.height = 20;
    avatar.src = `https://github.com/${encodeURIComponent(match.login)}.png?size=40`;
    avatar.style.setProperty("--avatarSize-regular", "20px");
    avatarWrap.appendChild(avatar);
    content.appendChild(avatarWrap);

    const subContent = document.createElement("span");
    subContent.className = "prc-ActionList-ActionListSubContent-gKsFp";
    subContent.setAttribute("data-component", "ActionList.Item--DividerContainer");

    const descriptionWrap = document.createElement("div");
    descriptionWrap.className = "prc-ActionList-ItemDescriptionWrap-ujC8S";
    descriptionWrap.setAttribute("data-description-variant", "inline");

    const label = document.createElement("span");
    label.className = "prc-ActionList-ItemLabel-81ohH";
    label.setAttribute("data-component", "ActionList.Item.Label");
    label.textContent = match.login;
    descriptionWrap.appendChild(label);

    const descriptionText = buildGitHubAssigneeAliasDescription(
      match.userInfo,
      getGitHubAssigneeItemDescription(nativeItem) || match.login
    );
    if (descriptionText) {
      const description = document.createElement("span");
      description.className = "prc-ActionList-Description-Z-EZJ";
      description.setAttribute("data-component", "ActionList.Description");
      description.textContent = descriptionText;
      descriptionWrap.appendChild(description);
    }

    subContent.appendChild(descriptionWrap);
    content.appendChild(subContent);
    item.appendChild(content);

    item.addEventListener("mousedown", event => {
      event.preventDefault();
    });
    item.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      activateGitHubAssigneeAliasResult(item);
    });
    item.addEventListener("mouseenter", () => {
      const picker = item.closest('[data-testid="filtered-action-list"]');
      const input = picker?.querySelector?.(GITHUB_ASSIGNEE_FILTER_INPUT_SELECTOR);
      const login = item.getAttribute("data-lark-assignee-login") || "";
      if (input && login) {
        prefetchGitHubAssigneeAliasResults(input, [{ login }]);
      }
    });

    return item;
  }

  function getLatestGitHubAssigneePickerRequestUrl() {
    try {
      const entries = performance.getEntriesByType("resource")
        .map(entry => entry.name)
        .filter(name => name.includes("/_ghui/item-pickers/assignees"));

      return entries.length > 0 ? entries[entries.length - 1] : "";
    } catch (error) {
      return "";
    }
  }

  function buildGitHubAssigneePickerFetchUrl(login) {
    const latestUrl = getLatestGitHubAssigneePickerRequestUrl();
    if (!latestUrl) return "";

    try {
      const url = new URL(latestUrl, window.location.origin);
      url.searchParams.set("query", resolveGitHubAssigneeLogin(login));
      return url.toString();
    } catch (error) {
      return "";
    }
  }

  function getGitHubFetchNonce() {
    if (githubFetchNonce) return githubFetchNonce;

    const meta = document.querySelector('meta[name="fetch-nonce"], meta[name="x-fetch-nonce"]');
    return meta?.getAttribute("content") || "";
  }

  function updateGitHubFetchNonce(response) {
    const nextNonce = response?.headers?.get?.("X-Fetch-Nonce");
    if (nextNonce) {
      githubFetchNonce = nextNonce;
    }
  }

  function getGitHubClientVersion() {
    return document.querySelector('meta[name="release"]')?.getAttribute("content") || "";
  }

  async function fetchGitHubAssigneePicker(login) {
    const resolvedLogin = resolveGitHubAssigneeLogin(login);
    const url = buildGitHubAssigneePickerFetchUrl(resolvedLogin);
    if (!url) return null;

    const headers = {
      accept: "application/json",
      "GitHub-Verified-Fetch": "true",
      "X-Requested-With": "XMLHttpRequest",
    };
    const fetchNonce = getGitHubFetchNonce();
    if (fetchNonce) {
      headers["X-Fetch-Nonce"] = fetchNonce;
    }

    const response = await fetch(url, {
      credentials: "include",
      headers,
    });
    updateGitHubFetchNonce(response);
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }

    return response.text();
  }

  function extractGitHubAssigneeActorFromResponse(value, login, seen = new WeakSet()) {
    const resolvedLogin = resolveGitHubAssigneeLogin(login);
    const normalizedLogin = normalizeGitHubAliasSearchText(resolvedLogin);
    if (!value || !normalizedLogin) return null;

    if (Array.isArray(value)) {
      for (const item of value) {
        const actor = extractGitHubAssigneeActorFromResponse(item, login, seen);
        if (actor?.id) return actor;
      }
      return null;
    }

    if (typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);

    const actor = normalizeGitHubAssigneeActor(value, resolvedLogin);
    if (
      actor?.id &&
      normalizeGitHubAliasSearchText(actor.login) === normalizedLogin
    ) {
      return cacheGitHubAssigneeActor(actor);
    }

    for (const item of Object.values(value)) {
      const nestedActor = extractGitHubAssigneeActorFromResponse(item, login, seen);
      if (nestedActor?.id) return nestedActor;
    }

    return null;
  }

  function collectGitHubAssigneeResponseHtml(value, htmlParts = []) {
    if (!value) return htmlParts;

    if (typeof value === "string") {
      if (
        value.includes("ActionList.Item") ||
        value.includes("AssigneePickerBase") ||
        value.includes("data-testid=\"github-avatar\"")
      ) {
        htmlParts.push(value);
      }
      return htmlParts;
    }

    if (Array.isArray(value)) {
      value.forEach(item => collectGitHubAssigneeResponseHtml(item, htmlParts));
      return htmlParts;
    }

    if (typeof value === "object") {
      Object.values(value).forEach(item => collectGitHubAssigneeResponseHtml(item, htmlParts));
    }

    return htmlParts;
  }

  function parseGitHubAssigneeResponseItems(responseData, login) {
    const resolvedLogin = resolveGitHubAssigneeLogin(login);
    const normalizedLogin = normalizeGitHubAliasSearchText(resolvedLogin);
    const htmlParts = collectGitHubAssigneeResponseHtml(responseData);
    const items = [];

    htmlParts.forEach(html => {
      const template = document.createElement("template");
      template.innerHTML = html;
      template.content.querySelectorAll('[data-component="ActionList.Item"][role="option"]').forEach(item => {
        if (normalizeGitHubAliasSearchText(getGitHubAssigneeItemLogin(item)) === normalizedLogin) {
          items.push(item);
        }
      });
    });

    return items;
  }

  async function fetchGitHubAssigneeActor(login, picker = null) {
    const resolvedLogin = resolveGitHubAssigneeLogin(login);
    const cachedActor = getCachedGitHubAssigneeActor(resolvedLogin);
    if (cachedActor?.id) return cachedActor;

    const responseData = await fetchGitHubAssigneePicker(resolvedLogin);
    const actor = extractGitHubAssigneeActorFromResponse(responseData, resolvedLogin);
    if (actor?.id) return actor;

    const input = picker?.querySelector?.(GITHUB_ASSIGNEE_FILTER_INPUT_SELECTOR);
    const items = parseGitHubAssigneeResponseItems(responseData, resolvedLogin);
    if (input && items.length > 0) {
      cacheGitHubAssigneeNativeItems(input, resolvedLogin, items);
    }

    for (const item of items) {
      const itemActor = getGitHubAssigneeActorFromItem(item, resolvedLogin);
      if (itemActor?.id) return itemActor;
    }

    return null;
  }

  function cacheGitHubAssigneeNativeItems(input, login, items) {
    if (!input || !items || items.length === 0) return false;

    const picker = input.closest('[data-testid="filtered-action-list"]');
    const listRoot = getOrCreateGitHubAssigneeAliasListRoot(picker);
    if (!picker || !listRoot) return false;

    const normalizedLogin = normalizeGitHubAliasSearchText(login);
    picker.querySelectorAll(".github-assignee-prefetched-native-result").forEach(item => {
      if (normalizeGitHubAliasSearchText(getGitHubAssigneeItemLogin(item)) === normalizedLogin) {
        item.remove();
      }
    });

    items.forEach(item => {
      const actor = getGitHubAssigneeActorFromItem(item, login);
      if (actor?.id) {
        item.setAttribute("data-lark-assignee-actor-id", actor.id);
      }
      item.classList.add("github-assignee-prefetched-native-result");
      listRoot.appendChild(item);
    });

    return true;
  }

  function getGitHubAssigneePrefetchState(input) {
    const query = input?.value || "";
    let state = githubAssigneeAliasPrefetchState.get(input);
    if (!state || state.query !== query) {
      state = {
        query,
        inFlight: new Set(),
        done: new Set(),
        queue: Promise.resolve(),
      };
      githubAssigneeAliasPrefetchState.set(input, state);
    }

    return state;
  }

  function prefetchGitHubAssigneeAliasResult(input, login, state) {
    const resolvedLogin = resolveGitHubAssigneeLogin(login);
    const normalizedLogin = normalizeGitHubAliasSearchText(resolvedLogin);
    if (
      !input ||
      !normalizedLogin ||
      input.value !== state.query ||
      state.inFlight.has(normalizedLogin) ||
      state.done.has(normalizedLogin)
    ) {
      return Promise.resolve();
    }

    const picker = input.closest('[data-testid="filtered-action-list"]');
    if (!picker || findNativeGitHubAssigneeItemByLogin(picker, resolvedLogin)) {
      state.done.add(normalizedLogin);
      return Promise.resolve();
    }

    state.inFlight.add(normalizedLogin);
    return fetchGitHubAssigneePicker(resolvedLogin)
      .then(responseData => {
        extractGitHubAssigneeActorFromResponse(responseData, resolvedLogin);
        const items = parseGitHubAssigneeResponseItems(responseData, resolvedLogin);
        cacheGitHubAssigneeNativeItems(input, resolvedLogin, items);
      })
      .finally(() => {
        state.done.add(normalizedLogin);
        state.inFlight.delete(normalizedLogin);

        if (input.isConnected && input.value === state.query) {
          renderGitHubAssigneeAliasResults(input);
        }
      });
  }

  function prefetchGitHubAssigneeAliasResults(input, matches) {
    if (!input || !matches || matches.length === 0) return;

    const state = getGitHubAssigneePrefetchState(input);
    const uniqueMatches = [];
    const seenLogins = new Set();
    matches.forEach(match => {
      const normalizedLogin = normalizeGitHubAliasSearchText(match.login);
      if (!normalizedLogin || seenLogins.has(normalizedLogin)) return;

      seenLogins.add(normalizedLogin);
      uniqueMatches.push(match);
    });

    state.queue = state.queue.then(async () => {
      for (const match of uniqueMatches) {
        await prefetchGitHubAssigneeAliasResult(input, match.login, state);
      }
    }).catch(error => {
      console.error("[GitHub Handler] 预热 assignee 搜索失败:", error);
    });
  }

  function getGitHubAssigneeActorForMatch(match, nativeItem = null) {
    const cachedActor = getCachedGitHubAssigneeActor(match.login);
    if (cachedActor?.id) return cachedActor;

    const nativeActor = getGitHubAssigneeActorFromItem(nativeItem, match.login);
    if (nativeActor?.id) return nativeActor;

    return normalizeGitHubAssigneeActor({
      login: match.login,
      name: buildGitHubAssigneeAliasDisplayText(match.userInfo),
      avatarUrl: `https://github.com/${encodeURIComponent(match.login)}.png?size=40`,
      profileResourcePath: `/${match.login}`,
    }, match.login);
  }

  function prepareGitHubAssigneeAliasMatch(match, nativeItem = null) {
    const actor = getGitHubAssigneeActorForMatch(match, nativeItem);
    if (actor?.id) {
      cacheGitHubAssigneeActor(actor);
    }

    return {
      ...match,
      actor,
    };
  }

  function renderGitHubAssigneeAliasResults(input) {
    const picker = input?.closest?.('[data-testid="filtered-action-list"]');
    if (!picker) return;

    bindGitHubAssigneeAliasPickerEvents(picker);
    resetGitHubAssigneeDuplicateItems(picker);
    removeGitHubAssigneeAliasResults(picker);
    resetGitHubAssigneeEmptyState(picker);

    const matches = findGitHubAssigneeAliasMatches(input.value || "");
    if (matches.length === 0) return;

    const listRoot = getOrCreateGitHubAssigneeAliasListRoot(picker);
    if (!listRoot) return;

    const nativeLogins = new Set(
      collectGitHubAssigneePickerItems(picker)
        .map(getGitHubAssigneeItemLogin)
        .map(normalizeGitHubAliasSearchText)
        .filter(Boolean)
    );

    const fragment = document.createDocumentFragment();
    const prefetchMatches = [];
    matches.forEach(match => {
      const normalizedLogin = normalizeGitHubAliasSearchText(match.login);
      const duplicateItem = findNativeGitHubAssigneeItemByLogin(picker, match.login);
      if (duplicateItem) {
        duplicateItem.setAttribute("data-lark-assignee-alias-duplicate", "true");
        duplicateItem.style.display = "none";
      } else {
        prefetchMatches.push(match);
      }

      if (!nativeLogins.has(normalizedLogin) || duplicateItem) {
        fragment.appendChild(createGitHubAssigneeAliasResult(
          prepareGitHubAssigneeAliasMatch(match, duplicateItem),
          duplicateItem
        ));
      }
    });

    if (fragment.childNodes.length > 0) {
      listRoot.insertBefore(fragment, listRoot.firstChild);
      syncGitHubAssigneeAliasResultSelection(picker);
      hideGitHubAssigneeEmptyState(picker);
      prefetchGitHubAssigneeAliasResults(input, prefetchMatches);
    }
  }

  function enhanceGitHubAssigneePickerItem(item) {
    const label = item.querySelector('[data-component="ActionList.Item.Label"]');
    if (!label) return false;

    const login = getGitHubAssigneeItemText(label).replace(/^@/, "");
    const userInfo = getGitHubUserInfoByLogin(login);
    const aliasText = buildGitHubAssigneeAliasDisplayText(userInfo);
    if (!aliasText) return false;

    const existingAlias = item.querySelector(".github-assignee-alias");
    const description = item.querySelector('[data-component="ActionList.Description"]:not(.github-assignee-alias)');
    const descriptionText = (description?.textContent || "").trim();
    const normalizedAliasText = normalizeGitHubAliasSearchText(aliasText);
    if (
      normalizedAliasText &&
      [login, descriptionText].some(text => normalizeGitHubAliasSearchText(text) === normalizedAliasText)
    ) {
      existingAlias?.remove();
      return false;
    }

    const aliasDisplayText = ` (${aliasText})`;

    if (existingAlias) {
      if (description && existingAlias.parentElement !== description) {
        description.appendChild(existingAlias);
      } else if (!description && existingAlias.parentElement !== label) {
        label.appendChild(existingAlias);
      }
      if (existingAlias.textContent !== aliasDisplayText) {
        existingAlias.textContent = aliasDisplayText;
      }
      return true;
    }

    const aliasSpan = document.createElement("span");
    aliasSpan.className = "github-assignee-alias";
    aliasSpan.setAttribute("data-lark-assignee-alias", "true");
    aliasSpan.textContent = aliasDisplayText;

    if (description) {
      description.appendChild(aliasSpan);
    } else {
      label.appendChild(aliasSpan);
    }

    return true;
  }

  function updateGitHubLegacyAssigneeSearchTokens(item, login, userInfo) {
    let tokenSpan = item.querySelector(".github-assignee-legacy-search-tokens");
    if (!tokenSpan) {
      tokenSpan = document.createElement("span");
      tokenSpan.className = "github-assignee-legacy-search-tokens sr-only";
      item.appendChild(tokenSpan);
    }

    const candidates = getGitHubAssigneeAliasCandidateTexts(login, userInfo, false);
    tokenSpan.textContent = candidates.length > 0 ? ` ${candidates.join(" ")} ` : "";
  }

  function enhanceGitHubLegacyAssigneeItem(item) {
    const login = getGitHubLegacyAssigneeItemLogin(item);
    if (!login) return false;

    cacheGitHubLegacyUserPickerItem(item);

    const userInfo = getGitHubUserInfoByLogin(login);
    if (!userInfo) return false;

    updateGitHubLegacyAssigneeSearchTokens(item, login, userInfo);

    const aliasText = buildGitHubAssigneeAliasDisplayText(userInfo);
    if (!aliasText) return false;

    const description = item.querySelector(".js-description");
    const username = item.querySelector(".js-username");
    const descriptionText = getGitHubLegacyAssigneeItemDescription(item);
    const normalizedAliasText = normalizeGitHubAliasSearchText(aliasText);
    if (
      normalizedAliasText &&
      [login, descriptionText].some(text => normalizeGitHubAliasSearchText(text) === normalizedAliasText)
    ) {
      item.querySelector(".github-assignee-alias")?.remove();
      return true;
    }

    const existingAlias = item.querySelector(".github-assignee-alias");
    const aliasDisplayText = descriptionText ? ` (${aliasText})` : aliasText;
    const aliasParent = description || username;
    if (!aliasParent) return false;

    if (existingAlias) {
      if (existingAlias.parentElement !== aliasParent) {
        aliasParent.appendChild(existingAlias);
      }
      if (existingAlias.textContent !== aliasDisplayText) {
        existingAlias.textContent = aliasDisplayText;
      }
      return true;
    }

    const aliasSpan = document.createElement("span");
    aliasSpan.className = "github-assignee-alias";
    aliasSpan.setAttribute("data-lark-assignee-alias", "true");
    aliasSpan.textContent = aliasDisplayText;
    aliasParent.appendChild(aliasSpan);
    return true;
  }

  function showGitHubLegacyAssigneeItem(item) {
    item.removeAttribute(GITHUB_LEGACY_ALIAS_HIDDEN_ATTRIBUTE);
    item.hidden = false;
    item.removeAttribute("aria-hidden");
    item.classList.remove("d-none", "js-hidden");
    item.style.display = "";

    let previous = item.previousElementSibling;
    while (previous) {
      if (previous.matches?.(".select-menu-item[role='menuitemcheckbox']")) return;
      if (previous.matches?.(".select-menu-divider")) {
        previous.hidden = false;
        previous.removeAttribute("aria-hidden");
        previous.classList.remove("d-none", "js-hidden");
        previous.style.display = "";
        return;
      }
      previous = previous.previousElementSibling;
    }
  }

  function setGitHubLegacyAssigneeNoResultsHidden(menu, hidden) {
    const noResults = menu?.querySelector?.(".select-menu-no-results");
    if (!noResults) return;

    noResults.toggleAttribute("data-lark-assignee-empty-hidden", hidden);
    noResults.style.display = hidden ? "none" : "";
  }

  function applyGitHubLegacyAssigneeAliasFilter(input) {
    const menu = getGitHubLegacyAssigneeMenu(input);
    if (!menu) return;
    if (isGitHubLegacyIssueAssigneeMenu(menu)) {
      applyGitHubLegacyIssueAssigneeFallback(input);
      return;
    }
    if (!isGitHubLegacyReviewerMenu(menu)) return;

    const normalizedQuery = normalizeGitHubAliasSearchText(input.value || "");
    if (!normalizedQuery) {
      clearGitHubLegacyUserPickerAliasMatches(input, { restore: true });
      setGitHubLegacyAssigneeNoResultsHidden(menu, false);
      return;
    }

    const itemsByLogin = new Map();
    [
      ...getGitHubLegacyUserPickerCachedItems(menu),
      ...collectGitHubLegacyAssigneeItems(menu),
    ].forEach(item => {
      const normalizedLogin = normalizeGitHubAliasSearchText(getGitHubLegacyAssigneeItemLogin(item));
      if (normalizedLogin && !itemsByLogin.has(normalizedLogin)) {
        itemsByLogin.set(normalizedLogin, item);
      }
    });

    const matchedItems = [];
    itemsByLogin.forEach(item => {
      if (isGitHubLegacyAssigneeAliasItemMatch(item, normalizedQuery)) {
        matchedItems.push(item);
      }
    });

    if (matchedItems.length > 0) {
      if (!showGitHubLegacyAssigneeItemsAtTop(input, matchedItems)) {
        matchedItems.forEach(showGitHubLegacyAssigneeItem);
      }
      setGitHubLegacyAssigneeNoResultsHidden(menu, true);
    } else {
      clearGitHubLegacyUserPickerAliasMatches(input);
      setGitHubLegacyAssigneeNoResultsHidden(menu, false);
    }
  }

  function refreshGitHubLegacyAssigneeAliasFilter(input) {
    const menu = getGitHubLegacyAssigneeMenu(input);
    if (!menu) return;

    enhanceGitHubLegacyAssigneeItems(menu);
    applyGitHubLegacyAssigneeAliasFilter(input);
  }

  function scheduleGitHubLegacyAssigneeAliasFilter(input) {
    const existingTimers = githubLegacyUserPickerFilterTimers.get(input) || [];
    existingTimers.forEach(timer => window.clearTimeout(timer));

    refreshGitHubLegacyAssigneeAliasFilter(input);
    const timers = [
      window.setTimeout(() => refreshGitHubLegacyAssigneeAliasFilter(input), 0),
      window.setTimeout(() => refreshGitHubLegacyAssigneeAliasFilter(input), 120),
      window.setTimeout(() => {
        refreshGitHubLegacyAssigneeAliasFilter(input);
        githubLegacyUserPickerFilterTimers.delete(input);
      }, 500),
    ];
    githubLegacyUserPickerFilterTimers.set(input, timers);
  }

  function handleGitHubAssigneeFilterInput(input) {
    if (!input) return;

    ensureGitHubUserAliasMap().then(aliasMap => {
      if (!aliasMap || aliasMap.size === 0) {
        return;
      }

      renderGitHubAssigneeAliasResults(input);
      scheduleGitHubLegacyAssigneeAliasFilter(input);
      debugGitHubLog("githubAssigneePicker:renderAliasResults", {
        query: input.value || "",
      });
    });
  }

  function bindGitHubAssigneeFilterInput(input) {
    if (!input || githubAssigneeFilterInputs.has(input)) return;

    githubAssigneeFilterInputs.add(input);
    const legacyMenu = getGitHubLegacyAssigneeMenu(input);
    if (legacyMenu && !githubLegacyUserPickerMenus.has(legacyMenu)) {
      githubLegacyUserPickerMenus.add(legacyMenu);
      legacyMenu.addEventListener("filterable:change", event => {
        const filterableFor = event.target?.getAttribute?.("data-filterable-for") || "";
        const filterInput = filterableFor ? document.getElementById(filterableFor) : null;
        if (isGitHubLegacyAssigneeFilterInput(filterInput)) {
          scheduleGitHubLegacyAssigneeAliasFilter(filterInput);
        }
      }, true);
    }

    input.addEventListener("focus", () => {
      ensureGitHubUserAliasMap().then(() => {
        renderGitHubAssigneeAliasResults(input);
        scheduleGitHubLegacyAssigneeAliasFilter(input);
        enhanceGitHubAssigneePickerItems(document.body);
      });
    });
    input.addEventListener("input", () => {
      handleGitHubAssigneeFilterInput(input);
    });
  }

  function enhanceGitHubAssigneePickerItems(root = document.body) {
    const items = collectGitHubAssigneePickerItems(root);
    items.forEach(enhanceGitHubAssigneePickerItem);
    return items.length;
  }

  function enhanceGitHubLegacyAssigneeItems(root = document.body) {
    const items = collectGitHubLegacyAssigneeItems(root);
    items.forEach(enhanceGitHubLegacyAssigneeItem);
    return items.length;
  }

  function scanGitHubAssigneePickers(root = document.body) {
    const inputs = collectGitHubAssigneeFilterInputs(root);
    const items = [
      ...collectGitHubAssigneePickerItems(root),
      ...collectGitHubLegacyAssigneeItems(root),
    ];
    if (inputs.length === 0 && items.length === 0) return;

    inputs.forEach(bindGitHubAssigneeFilterInput);

    if (githubUserAliasState.map.size > 0) {
      inputs.forEach(renderGitHubAssigneeAliasResults);
      inputs.forEach(scheduleGitHubLegacyAssigneeAliasFilter);
      enhanceGitHubAssigneePickerItems(root);
      enhanceGitHubLegacyAssigneeItems(root);
      return;
    }

    ensureGitHubUserAliasMap().then(() => {
      inputs.forEach(renderGitHubAssigneeAliasResults);
      inputs.forEach(scheduleGitHubLegacyAssigneeAliasFilter);
      enhanceGitHubAssigneePickerItems(document.body);
      enhanceGitHubLegacyAssigneeItems(document.body);
    });
  }

  function scheduleGitHubAssigneePickerScan(delay = 50) {
    if (githubAssigneePickerScanTimer) {
      clearTimeout(githubAssigneePickerScanTimer);
    }

    githubAssigneePickerScanTimer = setTimeout(() => {
      githubAssigneePickerScanTimer = null;
      scanGitHubAssigneePickers(document.body);
    }, delay);
  }

  function hasGitHubAssigneePickerNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.matches?.(".github-assignee-alias, .github-assignee-alias-list, .github-assignee-alias-result")) return false;
    if (node.closest?.(".github-assignee-alias-list, .github-assignee-alias-result")) return false;

    if (isGitHubAssigneeFilterInput(node)) return true;
    if (node.querySelector?.(GITHUB_ASSIGNEE_FILTER_INPUT_SELECTOR)) return true;
    if (node.querySelector?.(GITHUB_LEGACY_ASSIGNEE_FILTER_INPUT_SELECTOR)) return true;
    if (getGitHubLegacyAssigneeMenu(node)) return true;
    if (node.closest?.('[data-testid="filtered-action-list"]')) return true;

    return Boolean(node.matches?.(
      '[data-testid="filtered-action-list"], [data-testid="item-picker-root"], [data-component="ActionList.Item"][role="option"], details-menu.select-menu-modal, .select-menu-item[role="menuitemcheckbox"]'
    ));
  }

  function collectRemovedGitHubAssigneePickers(node, pickerSet) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

    if (node.matches?.('[data-testid="filtered-action-list"]')) {
      pickerSet.add(node);
    }

    node.querySelectorAll?.('[data-testid="filtered-action-list"]').forEach(picker => {
      pickerSet.add(picker);
    });
  }

  function ensureGitHubAssigneePickerObserver() {
    if (githubAssigneePickerObserver) {
      return;
    }

    githubAssigneePickerObserver = new MutationObserver((mutations) => {
      const removedPickers = new Set();
      mutations.forEach(mutation => {
        mutation.removedNodes.forEach(node => {
          collectRemovedGitHubAssigneePickers(node, removedPickers);
        });
      });
      removedPickers.forEach(flushGitHubAssigneeAliasSelectionState);

      const shouldScan = mutations.some(mutation => {
        return Array.from(mutation.addedNodes).some(hasGitHubAssigneePickerNode);
      });

      if (shouldScan) {
        scheduleGitHubAssigneePickerScan();
      }
    });

    githubAssigneePickerObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    scanGitHubAssigneePickers(document.body);
  }

  function ensureGitHubHovercardObserver() {
    if (githubUserHovercardObserver) {
      return;
    }

    githubUserHovercardObserver = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          const hovercard = getGitHubHovercardContainerFromAddedNode(node);
          if (hovercard) {
            ensureGitHubUserAliasMap().then(() => {
              enhanceGitHubHovercard(hovercard);
            });
          }
        });
      });
    });

    githubUserHovercardObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  async function replaceGitHubUserAliases() {
    debugGitHubLog("replaceGitHubUserAliases:start");
    const aliasMap = await ensureGitHubUserAliasMap();
    if (!aliasMap || aliasMap.size === 0) {
      debugGitHubLog("replaceGitHubUserAliases:empty");
      return;
    }

    ensureGitHubHovercardObserver();
    const containers = collectGitHubHovercardContainers(document.body);
    containers.forEach(enhanceGitHubHovercard);
    debugGitHubLog("replaceGitHubUserAliases:done", {
      aliasCount: aliasMap.size,
      hovercardCount: containers.length,
    });
  }

  return {
    init,
    replaceGitHubCommits,
    replaceGitHubPullRequests,
    replaceGitHubUserAliases
  };
}
