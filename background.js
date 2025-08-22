// === 既定設定（オプションで上書き可能） ===
const DEFAULTS = {
  channelId: "UCwjx6ZG4pwCvAPSozYEWymA", // エンジニア転職チャンネル
  checkTimesJst: ["19:00", "19:15"],     // 公開遅れに備えて複数回
  weekdaysToCheck: [3, 6]                // 0=日,1=月,...,6=土（ここでは水・土）
};

const FEED_BASE = "https://www.youtube.com/feeds/videos.xml?channel_id=";

// 初回インストール時：既定値を書き込み＆当日分のアラームを設定
chrome.runtime.onInstalled.addListener(async () => {
  const { config } = await chrome.storage.sync.get("config");
  if (!config) {
    await chrome.storage.sync.set({ config: DEFAULTS });
    console.log("[yt-reminder] seeded defaults:", DEFAULTS);
  }
  await setDailyAlarms();
});

chrome.runtime.onStartup.addListener(setDailyAlarms);

// ---- アラーム設定 ----
async function setDailyAlarms() {
  const cfg = await getConfig();
  await chrome.alarms.clearAll();

  const now = new Date();
  const jstNow = toJst(now);
  const weekday = jstNow.getDay();
  const shouldCheckToday = (cfg.weekdaysToCheck || DEFAULTS.weekdaysToCheck).includes(weekday);

  const times = shouldCheckToday ? (cfg.checkTimesJst || DEFAULTS.checkTimesJst) : [];
  const ymd = `${jstNow.getFullYear()}-${pad(jstNow.getMonth() + 1)}-${pad(jstNow.getDate())}`;

  for (const t of times) {
    const whenMs = jstDateTimeToEpochMs(ymd, t);
    if (whenMs > Date.now()) {
      chrome.alarms.create(`check-${t}`, { when: whenMs });
      console.log("[yt-reminder] alarm created:", `check-${t}`, "->", new Date(whenMs).toISOString());
    }
  }

  // 翌日9:00(JST)に再設定
  const next9JstMs = jstDateTimeToEpochMs(nextDateJst(ymd), "09:00");
  chrome.alarms.create("reset-next-day", { when: next9JstMs });
  console.log("[yt-reminder] alarm created: reset-next-day ->", new Date(next9JstMs).toISOString());
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "reset-next-day") {
    console.log("[yt-reminder] reset-next-day fired");
    return setDailyAlarms();
  }
  if (alarm.name.startsWith("check-")) {
    console.log("[yt-reminder] check alarm fired:", alarm.name);
    checkLatestAndNotify().catch(console.error);
  }
});

// ---- 設定/状態 ----
async function getConfig() {
  return new Promise((resolve) =>
    chrome.storage.sync.get({ config: DEFAULTS }, (res) => resolve(res.config || DEFAULTS))
  );
}
async function getState() {
  return new Promise((resolve) =>
    chrome.storage.sync.get({ state: {} }, (res) => resolve(res.state || {}))
  );
}
async function setState(state) {
  return new Promise((resolve) => chrome.storage.sync.set({ state }, resolve));
}

// ---- 新着検知 & 通知 ----
async function checkLatestAndNotify() {
  const cfg = await getConfig();
  if (!cfg.channelId) return;

  const latest = await fetchLatestViaRss(cfg.channelId).catch((e) => {
    console.error("[yt-reminder] RSS fetch error:", e);
    return null;
  });
  if (!latest) return;

  const st = await getState();
  if (st.lastVideoId === latest.videoId) {
    console.log("[yt-reminder] already notified for", latest.videoId);
    return; // 二重通知防止
  }

  const notifId = `new-${latest.videoId}`;
  await chrome.notifications.create(notifId, {
    type: "basic",
    title: "新しい動画が公開されました",
    message: latest.title || "YouTube 新着",
    iconUrl: "icons/icon128.png",
    buttons: [{ title: "今すぐ開く" }, { title: "あとで" }],
    priority: 2
  });

  const onClick = (id, btnIdx) => {
    if (id !== notifId) return;
    if (btnIdx === 0) chrome.tabs.create({ url: latest.url });
    chrome.notifications.clear(id);
    chrome.notifications.onButtonClicked.removeListener(onClick);
  };
  chrome.notifications.onButtonClicked.addListener(onClick);

  st.lastVideoId = latest.videoId;
  await setState(st);

  console.log("[yt-reminder] notified:", latest.videoId, latest.title, latest.url);
}

// RSSから「最新の長尺動画（Shorts除外）」を1件取得
async function fetchLatestViaRss(channelId) {
  const url = `${FEED_BASE}${encodeURIComponent(channelId)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`RSS status ${res.status}`);
  const text = await res.text();

  // すべての <entry> を新しい順に走査
  const entries = [...text.matchAll(/<entry>[\s\S]*?<\/entry>/g)];
  for (const m of entries) {
    const entryXml = m[0];

    const videoId = (entryXml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const href = (entryXml.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/) || [])[1];
    const title = (entryXml.match(/<title>([^<]+)<\/title>/) || [])[1] || "";

    if (!videoId || !href) continue;

    // ---- Shorts 判定（複数条件）----
    const isShortByUrl   = /\/shorts\//i.test(href);
    const isShortByTitle = /#shorts\b/i.test(title) || /\bshorts\b/i.test(title);
    if (isShortByUrl || isShortByTitle) {
      continue; // Shortsは通知しない
    }

    // 念のため /watch に正規化（/shorts が来てもwatchに直す）
    const watchUrl = href.includes("/watch")
      ? href
      : `https://www.youtube.com/watch?v=${videoId}`;

    return { videoId, title, url: watchUrl };
  }

  // 直近がすべてShorts等で長尺が見つからない場合
  console.log("[yt-reminder] no eligible long-form entry in feed.");
  return null;
}

// ---- JSTユーティリティ ----
function toJst(d) { return new Date(d.getTime() + 9 * 3600 * 1000); }
function pad(n) { return String(n).padStart(2, "0"); }
function jstDateTimeToEpochMs(ymd, hhmm) {
  const [y, m, day] = ymd.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  // JST(UTC+9) を UTC に変換してミリ秒を出す
  return Date.UTC(y, m - 1, day, h - 9, min, 0);
}
function nextDateJst(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const j = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  j.setUTCDate(j.getUTCDate() + 1);
  const jst = toJst(j);
  return `${jst.getFullYear()}-${pad(jst.getMonth() + 1)}-${pad(jst.getDate())}`;
}

// ---- content.js からの「終了45秒前」通知を受け取る ----
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "NEAR_END_NOTIFY") {
    console.log("[yt-reminder] NEAR_END_NOTIFY received for", msg.videoId, "from tab", sender?.tab?.id);
    const id = `near-end-${msg.videoId}-${Date.now()}`;

    const onClick = (nid, btnIdx) => {
      if (nid !== id) return;
      if (btnIdx === 0 && sender?.tab?.id) chrome.tabs.update(sender.tab.id, { active: true });
      chrome.notifications.clear(nid);
      chrome.notifications.onButtonClicked.removeListener(onClick);
    };

    chrome.notifications.create(id, {
      type: "basic",
      title: "まもなく動画が終わります",
      message: "視聴おつかれさま！よければ高評価をお願いします。",
      iconUrl: "icons/icon128.png",
      buttons: [{ title: "タブを前面にする" }],
      priority: 2
    });
    chrome.notifications.onButtonClicked.addListener(onClick);
  }
});
