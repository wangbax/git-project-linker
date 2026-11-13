const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { rollup } = require("rollup");
const { JSDOM } = require("jsdom");

const CACHE_KEY = "GITHUB_USER_ALIAS_CACHE";
const SOURCE = "https://github.com/taptap/org";
let handlerBundle;

before(async () => {
  const bundle = await rollup({ input: "src/js/github-handler.js" });
  try {
    const { output } = await bundle.generate({ format: "cjs" });
    handlerBundle = output[0].code;
  } finally {
    await bundle.close();
  }
});

function directory(name = "张三", login = "porco-n") {
  return `<article class="markdown-body"><table><tr><th>GitHub</th><th>Name</th></tr>
    <tr><td><a href="/${login}">${login}</a></td><td>${name}</td></tr></table></article>`;
}

function response(html = directory(), status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => html };
}

function card(login = "porco-n", legacy = false) {
  const name = legacy
    ? `<div class="f4"><a href="/${login}">${login}</a><span>Original name</span></div>`
    : `<section aria-label="User login and name"><span class="Truncate"><a href="/${login}">${login}</a></span></section>`;
  return `<div class="Popover-message">${name}</div>`;
}

const authorLink = `<a href="/taptap/lite-client/commits?author=porco-n"
  data-hovercard-url="/users/porco-n/hovercard" data-hovercard-type="user">porco-n</a>`;

function cached(entries = [["porco-n", { name: "旧名字", emailPrefix: "old" }]]) {
  return { [CACHE_KEY]: { [SOURCE]: { entries, expiry: 1, updatedAt: 1 } } };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  // Drain fetch/storage promises and DOM MutationObserver deliveries, without real sleeps.
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function fixture(t, { html = "", replies = [response()], storage = {}, organizations, debug = false } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    url: "https://github.com/taptap/lite-client",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const requests = [];
  const errors = [];
  const timers = new Map();
  let now = 1700000000000;
  let timerId = 0;
  const config = {
    github: { enabled: true, organizations: organizations || [{ directoryUrl: SOURCE, enabled: true }] },
    lark: { enabled: false },
  };
  window.process = { env: { isDev: "0" } };
  window.module = { exports: {} };
  window.exports = window.module.exports;
  window.console.error = (...args) => errors.push(args);
  window.console.debug = () => {};
  if (debug) window.localStorage.setItem("LARK_LINKER_DEBUG", "1");
  window.Date.now = () => now;
  window.setTimeout = (callback, delay = 0, ...args) => {
    const id = ++timerId;
    timers.set(id, { at: now + delay, callback: () => callback(...args) });
    return id;
  };
  window.clearTimeout = id => timers.delete(id);
  window.fetch = async (url, options) => {
    requests.push({ url, options });
    const next = replies.shift();
    if (!next) throw new Error("Unexpected extra directory request");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(url, options) : next;
  };
  window.chrome = {
    storage: {
      local: {
        get: async key => ({ [key]: structuredClone(storage[key]) }),
        set: async changes => Object.assign(storage, structuredClone(changes)),
      },
      sync: { get: async key => ({ [key]: JSON.stringify(config) }) },
    },
  };
  window.eval(handlerBundle);
  const handler = window.module.exports.createGitHubHandler({
    getLarkConfigSync: () => config,
    nodeMap: new WeakSet(),
    tidTypeMap: new Map(),
  });
  handler.init();
  t.after(() => { timers.clear(); window.close(); });

  async function advance(milliseconds) {
    await settle();
    const until = now + milliseconds;
    let ticks = 0;
    while (true) {
      const next = Array.from(timers).filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert.ok(++ticks < 100, "Timers must settle without a mutation/retry loop");
      const [id, timer] = next;
      now = timer.at;
      timers.delete(id);
      timer.callback();
      await settle();
    }
    now = until;
    await settle();
  }

  function hover() {
    window.document.querySelector('a[data-hovercard-type="user"]').dispatchEvent(
      new window.MouseEvent("mouseover", { bubbles: true })
    );
  }

  return { window, document: window.document, handler, requests, errors, storage, advance, hover };
}

test("stays lazy until a user link is hovered, including a stopped bubbling event", async t => {
  const f = fixture(t, { html: authorLink });
  await f.advance(1000);
  assert.equal(f.requests.length, 0);
  f.document.querySelector("a").addEventListener("mouseover", event => event.stopImmediatePropagation());
  f.hover();
  await settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].options.cache, "no-store");
  assert.equal(f.requests[0].options.credentials, "include");
  assert.equal(f.document.querySelector("a").textContent, "porco-n");
});

