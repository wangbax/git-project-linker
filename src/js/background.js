import { MSG_EVENT } from "./event";
import { LARK_DOMAIN_HOST } from "./utils";

main();

async function main() {
  chrome.runtime.onMessage.addListener(function (e, sender, sendResponse) {
    const { message, data } = e;
    const tabId = sender.tab?.id;
    switch (message) {
      case MSG_EVENT.INIT:
        sendMessageToTab(tabId, {
          message: MSG_EVENT.INIT,
          data: {
            msg: "init",
          },
        });
        break;
      case MSG_EVENT.GET_LARK_PROJECT_INFO:
        getLarkProjectInfo(data).then((resData) => {
          if (!resData) return;
          sendMessageToTab(tabId, {
            message: MSG_EVENT.GET_LARK_PROJECT_INFO,
            data: resData,
          });
        });
        break;
    }
  });
}

function sendMessageToTab(tabId, payload) {
  if (!tabId) return;

  try {
    const result = chrome.tabs.sendMessage(tabId, payload);
    if (result?.catch) {
      result.catch(() => {});
    }
  } catch (error) {
    // The content script may have been unloaded after a navigation.
  }
}

const extractScriptContent = (text) => {
  // 使用正则表达式匹配 script 标签内的内容
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/;
  const match = text.match(scriptRegex);

  if (match && match[1]) {
    // 返回标签内的内容
    return match[1].trim();
  }

  return ""; // 如果没有找到匹配，返回空字符串
};

