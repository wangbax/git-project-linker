/**
 * GitLab 平台特定处理逻辑
 */

import { getLarkConfig } from "./store";

export function createGitLabHandler(context) {
  const {
    nodeMap,
    tidTypeMap,
    getLarkProjectLink,
    fetchLarkProjectInfo,
    bindPopoverEvent,
    replaceLarkLinks,
    replaceProjectIdToLarkProjectLink,
    getLarkConfigSync
  } = context;

  /**
   * 初始化 GitLab 处理器
   */
  async function init() {
    const config = await getLarkConfig();
    if (config?.lark?.enabled !== true) return;

    // 隐藏 GitLab 的默认 tooltip
    hideGitLabTooltips();
    
    // 初始化页面监听
    initPageListener();
  }

  /**
   * 隐藏 GitLab 的默认 tooltip
   */
  function hideGitLabTooltips() {
    // 添加 CSS 来隐藏 GitLab tooltip
    const style = document.createElement("style");
    style.id = "hide-gitlab-tooltips";
    style.innerHTML = `
      /* 隐藏飞书链接上的 GitLab tooltip */
      .lark-project-link + [id^="gl-tooltip"],
      [id^="gl-tooltip"]:has(.tooltip-inner span:contains("Issue in Jira")),
      [id^="gl-tooltip"]:has(.tooltip-inner span:contains("issue in jira")) {
        display: none !important;
      }
    `;
    document.head.appendChild(style);

    // 使用 MutationObserver 监听 tooltip 的出现
    const tooltipObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // 检查是否是 GitLab tooltip
            if (node.id && node.id.startsWith('gl-tooltip')) {
              const tooltipInner = node.querySelector('.tooltip-inner span');
              if (tooltipInner && tooltipInner.textContent === 'Issue in Jira') {
                // 检查关联的元素是否是飞书链接
                const ariaDescribedBy = document.querySelector(`[aria-describedby="${node.id}"]`);
                if (ariaDescribedBy && ariaDescribedBy.classList.contains('lark-project-link')) {
                  node.style.display = 'none';
                }
              }
            }
          }
        });
      });
    });

    tooltipObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * 初始化 GitLab 页面监听
   */
  async function initPageListener() {
    const config = await getLarkConfig();
    if (!config) return;

    const dom_content_wrapper = document.querySelector(".content-wrapper");

    const ro = new ResizeObserver(function () {
      const dom_commits_list = document.getElementById("commits-list");
      if (dom_commits_list) {
        replaceCommitList();
      }

      const dom_tree_holder = document.getElementById("tree-holder");
      if (dom_tree_holder) {
        const dom_project_last_commit = dom_tree_holder.querySelector(
          ".project-last-commit"
        );
        const targetElement = dom_project_last_commit?.firstElementChild || dom_project_last_commit;
        if (targetElement && targetElement instanceof Element) {
          const ro = new ResizeObserver(replaceTreeHolderProjectLastCommit);
          ro.observe(targetElement);
        }
      }

      const dom_content_body = document.getElementById("content-body");
      if (dom_content_body) {
        const ro = new ResizeObserver(replaceContentBodyCommitList);
        ro.observe(dom_content_body);
      }

      replaceMergeRequestTitle();
    });

    if (dom_content_wrapper) {
      ro.observe(dom_content_wrapper);
    }
  }

  /**
   * 替换 commit message 中的项目 ID 为 Lark 项目链接
   */
  function replaceCommitList() {
    const dom_commits_rows = document.getElementsByClassName("commits-row");

    Array.from(dom_commits_rows).forEach((item) => {
      const dom_commit_list = item.getElementsByClassName("commit-list")[0];
      const dom_commit_list_item =
        dom_commit_list.getElementsByClassName("commit");
      Array.from(dom_commit_list_item).forEach((row) => {
        if (nodeMap.has(row)) return;

        // 在整个 commit row 中查找链接（而不是只在第一个链接中查找）
        let hasReplaced = replaceLarkLinks(row);

        // 如果没有找到链接，尝试旧方法处理纯文本（向后兼容）
        if (!hasReplaced) {
          const dom_commit_row_message =
            row.getElementsByClassName("commit-row-message")[0];
          if (dom_commit_row_message) {
            const result = replaceProjectIdToLarkProjectLink(
              dom_commit_row_message
            );
            if (result[0]) {
              dom_commit_row_message.innerHTML = result[1];
              // 为所有创建的链接绑定事件（可能有多个项目 ID）
              const links = dom_commit_row_message.querySelectorAll(".lark-project-link");
              links.forEach(link => {
                bindPopoverEvent(link);
              });
              hasReplaced = true;
            }
          }
        }

        if (hasReplaced) {
          nodeMap.add(row);
        }
      });
    });
  }

  /**
   * 替换项目 ID 为 Lark 项目链接
   */
  function replaceTreeHolderProjectLastCommit() {
    const dom_tree_holder = document.getElementById("tree-holder");
    if (!dom_tree_holder) return;
    const dom_project_last_commit = dom_tree_holder.querySelector(
      ".project-last-commit"
    );
    if (!dom_project_last_commit) return;
    if (nodeMap.has(dom_project_last_commit)) return;

    // 在整个 project-last-commit 容器中查找链接
    let hasReplaced = replaceLarkLinks(dom_project_last_commit);

    // 如果没有找到链接，尝试旧方法处理纯文本（向后兼容）
    if (!hasReplaced) {
      const dom_commit_row_message = dom_project_last_commit.querySelector(
        ".commit-row-message"
      );
      if (dom_commit_row_message) {
        const result = replaceProjectIdToLarkProjectLink(dom_commit_row_message);
        if (result[0]) {
          dom_commit_row_message.innerHTML = result[1];
          // 为所有创建的链接绑定事件（可能有多个项目 ID）
          const links = dom_commit_row_message.querySelectorAll(".lark-project-link");
          links.forEach(link => {
            bindPopoverEvent(link);
          });
          hasReplaced = true;
        }
      }
    }

    if (hasReplaced) {
      nodeMap.add(dom_project_last_commit);
    }
  }

  /**
   * 替换内容区域的 commit list
   */
  function replaceContentBodyCommitList() {
    const rows = document.getElementsByClassName("merge-request-title-text");
    Array.from(rows).forEach((item) => {
      const dom_a = item.querySelector("a");
      if (nodeMap.has(dom_a)) return;

      // 优先使用新方法处理已存在的链接
      let hasReplaced = replaceLarkLinks(dom_a);

      // 如果没有找到链接，尝试旧方法处理纯文本（向后兼容）
      if (!hasReplaced) {
        const result = replaceProjectIdToLarkProjectLink(dom_a);
        if (result[0]) {
          dom_a.innerHTML = result[1];
          // 为所有创建的链接绑定事件（可能有多个项目 ID）
          const links = dom_a.querySelectorAll(".lark-project-link");
          links.forEach(link => {
            bindPopoverEvent(link);
          });
          hasReplaced = true;
        }
      }

      if (hasReplaced) {
        nodeMap.add(dom_a);
      }
    });
  }

  /**
   * 替换 merge request title
   */
  function replaceMergeRequestTitle() {
    const dom_merge_request_details = document.querySelector(
      ".merge-request-details"
    );
    if (!dom_merge_request_details) return;
    const dom_merge_request_title =
      dom_merge_request_details.querySelector(".title");
    if (!dom_merge_request_title) return;
    if (nodeMap.has(dom_merge_request_title)) return;

    // 在标题容器中查找所有链接
    let hasReplaced = replaceLarkLinks(dom_merge_request_title);

    // 如果没有找到链接，尝试旧方法处理纯文本（向后兼容）
    if (!hasReplaced) {
      const result = replaceProjectIdToLarkProjectLink(dom_merge_request_title);
      if (result[0]) {
        dom_merge_request_title.innerHTML = result[1];
        // 为所有创建的链接绑定事件（可能有多个项目 ID）
        const links = dom_merge_request_title.querySelectorAll(".lark-project-link");
        links.forEach(link => {
          bindPopoverEvent(link);
        });
        hasReplaced = true;
      }
    }

    if (hasReplaced) {
      nodeMap.add(dom_merge_request_title);
    }
  }

  return {
    init
  };
}