test("finds a nested card inserted as one wrapper, supports old layout and restores removed names", async t => {
  const f = fixture(t);
  const wrapper = f.document.createElement("div");
  wrapper.className = "js-hovercard-content";
  wrapper.innerHTML = card("porco-n", true);
  f.document.body.append(wrapper);
  await f.advance(100);
  assert.equal(f.document.querySelector(".github-user-real-name").textContent, "(张三)");
  f.document.querySelector(".github-user-real-name").remove();
  await f.advance(100);
  assert.equal(f.document.querySelectorAll(".github-user-real-name").length, 1);
  await f.advance(10000);
  assert.equal(f.requests.length, 1, "Own DOM writes must not cause repeat fetching");
});

test("observes a replaced body and card text updates", async t => {
  const f = fixture(t);
  const body = f.document.createElement("body");
  body.innerHTML = card();
  f.document.body.replaceWith(body);
  await f.advance(100);
  assert.equal(body.querySelector(".github-user-real-name").textContent, "(张三)");
  const link = body.querySelector("a");
  link.setAttribute("href", "/unmapped-user");
  link.firstChild.data = "unmapped-user";
  await f.advance(100);
  assert.equal(body.querySelectorAll(".github-user-real-name").length, 0);
});

test("first-load network failure retries and recovers without reloading the page", async t => {
  const f = fixture(t, { html: card(), replies: [new TypeError("Failed to fetch"), response()] });
  await f.advance(50);
  assert.equal(f.requests.length, 1);
  assert.equal(f.document.querySelectorAll(".github-user-real-name").length, 0);
  await f.advance(1000);
  assert.equal(f.requests.length, 2);
  assert.equal(f.document.querySelector(".github-user-real-name").textContent, "(张三)");
  assert.equal(f.errors.length, 1);
});

test("concurrent interactions share one request and failed refresh retains good cached names", async t => {
  const f = fixture(t, {
    html: authorLink + card(), storage: cached(),
    replies: [response("server error", 503), response()],
  });
  f.hover();
  f.hover();
  await f.advance(50);
  assert.equal(f.requests.length, 1);
  assert.equal(f.document.querySelector(".github-user-real-name").textContent, "(旧名字)");
  assert.equal(f.storage[CACHE_KEY][SOURCE].entries[0][1].name, "旧名字");
  await f.advance(1000);
  assert.equal(f.requests.length, 2);
  assert.equal(f.document.querySelector(".github-user-real-name").textContent, "(张三)");
});

test("login or malformed HTML does not replace a good cache or trigger automatic retries", async t => {
  const f = fixture(t, {
    html: card(), storage: cached(),
    replies: [response("<h1>Sign in to GitHub</h1>"), response()],
  });
  await f.advance(50);
  assert.equal(f.document.querySelector(".github-user-real-name").textContent, "(旧名字)");
  await f.advance(30000);
  assert.equal(f.requests.length, 1);
  await f.handler.replaceGitHubUserAliases();
  await settle();
  assert.equal(f.requests.length, 2);
  assert.equal(f.document.querySelector(".github-user-real-name").textContent, "(张三)");
});

test("permission errors are not hammered by automatic retries", async t => {
  const f = fixture(t, { html: card(), replies: [response("Forbidden", 403)] });
  await f.advance(120000);
  assert.equal(f.requests.length, 1);
  assert.equal(f.errors.length, 1);
});

test("a hung fetch is bounded even if it ignores abort, and a late response cannot overwrite recovery", async t => {
  const hung = deferred();
  const f = fixture(t, { html: card(), replies: [() => hung.promise, response()] });
  await f.advance(10050);
  assert.equal(f.requests[0].options.signal.aborted, true);
  await f.advance(1000);
  assert.equal(f.requests.length, 2);
  assert.equal(f.document.querySelector(".github-user-real-name").textContent, "(张三)");
  hung.resolve(response(directory("迟到的旧名字")));
  await settle();
  assert.equal(f.storage[CACHE_KEY][SOURCE].entries[0][1].name, "张三");
});

test("automatic retries stop after three retries, while a later hover can recover", async t => {
  const f = fixture(t, {
    html: authorLink + card(),
    replies: [...Array.from({ length: 4 }, () => new TypeError("blocked by extension")), response()],
  });
  await f.advance(120000);
  assert.equal(f.requests.length, 4);
  await f.advance(120000);
  assert.equal(f.requests.length, 4);
  f.hover();
  await f.advance(100);
  assert.equal(f.requests.length, 5);
  assert.equal(f.document.querySelector(".github-user-real-name").textContent, "(张三)");
});

