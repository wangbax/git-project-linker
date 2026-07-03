(function () {
  if (window.__larkLinkerGitHubAssigneeFetchPatchInstalled) return;
  window.__larkLinkerGitHubAssigneeFetchPatchInstalled = true;

  const MESSAGE_TYPE = "LARK_LINKER_GITHUB_ASSIGNEE_ALIAS_MAP";
  const ALIAS_MAP_SCRIPT_ID = "lark-linker-github-assignee-alias-map";
  const ASSIGNEE_PICKER_PATH = "/_ghui/item-pickers/assignees";
  const LEGACY_ASSIGNEE_MENU_PARTIAL = "issues/sidebar/assignees_menu_content";
  const LEGACY_REVIEWERS_PATH_SUFFIX = "/review-requests";
  const ASSIGNEE_QUERY_PARAMS = ["query", "q", "filter", "text"];
  let aliasEntries = [];

  function extractEmailPrefix(text) {
    const emailMatch = String(text || "").match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
    if (!emailMatch) return "";

    return emailMatch[1].split("@")[0];
  }

  function normalizeAliasSearchText(text) {
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

  function getAssigneeAliasCandidateTexts(login, userInfo, includeLogin = true) {
    return [
      ...(includeLogin ? [login] : []),
      userInfo?.name,
      ...(Array.isArray(userInfo?.pinyinCandidates) ? userInfo.pinyinCandidates : []),
      userInfo?.emailPrefix,
    ].map(normalizeAliasSearchText).filter(Boolean);
  }

  function setAliasEntries(entries) {
    aliasEntries = (Array.isArray(entries) ? entries : [])
      .filter(entry => Array.isArray(entry) && entry[0])
      .map(([login, userInfo]) => [String(login), {
        name: String(userInfo?.name || ""),
        emailPrefix: String(userInfo?.emailPrefix || ""),
        pinyinCandidates: Array.isArray(userInfo?.pinyinCandidates)
          ? userInfo.pinyinCandidates.map(candidate => String(candidate || "")).filter(Boolean)
          : [],
      }]);
  }

  function refreshAliasEntriesFromDom() {
    try {
      const script = document.getElementById(ALIAS_MAP_SCRIPT_ID);
      if (!script?.textContent) return;

      const entries = JSON.parse(script.textContent);
      setAliasEntries(entries);
    } catch (error) {
      // Keep the last known map if DOM parsing fails.
    }
  }

  function resolveAssigneeQuery(value) {
    const normalizedValue = normalizeAliasSearchText(value);
    if (!normalizedValue) return "";

    let partialAliasLogin = "";
    let partialAliasCount = 0;
    for (const [login, userInfo] of aliasEntries) {
      const candidates = getAssigneeAliasCandidateTexts(login, userInfo, true);

      if (candidates.includes(normalizedValue)) {
        return login;
      }

      const aliasCandidates = getAssigneeAliasCandidateTexts(login, userInfo, false);
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

  function rewriteAssigneeQueryParam(url, paramName) {
    if (!url.searchParams.has(paramName)) return false;

    const query = url.searchParams.get(paramName) || "";
    const resolvedQuery = resolveAssigneeQuery(query);
    if (!resolvedQuery || normalizeAliasSearchText(resolvedQuery) === normalizeAliasSearchText(query)) {
      return false;
    }

    url.searchParams.set(paramName, resolvedQuery);
    return true;
  }

  function isLegacyAssigneeMenuUrl(url) {
    const partial = url.searchParams.get("partial") || "";
    return (
      url.pathname.endsWith("/show_partial") &&
      partial.toLowerCase() === LEGACY_ASSIGNEE_MENU_PARTIAL
    );
  }

  function isLegacyReviewerMenuUrl(url) {
    return url.pathname.endsWith(LEGACY_REVIEWERS_PATH_SUFFIX);
  }

  function rewriteAssigneePickerUrl(rawUrl) {
    refreshAliasEntriesFromDom();
    if (!rawUrl || aliasEntries.length === 0) return rawUrl;

    try {
      const url = new URL(String(rawUrl), window.location.origin);
      if (url.origin !== window.location.origin) {
        return rawUrl;
      }

      if (url.pathname === ASSIGNEE_PICKER_PATH) {
        return rewriteAssigneeQueryParam(url, "query") ? url.toString() : rawUrl;
      }

      if (isLegacyAssigneeMenuUrl(url) || isLegacyReviewerMenuUrl(url)) {
        let didRewrite = false;
        ASSIGNEE_QUERY_PARAMS.forEach(paramName => {
          didRewrite = rewriteAssigneeQueryParam(url, paramName) || didRewrite;
        });
        return didRewrite ? url.toString() : rawUrl;
      }
    } catch (error) {
      return rawUrl;
    }

    return rawUrl;
  }

  function patchFetch() {
    const originalFetch = window.fetch;
    if (typeof originalFetch !== "function") return;

    window.fetch = function patchedFetch(input, init) {
      try {
        if (input instanceof Request) {
          const nextUrl = rewriteAssigneePickerUrl(input.url);
          if (nextUrl !== input.url) {
            return originalFetch.call(this, new Request(nextUrl, input), init);
          }
        } else {
          const rawUrl = input instanceof URL ? input.toString() : input;
          const nextUrl = rewriteAssigneePickerUrl(rawUrl);
          if (nextUrl !== rawUrl) {
            return originalFetch.call(this, nextUrl, init);
          }
        }
      } catch (error) {
        // Never let the patch break GitHub's native request path.
      }

      return originalFetch.call(this, input, init);
    };
  }

  function patchXMLHttpRequest() {
    const xhrPrototype = window.XMLHttpRequest?.prototype;
    if (!xhrPrototype?.open) return;

    const originalOpen = xhrPrototype.open;
    xhrPrototype.open = function patchedOpen(method, url, ...rest) {
      return originalOpen.call(this, method, rewriteAssigneePickerUrl(url), ...rest);
    };
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.type !== MESSAGE_TYPE) return;

    setAliasEntries(event.data.entries);
  });

  refreshAliasEntriesFromDom();
  patchFetch();
  patchXMLHttpRequest();
})();
