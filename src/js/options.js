import { getLarkConfig, setLarkConfig, isDev } from "./store";

function main() {
  if (isDev) {
    document.getElementById("dev-inject").style.display = "block";
    const devInjectBtn = document.getElementById("dev-inject-btn");
    if (devInjectBtn) {
      devInjectBtn.addEventListener("click", function() {
        const script = document.createElement("script");
        script.src = "http://localhost:3000/index.js";
        document.body.appendChild(script);
      });
    }
  }

  const errorDom = document.getElementById("error");
  const successDom = document.getElementById("success");
  const loadingDom = document.getElementById("loading");
  const form = document.getElementById("form");
  const githubOrgsDom = document.getElementById("github-orgs");
  const githubEnabledDom = document.getElementById("github-enabled");
  const larkEnabledDom = document.getElementById("lark-enabled");
  const sentryEnabledDom = document.getElementById("sentry-enabled");
  const organizations = [];

  document.getElementById("add-github-org").addEventListener("click", () => {
    organizations.push({
      directoryUrl: "",
      enabled: true,
    });
    renderOrganizations();
  });

  document
    .getElementById("button")
    .addEventListener("click", async function () {
      hideMessages();
      const data = collectConfig();
      const validationError = validateConfig(data);

      if (validationError) {
        toggleError(validationError);
        return;
      }

      loadingDom.style.display = "block";
      await setLarkConfig(data);
      successDom.style.display = "block";
      loadingDom.style.display = "none";
    });

  function splitList(value) {
    return Array.from(new Set(
      String(value || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean)
    ));
  }

  function normalizeDirectoryUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol !== "https:" || url.hostname !== "github.com") {
        return "";
      }

      const pathSegments = url.pathname.split("/").filter(Boolean);
      if (pathSegments.length < 2) return "";

      return `${url.origin}/${pathSegments[0]}/${pathSegments[1]}`;
    } catch (error) {
      return "";
    }
  }

  function getOrganizationFromDirectoryUrl(directoryUrl) {
    try {
      const url = new URL(directoryUrl);
      const pathSegments = url.pathname.split("/").filter(Boolean);
      return pathSegments[0] || "";
    } catch (error) {
      return "";
    }
  }

  function renderOrganizations() {
    githubOrgsDom.innerHTML = "";

    if (organizations.length === 0) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-gray-500";
      empty.textContent = "还没有配置 Org。没有 Org 配置时，GitHub 页面增强仍然可用。";
      githubOrgsDom.appendChild(empty);
      return;
    }

    organizations.forEach((organization, index) => {
      const row = document.createElement("div");
      row.className = "github-org-row";

      const title = document.createElement("div");
      title.className = "flex items-center justify-between gap-3 mb-3";

      const label = document.createElement("span");
      label.className = "text-sm font-medium text-gray-700";
      label.textContent = `Org ${index + 1}`;

      const actions = document.createElement("div");
      actions.className = "flex items-center gap-3";

      const enabledLabel = document.createElement("label");
      enabledLabel.className = "inline-flex items-center gap-2 text-xs text-gray-600";
      const enabledInput = document.createElement("input");
      enabledInput.type = "checkbox";
      enabledInput.checked = organization.enabled !== false;
      enabledInput.addEventListener("change", () => {
        organization.enabled = enabledInput.checked;
      });
      enabledLabel.appendChild(enabledInput);
      enabledLabel.appendChild(document.createTextNode("启用此 Org"));

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "text-sm text-red-600 hover:text-red-800";
      removeButton.textContent = "删除";
      removeButton.addEventListener("click", () => {
        organizations.splice(index, 1);
        renderOrganizations();
      });

      title.appendChild(label);
      actions.appendChild(enabledLabel);
      actions.appendChild(removeButton);
      title.appendChild(actions);
      row.appendChild(title);

      row.appendChild(createTextField(
        "",
        "用户目录仓库：https://github.com/<org>/<repo>",
        organization.directoryUrl,
        value => {
          organization.directoryUrl = value;
          updateOrganizationLogin();
        }
      ));

      const organizationLoginDom = document.createElement("p");
      organizationLoginDom.className = "text-xs text-gray-500 mt-1";
      row.appendChild(organizationLoginDom);

      function updateOrganizationLogin() {
        const normalizedUrl = normalizeDirectoryUrl(organization.directoryUrl);
        const organizationLogin = getOrganizationFromDirectoryUrl(normalizedUrl);
        organizationLoginDom.innerHTML = "";
        if (!organizationLogin) return;

        const label = document.createElement("span");
        label.textContent = "Org 登录名：";
        const value = document.createElement("span");
        value.className = "text-blue-600 font-semibold";
        value.textContent = organizationLogin;
        organizationLoginDom.append(label, value);
      }

      updateOrganizationLogin();

      githubOrgsDom.appendChild(row);
    });
  }

  function createTextField(labelText, placeholder, value, onChange) {
    const wrapper = document.createElement("div");
    wrapper.className = "relative z-0 w-full mb-3";

    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.placeholder = placeholder;
    input.className = "pt-2 pb-2 block w-full px-0 bg-transparent border-0 border-b appearance-none focus:outline-none focus:ring-0 focus:border-black border-gray-300";
    input.addEventListener("input", () => {
      onChange(input.value.trim());
    });

    const label = document.createElement("label");
    label.className = "block text-xs text-gray-500 mb-1";
    label.textContent = labelText;

    if (labelText) {
      wrapper.appendChild(label);
    }
    wrapper.appendChild(input);
    return wrapper;
  }

  function collectConfig() {
    const app = form.elements.app.value.trim();
    const domain = form.elements.domain.value.trim();
    const prefixes = form.elements.prefixes.value.trim();
    const sentryDomain = form.elements.sentryDomain.value.trim();
    const sentryIssueCreateUrl = form.elements.sentryIssueCreateUrl.value.trim();
    const normalizedOrganizations = organizations.map(organization => ({
      directoryUrl: normalizeDirectoryUrl(organization.directoryUrl),
      enabled: organization.enabled !== false,
    }));

    return {
      schemaVersion: 2,
      github: {
        enabled: githubEnabledDom.checked,
        organizations: normalizedOrganizations,
      },
      gitlab: {
        enabled: Boolean(domain),
        domains: splitList(domain),
      },
      lark: {
        enabled: larkEnabledDom.checked,
        namespaces: splitList(app),
        prefixes: splitList(prefixes),
      },
      sentry: {
        enabled: sentryEnabledDom.checked,
        domains: splitList(sentryDomain),
        issueCreateUrl: sentryIssueCreateUrl,
      },
    };
  }

  function validateConfig(data) {
    const seenOrganizations = new Set();
    const seenUrls = new Set();

    for (const organization of data.github.organizations) {
      if (!organization.directoryUrl) {
        return "用户目录仓库地址不正确，请使用 https://github.com/<org>/<repo>";
      }

      const organizationLogin = getOrganizationFromDirectoryUrl(organization.directoryUrl);
      const normalizedOrganization = organizationLogin.toLowerCase();
      if (!normalizedOrganization) {
        return "无法从用户目录仓库地址识别 GitHub Org";
      }
      if (seenOrganizations.has(normalizedOrganization)) {
        return `GitHub Org ${organizationLogin} 重复配置`;
      }
      if (seenUrls.has(organization.directoryUrl)) {
        return `用户目录仓库 ${organization.directoryUrl} 重复配置`;
      }

      seenOrganizations.add(normalizedOrganization);
      seenUrls.add(organization.directoryUrl);
    }

    if (data.lark.enabled && data.lark.namespaces.length === 0) {
      return "启用飞书关联时，请至少填写一个飞书命名空间";
    }

    if (data.lark.namespaces.some(namespace => !/^[a-zA-Z0-9]+$/.test(namespace))) {
      return "飞书命名空间格式不正确，请使用字母和数字";
    }

    if (data.lark.prefixes.some(prefix => !/^[a-zA-Z0-9]+$/.test(prefix))) {
      return "项目编号前缀格式不正确，请使用字母和数字";
    }

    if (data.sentry.enabled && (!data.sentry.domains.length || !data.sentry.issueCreateUrl)) {
      return "启用 Sentry 时，请填写域名和 Issue 创建地址";
    }

    return "";
  }

  function toCommaSeparated(value) {
    return Array.isArray(value) ? value.join(",") : String(value || "");
  }

  function updateFormData(config) {
    const normalizedConfig = config || {};
    const github = normalizedConfig.github || {};
    const gitlab = normalizedConfig.gitlab || {};
    const lark = normalizedConfig.lark || {};
    const sentry = normalizedConfig.sentry || {};

    githubEnabledDom.checked = github.enabled !== false;
    larkEnabledDom.checked = lark.enabled === true;
    sentryEnabledDom.checked = sentry.enabled === true;
    form.elements.app.value = toCommaSeparated(lark.namespaces || normalizedConfig.app);
    form.elements.domain.value = toCommaSeparated(gitlab.domains || normalizedConfig.domain);
    form.elements.prefixes.value = toCommaSeparated(lark.prefixes || normalizedConfig.prefixes);
    form.elements.sentryDomain.value = toCommaSeparated(
      sentry.domains || normalizedConfig.sentryDomain
    );
    form.elements.sentryIssueCreateUrl.value =
      sentry.issueCreateUrl || normalizedConfig.sentryIssueCreateUrl || "";

    organizations.splice(0, organizations.length);
    (github.organizations || []).forEach(organization => {
      organizations.push({
        directoryUrl: organization.directoryUrl || "",
        enabled: organization.enabled !== false,
      });
    });
    renderOrganizations();
  }

  function hideMessages() {
    errorDom.style.display = "none";
    successDom.style.display = "none";
    loadingDom.style.display = "none";
  }

  function toggleError(message) {
    errorDom.innerText = message;
    errorDom.style.display = "block";
    loadingDom.style.display = "none";
    successDom.style.display = "none";
  }

  function initCollapsible() {
    const header = document.getElementById("more-settings-header");
    const content = document.getElementById("more-settings-content");
    const arrow = document.getElementById("more-settings-arrow");

    header.addEventListener("click", function() {
      const expanded = content.classList.toggle("expanded");
      arrow.classList.toggle("collapsed", !expanded);
    });
  }

  getLarkConfig().then(updateFormData);
  initCollapsible();
}

document.addEventListener("DOMContentLoaded", main);
