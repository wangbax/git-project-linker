import { getLarkConfig, getLarkConfigSync } from "./store";

export const LARK_DOMAIN_HOST = "https://project.feishu.cn";

// 检查是否满足条件（GitHub/GitLab）
export async function checkCondition() {
  const config = await getLarkConfig();
  if (!config) return false;

  if (window.location.host.includes("github.com")) {
    return config.github?.enabled !== false;
  }

  if (config.gitlab?.enabled === false) return false;

  const domains = config.gitlab?.domains || config.domain?.split(",") || [];
  if (domains.length === 0) return false;
  return domains.some((domain) => {
    return window.location.host.includes(String(domain).trim());
  })
    ? true
    : false;
}

// 检查是否满足条件（Sentry）
export function checkSentryCondition() {
  const config = getLarkConfigSync();
  if (!config || config.sentry?.enabled === false) return false;
  const domains = config.sentry?.domains || config.sentryDomain?.split(",") || [];
  const issueCreateUrl = config.sentry?.issueCreateUrl || config.sentryIssueCreateUrl;
  if (!issueCreateUrl) return false;
  if (domains.length === 0) return false;
  return domains.some((domain) => {
    return window.location.host.includes(String(domain).trim());
  });
}