test("online recovery retries a previously failed load immediately", async t => {
  const f = fixture(t, { html: card(), replies: [new TypeError("offline"), response()] });
  await f.advance(50);
  f.window.dispatchEvent(new f.window.Event("online"));
  await f.advance(100);
  assert.equal(f.requests.length, 2);
  assert.equal(f.document.querySelector(".github-user-real-name").textContent, "(张三)");
});

test("old organization responses cannot publish or save over a newer generation", async t => {
  const old = deferred();
  const other = "https://github.com/other-org/org";
  const f = fixture(t, {
    replies: [() => old.promise, response(directory("Other org")), response(directory("新名字"))],
    organizations: [{ directoryUrl: SOURCE }, { directoryUrl: other }],
  });
  const originalLoad = f.handler.replaceGitHubUserAliases();
  await settle();
  f.window.history.pushState({}, "", "/other-org/repo");
  await f.handler.replaceGitHubUserAliases();
  f.window.history.pushState({}, "", "/taptap/lite-client");
  await f.handler.replaceGitHubUserAliases();
  old.resolve(response(directory("Old org response")));
  await originalLoad;
  await settle();
  assert.equal(f.storage[CACHE_KEY][SOURCE].entries[0][1].name, "新名字");
  assert.equal(f.storage[CACHE_KEY][other].entries[0][1].name, "Other org");
});

test("one corrupt cached entry does not discard other valid entries", async t => {
  const storage = cached([null, {}, ["invalid", { name: {} }], ["porco-n", { name: "保留的名字" }]]);
  const f = fixture(t, { html: card(), storage, replies: [response("Forbidden", 403)] });
  await f.advance(100);
  assert.equal(f.document.querySelector(".github-user-real-name").textContent, "(保留的名字)");
});

test("successful mappings are reused and refreshed after five minutes", async t => {
  const f = fixture(t, { replies: [response(), response(directory("更新后的名字"))] });
  await f.handler.replaceGitHubUserAliases();
  await f.handler.replaceGitHubUserAliases();
  assert.equal(f.requests.length, 1);
  await f.advance(5 * 60 * 1000);
  await f.handler.replaceGitHubUserAliases();
  await settle();
  assert.equal(f.requests.length, 2);
  assert.equal(f.storage[CACHE_KEY][SOURCE].entries[0][1].name, "更新后的名字");
});

test("visible user identity takes priority over stale analytics on a reused card", async t => {
  const f = fixture(t, { html: card() });
  await f.advance(100);
  const container = f.document.querySelector(".Popover-message");
  container.setAttribute("data-hydro-view", JSON.stringify({ payload: { card_user_login: "porco-n" } }));
  const link = container.querySelector("a");
  link.href = "/unmapped-user";
  link.textContent = "unmapped-user";
  await f.advance(100);
  assert.equal(container.querySelectorAll(".github-user-real-name").length, 0);
});

test("a plugin that continuously removes names cannot cause an endless DOM fight", async t => {
  const f = fixture(t, { html: card(), debug: true });
  let removals = 0;
  const plugin = new f.window.MutationObserver(() => {
    const annotation = f.document.querySelector(".github-user-real-name");
    if (annotation) { removals++; annotation.remove(); }
  });
  plugin.observe(f.document.body, { childList: true, subtree: true });
  t.after(() => plugin.disconnect());
  await f.advance(10000);
  assert.ok(removals <= 4, "Restoring an annotation must be bounded if another plugin keeps deleting it");
  assert.equal(f.requests.length, 1);
  assert.ok(f.storage.LARK_LINKER_DEBUG_LOGS.some(log => log.label === "userAliases:repeatedNameRemoval"));
});

test("diagnostics distinguish an interaction, a cache read and a failed request", async t => {
  const f = fixture(t, { html: authorLink, replies: [response("Forbidden", 403)], debug: true });
  f.document.querySelector("a").dispatchEvent(new f.window.FocusEvent("focusin", { bubbles: true }));
  await f.advance(600);
  const labels = f.storage.LARK_LINKER_DEBUG_LOGS.map(log => log.label);
  for (const label of ["userAliases:userLinkInteraction", "userAliases:cacheLoaded", "userAliases:fetchStarted", "userAliases:fetchFailed"]) {
    assert.ok(labels.includes(label), `${label} should be observable`);
  }
  const failure = f.storage.LARK_LINKER_DEBUG_LOGS.find(log => log.label === "userAliases:fetchFailed");
  assert.equal(failure.status, 403);
  assert.equal(failure.automaticRetry, false);
});