const getLarkProjectInfoByDetail = (text, type, id) => {

  // 打印响应的前面部分，看看 HTML 结构

  const reg = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
  const scripts = text.match(reg);

  if (!scripts) {
    return {
      error: true,
      data: null,
    };
  }

  let content = "";
  let foundWorkItem = 0;

  // 尝试多种模式查找数据

  for (let i = 0; i < scripts.length; i++) {
    const scriptText = scripts[i];

    // 旧版：window.detail + /work_item 路径
    const hasWindowDetail = scriptText.includes("window.detail");
    const hasWorkItemPath = scriptText.includes(`/work_item/${type}/${id}`);

    // 新版关键字
    const hasWorkItem = scriptText.includes("work_item");
    const hasIdString = scriptText.includes(id);

    // 打印包含 work_item + id 的 script
    if (hasWorkItem && hasIdString) {

      // 检查是否包含响应数据（有 "data" 或 "result" 字段）
      const hasDataField = scriptText.includes('%22data%22%3A') || scriptText.includes('"data":');
      const hasPayloadOnly = scriptText.includes('%22payload%22%3A') || scriptText.includes('"payload":');

      // 检查 API 类型
      const isDemandFetch = scriptText.includes('APIDemandFetchWorkItem');
      const isMinimalInfo = scriptText.includes('APIFetchMinimalInfoWorkItem');
      const isFindBasic = scriptText.includes('APIFindBasicWorkItemByIDV2');


      // 只检查包含响应数据的 script（不是 payload）
      if (!hasDataField && hasPayloadOnly) {
        continue;
      }

      // 优先使用 APIDemandFetchWorkItem 或 APIFindBasicWorkItemByIDV2，它们的错误信息更准确
      // APIFetchMinimalInfoWorkItem 即使不存在也会返回 200，所以跳过
      if (isMinimalInfo && !isDemandFetch && !isFindBasic) {
        continue;
      }

      // 检查是否有错误标记（URL 编码格式）
      // "code":404 编码后是 %22code%22%3A404
      // "code":200 编码后是 %22code%22%3A200
      const hasError404 = scriptText.includes('%22code%22%3A404') || scriptText.includes('"code":404');
      const hasCode200 = scriptText.includes('%22code%22%3A200') || scriptText.includes('"code":200');


      // 如果有 404 错误，说明这个类型不存在，跳过
      if (hasError404) {
        continue;
      }

      // 检查新格式的类型标识（需要检查 URL 编码和非编码两种格式）
      // URL 编码: %22work_item_api_name%22%3A%22story%22 -> "work_item_api_name":"story"
      const hasStoryType =
        scriptText.includes('"work_item_api_name":"story"') ||
        scriptText.includes('"work_item_type":"story"') ||
        scriptText.includes('%22work_item_api_name%22%3A%22story%22') ||
        scriptText.includes('%22work_item_type%22%3A%22story%22');

      const hasIssueType =
        scriptText.includes('"work_item_api_name":"issue"') ||
        scriptText.includes('"work_item_type":"issue"') ||
        scriptText.includes('%22work_item_api_name%22%3A%22issue%22') ||
        scriptText.includes('%22work_item_type%22%3A%22issue%22');


      // 如果检测到类型匹配且没有错误，立即返回
      if (hasStoryType && type === 'story' && hasCode200) {
        return {
          error: false,
          data: { type: 'story' },
        };
      }
      if (hasIssueType && type === 'issue' && hasCode200) {
        return {
          error: false,
          data: { type: 'issue' },
        };
      }
    }

    if (hasWorkItemPath) foundWorkItem++;

    // 旧版匹配规则
    if (hasWindowDetail && hasWorkItemPath) {
      content = scriptText;
      break;
    }
  }


  if (!content) {
    return {
      error: true,
      data: null,
    };
  }

  content = content.replace(/\n/g, "");
  content = content.replace(new RegExp("\\\\x3C", "g"), "<");
  content = content.replace(new RegExp("\x3C", "g"), "<");
  content = content.replace(new RegExp("\\x3C", "g"), "<");
  content = content.split("};\x3C/script>")[0];
  content = content.replace("<script>", "");
  content = content.replace("}</script>", "");
  content = content.replace("window.detail = {", "");
  content = content.replace("...window.detail,", "");
  content = content.replace("...{", "{");
  content = content.replace("};", "}");
  content = content.replace(/\\'/g, "'");
  const obj = JSON.parse(content);
  let data = null;
  const key = Object.keys(obj)[0];
  data = obj[key].data;
  return {
    error: false,
    data,
  };
};

const getLarkProjectInfoByPrefetchList = (text) => {
  const reg = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
  const scripts = text.match(reg);
  let content = "";
  for (let i = 0; i < scripts.length; i++) {
    const text = scripts[i];
    const isContain =
      text.includes('...{"APIDemandFetchWorkItem":') &&
      text.includes(`window.prefetch_list`);

    if (isContain) {
      content = text;
      break;
    }
  }
  if (!content)
    return {
      error: true,
      data: null,
    };
  content = content.replace(/\n/g, "");
  content = content.replace(new RegExp("\\\\x3C", "g"), "<");
  content = content.replace(new RegExp("\x3C", "g"), "<");
  content = content.replace(new RegExp("\\x3C", "g"), "<");
  const noScriptContent = extractScriptContent(content);
  if (noScriptContent) {
    content = noScriptContent;
  }
  content = content.replace("window.prefetch_list = {", "");
  content = content.replace("...window.prefetch_list,", "");
  content = content.replace("...{", "{");
  content = content.replace("} };", "}");
  content = content.replace(/\\'/g, "'");
  const obj = JSON.parse(content);
  const biz_data = obj.APIDemandFetchWorkItem.data.data.biz_data;
  const target = biz_data.find((item) => item.key === "workitem");
  if (!target) {
    return {
      error: true,
      data: null,
    };
  }
  return {
    error: false,
    data: {
      data: target.value,
    },
  };
};

// 类型缓存：记录每个 tid 对应的实际类型
const typeCache = new Map();
// App 缓存：记录每个 tid 对应的有效 app
const appCache = new Map();

async function getLarkProjectInfo({ tid, app }) {
  const [prefix, id] = tid.split("-");
  const prefixLower = prefix.toLowerCase();

  // 处理多个 app 的情况
  const apps = app.split(',').map(a => a.trim()).filter(a => a);
  let validApp = app;
  
  // 如果配置了多个 app，尝试找到有效的那个
  if (apps.length > 1) {
    // 先检查缓存
    if (appCache.has(tid)) {
      validApp = appCache.get(tid);
    } else {
      // 尝试找到有效的 app
      validApp = await findValidApp(apps, id, tid, prefixLower);
      if (validApp) {
        appCache.set(tid, validApp);
      } else {
        validApp = apps[0]; // 如果都失败了，使用第一个
      }
    }
  }

  // 快速路径：保持向后兼容
  let type = "story";

  if (prefixLower === "m") {
    type = "story";
  } else if (prefixLower === "f") {
    type = "issue";
  } else {
    // 对于其他前缀，检查缓存
    if (typeCache.has(tid)) {
      type = typeCache.get(tid);
    } else {
      type = await detectProjectType(validApp, id, tid);
    }
  }

  let url = `${LARK_DOMAIN_HOST}/${validApp}/${type}/detail/${id}`;
  const res = await fetch(url);
  const text = await res.text();
  let info = { tid, app: validApp, actualType: type };
  const detailInfo = getLarkProjectInfoByDetail(text, type, id);
  if (detailInfo.data) {
    info = {
      ...info,
      ...detailInfo.data,
    };
  } else {
    const prefetchListInfo = getLarkProjectInfoByPrefetchList(text);
    info = {
      ...info,
      ...prefetchListInfo.data,
    };
  }
  return info;
}

// 查找有效的 app：依次尝试每个 app，直到找到有效的
async function findValidApp(apps, id, tid, prefixLower) {
  // 根据前缀猜测类型，优化尝试顺序
  let typesToTry = ['story', 'issue'];
  
  if (prefixLower === 'm') {
    typesToTry = ['story'];
  } else if (prefixLower === 'f') {
    typesToTry = ['issue'];
  }

  // 依次尝试每个 app
  for (const app of apps) {
    for (const type of typesToTry) {
      try {
        let url = `${LARK_DOMAIN_HOST}/${app}/${type}/detail/${id}`;
        const res = await fetch(url);
        const text = await res.text();

        const detailInfo = getLarkProjectInfoByDetail(text, type, id);
        if (detailInfo.data) {
          // 找到了有效的 app，同时缓存类型
          typeCache.set(tid, type);
          return app;
        }

        const prefetchListInfo = getLarkProjectInfoByPrefetchList(text);
        if (prefetchListInfo.data) {
          typeCache.set(tid, type);
          return app;
        }
      } catch (e) {
        // 继续尝试下一个
        continue;
      }
    }
  }

  return null;
}

// 动态检测项目类型：先尝试 story，失败后尝试 issue
async function detectProjectType(app, id, tid) {

  // 先尝试 story
  try {
    let url = `${LARK_DOMAIN_HOST}/${app}/story/detail/${id}`;
    const res = await fetch(url);
    const text = await res.text();

    const detailInfo = getLarkProjectInfoByDetail(text, 'story', id);
    if (detailInfo.data) {
      typeCache.set(tid, "story");
      return "story";
    }

    const prefetchListInfo = getLarkProjectInfoByPrefetchList(text);
    if (prefetchListInfo.data) {
      typeCache.set(tid, "story");
      return "story";
    }
  } catch (e) {
    console.error('[Lark Background] Story request failed:', e.message);
  }

  // 尝试 issue
  try {
    let url = `${LARK_DOMAIN_HOST}/${app}/issue/detail/${id}`;
    const res = await fetch(url);
    const text = await res.text();

    const detailInfo = getLarkProjectInfoByDetail(text, 'issue', id);
    if (detailInfo.data) {
      typeCache.set(tid, "issue");
      return "issue";
    }

    const prefetchListInfo = getLarkProjectInfoByPrefetchList(text);
    if (prefetchListInfo.data) {
      typeCache.set(tid, "issue");
      return "issue";
    }
  } catch (e) {
    console.error('[Lark Background] Issue request failed:', e.message);
  }

  // 两次都失败，默认返回 story
  typeCache.set(tid, "story");
  return "story";
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    // 打开选项页
    chrome.runtime.openOptionsPage();
  }
});
