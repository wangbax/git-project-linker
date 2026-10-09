/**
 * GitLab & GitHub 飞书项目链接插件 - 主入口
 * 
 * 功能：
 * - 自动识别并替换页面中的项目 ID（如 #XX-6667127317）为可点击的飞书链接
 * - 支持 GitLab 和 GitHub 两个平台
 * - 智能缓存项目类型（story/issue）
 * - 显示项目信息 tooltip
 * 
 * 架构：
 * - index.js: 核心通用功能
 * - gitlab-handler.js: GitLab 平台特定处理
 * - github-handler.js: GitHub 平台特定处理
 */

import { 
  getLarkConfig, 
  getLarkConfigSync,
  loadCacheFromStorage,
  saveCacheToStorage,
  cleanExpiredCache
} from "./store";
import { checkCondition, LARK_DOMAIN_HOST } from "./utils";
import { MSG_EVENT } from "./event";
import { createGitLabHandler } from "./gitlab-handler";
import { createGitHubHandler } from "./github-handler";

main();

async function main() {
  if (!(await checkCondition())) return;

  const isGitHub = window.location.host.includes('github.com');
  const isGitHubPullRequestPage = isGitHub && /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(window.location.pathname);

  // ==================== 全局状态 ====================
  
  // 缓存项目信息
  let cacheMap = new Map();
  
  // Popover 配置
  const POPOVER_STYLE_ID = "lark-popover-link-style";
  let dom_lark_popover = null;

  // 已处理的 DOM 节点
  const nodeMap = new WeakSet();
  
  // 已处理的元素（用 WeakSet 追踪）
  const processedElements = new WeakSet();

  // 记录每个 tid 的实际类型
  const tidTypeMap = new Map();

  // 检测当前平台
  const isGitLab = window.location.host.includes('gitlab');
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

  // ==================== 缓存管理 ====================
  
  // 从 store.js 加载缓存
  const cacheData = await loadCacheFromStorage();
  // 将加载的缓存数据合并到 tidTypeMap 和 cacheMap
  cacheData.tidTypeMap.forEach((value, key) => tidTypeMap.set(key, value));
  cacheData.cacheMap.forEach((value, key) => cacheMap.set(key, value));

  // ==================== 消息监听 ====================
  
  chrome.runtime.onMessage.addListener(function (e) {
    const { message, data } = e;
    switch (message) {
      case MSG_EVENT.GET_LARK_PROJECT_INFO:
        cacheMap.set(data.tid, {
          locker: true,
          error: data.error,
          data: data.data,
        });

        if (data.actualType) {
          updateLinksWithCorrectType(data.tid, data.actualType, data.app);
          saveCacheToStorage(data.tid, data.actualType, data.data);
        }
        break;
    }
  });

  // ==================== Popover 功能 ====================
  
  initPopover();

  function initPopover() {
    if (document.getElementById(POPOVER_STYLE_ID)) return;
    
    const style = document.createElement("style");
    style.id = POPOVER_STYLE_ID;
    style.innerHTML = `
    .lark-project-link {
      padding: 0 2px;
      text-decoration: none;
      position: relative;
      transition: all .2s;
    }
    .lark-project-link:hover {
      text-decoration: none;
      background-color: #a1d1fc;
    }
    .github-lark-id {
      padding: 0 2px;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
      transition: all .2s;
    }
    .github-lark-id:hover {
      background-color: #a1d1fc;
      text-decoration: none;
    }
    .lark-popover {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      background-color: #000;
      color: #fff;
      padding: 6px 8px;
      border-radius: 3px;
      z-index: 9999;
      font-size: 12px;
      line-height: 1.4;
      white-space: nowrap;
      pointer-events: none;
    }
    .lark-popover::after {
      content: "";
      position: absolute;
      bottom: -6px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 6px solid #000;
    }
    .lark-popover-show {
      display: block;
    }
    .lark-popover-hide {
      display: none;
    }
  `;
    document.head.appendChild(style);
    
    const div = document.createElement("div");
    div.classList.add("lark-popover");
    document.body.appendChild(div);
    dom_lark_popover = div;
  }

  function enterHandler(e) {
    const rect = e.target.getBoundingClientRect();
    const tid = e.target.dataset.tid;
    const larkType = e.target.dataset.larkType || "story";
    const cache = cacheMap.get(tid);

    let innerHTML = larkType === "issue" ? "Issue in Lark" : "Story in Lark";

    if (cache) {
      if (cache.data) {
        innerHTML = cache.data.name;
      } else if (cache.error) {
        innerHTML = "未找到相关信息";
      }
    }
    dom_lark_popover.innerHTML = innerHTML;

    dom_lark_popover.classList.remove("lark-popover-hide");
    dom_lark_popover.classList.add("lark-popover-show");

    const linkCenterX = rect.x + rect.width / 2;
    dom_lark_popover.style.setProperty("top", `${rect.y}px`);
    dom_lark_popover.style.setProperty("left", `${linkCenterX}px`);
    dom_lark_popover.style.setProperty("transform", `translate(-50%, calc(-100% - 8px))`);
  }

  function leaveHandler() {
    dom_lark_popover.classList.remove("lark-popover-show");
  }

  function bindPopoverEvent(dom) {
    dom.addEventListener("mouseenter", enterHandler);
    dom.addEventListener("mouseleave", leaveHandler);
  }

  // ==================== 链接生成与更新 ====================
  
  function isLarkEnabled() {
    return getLarkConfigSync()?.lark?.enabled === true;
  }

  function getLarkProjectLink(projectId, type = "story", appOverride = "") {
    const LarkConfig = getLarkConfigSync();
    if (!LarkConfig || !isLarkEnabled() || !LarkConfig.app) return "";

    const configuredApp = Array.isArray(LarkConfig.lark?.namespaces)
      ? LarkConfig.lark.namespaces[0]
      : String(LarkConfig.app).split(",")[0].trim();
    const app = appOverride || configuredApp;
    if (!app) return "";

    if (type === "issue")
      return `${LARK_DOMAIN_HOST}/${app}/issue/detail/${projectId}`;
    return `${LARK_DOMAIN_HOST}/${app}/story/detail/${projectId}`;
  }

  function fetchLarkProjectInfo(data) {
    if (!isLarkEnabled()) return;

    const { app, tid } = data;

    if (cacheMap.has(tid) && cacheMap.get(tid).locker) {
      return;
    }

    const cachedType = tidTypeMap.get(tid);
    if (cachedType) {
      updateLinksWithCorrectType(tid, cachedType);
    }

    cacheMap.set(tid, {
      locker: true,
      error: false,
      data: cacheMap.get(tid)?.data || null,
    });

    chrome.runtime.sendMessage({
      message: MSG_EVENT.GET_LARK_PROJECT_INFO,
      data: {
        app,
        tid,
      },
    });
  }

  function updateLinksWithCorrectType(tid, actualType, appOverride = "") {
    const LarkConfig = getLarkConfigSync();
    if (!LarkConfig || !isLarkEnabled()) return;

    tidTypeMap.set(tid, actualType);

    // 更新 GitLab 的链接
    const links = document.querySelectorAll(`a[data-tid="${tid}"]`);
    links.forEach(link => {
      // 检查父元素是否是导航链接
      const parentIsNavigationLink = 
        link.parentElement?.classList.contains('js-prefetch-document') ||
        link.parentElement?.classList.contains('js-navigation-open') ||
        link.parentElement?.id?.startsWith('issue_') ||
        link.parentElement?.id?.startsWith('merge_request_') ||
        link.parentElement?.closest('.js-issue-row') !== null ||
        link.parentElement?.closest('.mr-list, .issuable-list') !== null;
      
      if (parentIsNavigationLink) {
        // 这是导航链接内部的飞书链接，只更新类型和 URL，不移除属性
        const projectId = tid.split("-")[1];
        const url = getLarkProjectLink(projectId, actualType, appOverride);
        if (link.href !== url) {
          link.href = url;
        }
        link.dataset.larkType = actualType;
        return;
      }
      
      const projectId = tid.split("-")[1];
      const url = getLarkProjectLink(projectId, actualType, appOverride);
      if (link.href !== url) {
        link.href = url;
      }
      link.dataset.larkType = actualType;
    });

    // 更新 GitHub 的链接
    const githubSpans = document.querySelectorAll(`span.github-lark-id[data-tid="${tid}"]`);
    githubSpans.forEach(span => {
      const projectId = tid.split("-")[1];
      const url = getLarkProjectLink(projectId, actualType, appOverride);
      span.dataset.larkType = actualType;
      span.dataset.larkUrl = url;
    });
  }

  // ==================== 工具函数 ====================
  
  function removeGitLabTooltipAttributes(element) {
    element.removeAttribute('aria-describedby');
    element.removeAttribute('data-original-title');
    element.removeAttribute('title');
    element.removeAttribute('aria-label');
    element.classList.remove('has-tooltip');
    element.removeAttribute('data-hovercard-type');
    element.removeAttribute('data-hovercard-url');
  }

  function getContextText(link) {
    let contextElement = link.parentElement;

    for (let i = 0; i < 5 && contextElement; i++) {
      const tagName = contextElement.tagName.toLowerCase();
      if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3' ||
        tagName === 'p' || tagName === 'li' || tagName === 'td' ||
        contextElement.classList.contains('commit-row-message') ||
        contextElement.classList.contains('commit-content') ||
        contextElement.classList.contains('commit-detail') ||
        contextElement.classList.contains('title')) {
        return contextElement.textContent || '';
      }
      contextElement = contextElement.parentElement;
    }

    const commitContent = link.closest('.commit-content, .commit-detail, .commit');
    if (commitContent) {
      const commitMessage = commitContent.querySelector('.commit-row-message, .commit-row-description');
      if (commitMessage) {
        return commitMessage.textContent + ' ' + link.textContent;
      }
    }

    let previousText = '';
    let prevNode = link.previousSibling;
    for (let i = 0; i < 3 && prevNode; i++) {
      if (prevNode.nodeType === Node.TEXT_NODE) {
        previousText = prevNode.textContent + previousText;
      } else if (prevNode.nodeType === Node.ELEMENT_NODE) {
        previousText = prevNode.textContent + previousText;
      }
      prevNode = prevNode.previousSibling;
    }

    if (previousText.trim()) {
      return previousText + ' ' + link.textContent;
    }

    return link.parentElement?.textContent || link.textContent;
  }

  function replaceLarkLinks(dom) {
    const LarkConfig = getLarkConfigSync();
    if (!LarkConfig || !isLarkEnabled()) {
      return false;
    }

    const prefixes = LarkConfig?.prefixes || "m,f";
    const prefixList = prefixes.split(",").map(p => p.trim().toLowerCase()).filter(p => p);
    const reg = new RegExp(`^(${prefixList.join("|")})-\\d{7,}$`, "i");

    let hasReplaced = false;
    let issueLinks = [];

    const linkSelector = isGitHub 
      ? 'a.issue-link, a[data-hovercard-type="issue"], a[data-hovercard-type="pull_request"]'
      : 'a.gfm.gfm-issue, a.gfm-issue, a.js-prefetch-document';

    if (dom.tagName === 'A' && (
      dom.classList.contains('gfm-issue') || 
      dom.classList.contains('gfm') || 
      dom.classList.contains('issue-link') ||
      dom.hasAttribute('data-hovercard-type')
    )) {
      issueLinks = [dom];
    } else {
      issueLinks = dom.querySelectorAll(linkSelector);
    }

    Array.from(issueLinks).forEach(link => {
      if (isGitHub && isIgnoredGitHubDynamicNode(link)) {
        return;
      }

      const text = link.textContent.trim();
      const match = text.match(new RegExp(`(${prefixList.join("|")})-\\d{7,}`, "i"));

      if (match) {
        const tid = match[0];
        const projectId = tid.split("-")[1];
        const prefix = tid.split("-")[0].toLowerCase();

        let type = "story";
        if (prefix === "m") {
          type = "story";
        } else if (prefix === "f") {
          type = "issue";
        }

        const url = getLarkProjectLink(projectId, type);

        // 检查是否是导航链接（MR 列表、Issue 列表等）
        const isNavigationLink = 
          link.classList.contains('js-prefetch-document') ||
          link.classList.contains('js-navigation-open') ||
          link.id?.startsWith('issue_') ||
          link.id?.startsWith('merge_request_') ||
          link.closest('.js-issue-row') !== null ||
          link.closest('.mr-list, .issuable-list') !== null;

        if (isGitHub && isNavigationLink) {
          return;
        }

        if (isNavigationLink) {
          // 对于导航链接，在其内部替换文本为飞书链接
          const [isFind, newContent] = replaceProjectIdToLarkProjectLink(link);
          if (isFind) {
            link.innerHTML = newContent;
            // 为新创建的飞书链接绑定事件
            const larkLinks = link.querySelectorAll('.lark-project-link');
            larkLinks.forEach(larkLink => {
              bindPopoverEvent(larkLink);
            });
            hasReplaced = true;
          }
        } else {
          // 对于非导航链接（如 gfm-issue 引用），直接修改 href
          link.href = url;
          link.target = "_blank";
          link.classList.add('lark-project-link');
          link.dataset.tid = tid;
          link.dataset.larkType = type;

          removeGitLabTooltipAttributes(link);

          fetchLarkProjectInfo({
            tid: tid,
            app: LarkConfig.app,
          });

          bindPopoverEvent(link);
          hasReplaced = true;
        }
      }
    });

    return hasReplaced;
  }

  function replaceProjectIdToLarkProjectLink(dom, className) {
    const LarkConfig = getLarkConfigSync();
    if (!LarkConfig || !isLarkEnabled()) {
      return [false, dom?.innerHTML || ""];
    }

    const prefixes = LarkConfig?.prefixes || "m,f";
    const prefixList = prefixes.split(",").map(p => p.trim().toLowerCase()).filter(p => p);
    const reg = new RegExp(`#(${prefixList.join("|")})-\\d{7,}`, "gi");

    const contextText = dom.textContent || dom.innerText || "";
    const lowerContext = contextText.toLowerCase();

    let isFind = false;
    const content = dom.innerHTML.replace(reg, ($0, $1) => {
      const fullMatch = $0;
      const tid = fullMatch.substring(1);
      const projectId = tid.split("-")[1];
      const prefix = tid.split("-")[0].toLowerCase();
      isFind = true;

      let type = tidTypeMap.get(tid);

      if (!type) {
        if (prefix === "m") {
          type = "story";
        } else if (prefix === "f") {
          type = "issue";
        } else {
          type = "story";
          
          if (/^(fix|bugfix|hotfix|bug)[\s:]/i.test(lowerContext)) {
            type = "issue";
          } else if (/^(feat|feature)[\s:]/i.test(lowerContext)) {
            type = "story";
          } else if (/^(chore|refactor|perf|style|test|docs|build|ci)[\s:]/i.test(lowerContext)) {
            type = "story";
          }
        }
        
        tidTypeMap.set(tid, type);
      }

      const url = getLarkProjectLink(projectId, type);
      fetchLarkProjectInfo({
        tid: tid,
        app: LarkConfig.app,
      });
      return `<a class='lark-project-link ${className ? className : ""
        }' href='${url}' target='_blank' data-tid="${tid}" data-lark-type="${type}" >${fullMatch}</a>`;
    });
    return [isFind, content];
  }

  // ==================== 全局扫描 ====================
  
  function scanAllGfmLinks() {
    if (!isLarkEnabled()) return;

    const selector = isGitHub 
      ? 'a.issue-link, a[data-hovercard-type="issue"], a[data-hovercard-type="pull_request"]'
      : 'a.gfm.gfm-issue, a.js-prefetch-document';
    
    const allGfmLinks = document.querySelectorAll(selector);

    allGfmLinks.forEach(link => {
      if (isGitHub && isIgnoredGitHubDynamicNode(link)) {
        processedElements.add(link);
        return;
      }

      const alreadyProcessed = processedElements.has(link) || link.classList.contains('lark-project-link');

      if (alreadyProcessed) {
        const currentTid = link.dataset.tid;
        const currentType = link.dataset.larkType;
        const correctType = tidTypeMap.get(currentTid);

        if (correctType && currentType !== correctType) {
          const projectId = currentTid.split("-")[1];
          const url = getLarkProjectLink(projectId, correctType);
          link.href = url;
          link.dataset.larkType = correctType;
          processedElements.add(link);
        }
        return;
      }

      const LarkConfig = getLarkConfigSync();
      if (!LarkConfig) return;

      const prefixes = LarkConfig?.prefixes || "m,f";
      const prefixList = prefixes.split(",").map(p => p.trim().toLowerCase()).filter(p => p);
      const text = link.textContent.trim();
      const match = text.match(new RegExp(`(${prefixList.join("|")})-\\d{7,}`, "i"));

      if (match) {
        const tid = match[0];
        const projectId = tid.split("-")[1];
        const prefix = tid.split("-")[0].toLowerCase();

        let type = tidTypeMap.get(tid);

        if (!type) {
          type = "story";

          if (prefix === "m") {
            type = "story";
          } else if (prefix === "f") {
            type = "issue";
          } else {
            const contextText = getContextText(link);
            const lowerContext = contextText.toLowerCase();

            if (/\b(fix|bugfix|hotfix|bug)[\s:]/i.test(lowerContext)) {
              type = "issue";
            } else if (/\b(feat|feature)[\s:]/i.test(lowerContext)) {
              type = "story";
            } else if (/\b(chore|refactor|perf|style|test|docs|build|ci)[\s:]/i.test(lowerContext)) {
              type = "story";
            }
          }

          tidTypeMap.set(tid, type);
        }

        const url = getLarkProjectLink(projectId, type);

        // 检查是否是导航链接（MR 列表、Issue 列表等）
        const isNavigationLink = 
          link.classList.contains('js-prefetch-document') ||
          link.classList.contains('js-navigation-open') ||
          link.id?.startsWith('issue_') ||
          link.id?.startsWith('merge_request_') ||
          link.closest('.js-issue-row') !== null ||
          link.closest('.mr-list, .issuable-list') !== null;

        if (isGitHub && isNavigationLink) {
          processedElements.add(link);
          return;
        }

        if (isNavigationLink) {
          // 对于导航链接，在其内部替换文本为飞书链接
          const [isFind, newContent] = replaceProjectIdToLarkProjectLink(link);
          if (isFind) {
            link.innerHTML = newContent;
            // 为新创建的飞书链接绑定事件
            const larkLinks = link.querySelectorAll('.lark-project-link');
            larkLinks.forEach(larkLink => {
              bindPopoverEvent(larkLink);
            });
          }
        } else {
          // 对于非导航链接（如 gfm-issue 引用），直接修改 href
          link.href = url;
          link.target = "_blank";
          link.classList.add('lark-project-link');
          link.dataset.tid = tid;
          link.dataset.larkType = type;

          removeGitLabTooltipAttributes(link);

          fetchLarkProjectInfo({
            tid: tid,
            app: LarkConfig.app,
          });

          bindPopoverEvent(link);
        }

        processedElements.add(link);
      }
    });
  }

  // ==================== 创建上下文对象 ====================
  
  const context = {
    nodeMap,
    tidTypeMap,
    cacheMap,
    processedElements,
    getLarkProjectLink,
    fetchLarkProjectInfo,
    bindPopoverEvent,
    replaceLarkLinks,
    replaceProjectIdToLarkProjectLink,
    getLarkConfigSync,
    enterHandler,
    leaveHandler,
    removeGitLabTooltipAttributes,
    getContextText,
    isGitHubPullRequestPage
  };

  // ==================== 初始化平台处理器 ====================
  
  let platformHandler;
  
  if (isGitLab) {
    platformHandler = createGitLabHandler(context);
    platformHandler.init();
  } else if (isGitHub) {
    platformHandler = createGitHubHandler(context);
    platformHandler.init();
  }

  // ==================== 通用监听 ====================

  function scanCurrentPage() {
    if (!isGitHubPullRequestPage) {
      scanAllGfmLinks();
    }

    if (platformHandler && isGitHub) {
      platformHandler.replaceGitHubCommits();
      platformHandler.replaceGitHubPullRequests({
        observeTitle: !isGitHubPullRequestPage,
      });
    }
  }

  // 立即执行一次全局扫描
  scanCurrentPage();

  // 防抖扫描
  let scanTimer = null;
  const debugCounters = new Map();
  const debugEntries = [];
  let debugFlushTimer = null;

  function isDebugEnabled() {
    try {
      return window.localStorage?.getItem("LARK_LINKER_DEBUG") === "1" ||
        new URLSearchParams(window.location.search).has("lark_linker_debug");
    } catch (error) {
      return false;
    }
  }

  function scheduleDebugFlush() {
    if (debugFlushTimer || typeof chrome === "undefined" || !chrome.storage?.local) return;

    debugFlushTimer = setTimeout(() => {
      debugFlushTimer = null;
      try {
        const result = chrome.storage.local.set({
          LARK_LINKER_DEBUG_LOGS_CORE: debugEntries,
        });
        if (result?.catch) {
          result.catch(() => {});
        }
      } catch (error) {
        // Debug logging must never affect the page.
      }
    }, 500);
  }

  function debugLog(label, data = {}) {
    if (!isDebugEnabled()) return;

    const count = (debugCounters.get(label) || 0) + 1;
    debugCounters.set(label, count);
    console.debug("[Lark Linker]", label, {
      count,
      url: window.location.href,
      ...data,
    });

    debugEntries.push({
      at: new Date().toISOString(),
      label,
      count,
      url: window.location.href,
      ...data,
    });
    if (debugEntries.length > 100) {
      debugEntries.shift();
    }
    scheduleDebugFlush();
  }

  function debouncedScanAllGfmLinks() {
    debugLog("debouncedScanAllGfmLinks:schedule");

    if (scanTimer) {
      clearTimeout(scanTimer);
    }
    scanTimer = setTimeout(() => {
      const startedAt = performance.now();
      scanCurrentPage();
      debugLog("debouncedScanAllGfmLinks:run", {
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      });
    }, 100);
  }

  function isExtensionGeneratedNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return true;
    }

    return node.matches(
      '.github-lark-id, .lark-project-link, .github-user-real-name, .github-assignee-alias, .lark-popover'
    );
  }

  function isIgnoredGitHubDynamicNode(node) {
    if (!isGitHub || node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    return node.matches(ignoredGitHubDynamicSelector) || Boolean(node.closest(ignoredGitHubDynamicSelector));
  }

  function isRelevantPageNode(node) {
    if (
      node.nodeType !== Node.ELEMENT_NODE ||
      isExtensionGeneratedNode(node) ||
      isIgnoredGitHubDynamicNode(node)
    ) {
      return false;
    }

    if (!isGitHub) {
      return true;
    }

    const ignoredGitHubSelector = [
      '.Popover-message',
      'tool-tip',
      '[role="tooltip"]',
      '.js-hovercard-content',
      'details-menu',
      'clipboard-copy'
    ].join(', ');

    if (node.matches(ignoredGitHubSelector) || node.closest(ignoredGitHubSelector)) {
      return false;
    }

    const relevantGitHubSelector = [
      '.comment-body',
      '.timeline-comment',
      '.markdown-body',
      '.js-issue-title',
      '.markdown-title',
      'bdi[data-testid="issue-title"]',
      'div[class*="Title-module__container"]',
      '[data-testid="commit-row-item"]',
      '.commit-group',
      '.commits-list-item',
      'a.issue-link',
      'a[data-hovercard-type="issue"]',
      'a[data-hovercard-type="pull_request"]',
      'a[href*="/commit/"]',
      'a[href*="/commits/"]',
      'a[href*="/pull/"][href*="/changes/"]'
    ].join(', ');

    return node.matches(relevantGitHubSelector) || Boolean(node.querySelector(relevantGitHubSelector));
  }

  // GitHub 的 Checks/merge 状态会持续异步更新，只在真正相关的内容节点出现时重扫。
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const mutation of mutations) {
      const hasPageNode = Array.from(mutation.addedNodes).some(node => {
        return isRelevantPageNode(node);
      });

      if (hasPageNode) {
        debugLog("mutationObserver:relevant", {
          addedNodes: mutation.addedNodes.length,
          target: mutation.target?.nodeName,
        });
        shouldScan = true;
        break;
      }
    }
    if (shouldScan) {
      debouncedScanAllGfmLinks();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // URL 变化监听
  let lastUrl = location.href;
  const titleObserver = new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      setTimeout(() => {
        scanCurrentPage();
      }, 500);
    }
  });

  const titleElement = document.querySelector('title');
  if (titleElement) {
    titleObserver.observe(titleElement, {
      childList: true,
      subtree: true
    });
  }

  // popstate 事件监听
  window.addEventListener('popstate', () => {
    setTimeout(() => {
      scanCurrentPage();
    }, 500);
  });

  // GitLab hashchange 监听
  if (isGitLab) {
    window.addEventListener('hashchange', () => {
      setTimeout(() => {
        scanAllGfmLinks();
      }, 300);
    });
  }
}
