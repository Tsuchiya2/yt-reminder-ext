// content.js — robust 45s-before-end detector
(() => {
  const THRESHOLD = 45;         // 終了◯秒前
  const MIN_DURATION = 60;      // Shorts除外の閾値（必要なら調整）
  let notified = false;
  let videoId = getVideoId();

  console.log("[yt-reminder] content loaded:", location.href);

  // ---- helpers ----
  function getVideoId() {
    try { return new URL(location.href).searchParams.get("v"); }
    catch(e){ return null; }
  }
  function isFiniteDuration(v) {
    return v && Number.isFinite(v.duration) && v.duration > 0;
  }

  // 右下の小バナー
  function inlineHint() {
    const div = document.createElement("div");
    div.textContent = "まもなく終了です。高評価のご協力をお願いします！";
    Object.assign(div.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      background: "rgba(0,0,0,0.8)",
      color: "#fff",
      padding: "10px 14px",
      borderRadius: "8px",
      zIndex: 2147483647,
      fontSize: "14px"
    });
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 6000);
  }

  // 監視の本体（イベント + 500msポーリングの二段構え）
  function attachWatch(v) {
    console.log("[yt-reminder] video attached. duration:", v.duration);

    const check = () => {
      if (!isFiniteDuration(v)) return;
      if (v.duration <= MIN_DURATION) return;  // 短すぎる動画を除外
      const remain = v.duration - v.currentTime;
      // デバッグログ（必要ならコメントアウト）
      // console.log("[yt-reminder] remain:", Math.round(remain));

      if (!notified && remain > 0 && remain <= THRESHOLD) {
        notified = true;
        console.log("[yt-reminder] NEAR_END_NOTIFY for", videoId);
        chrome.runtime.sendMessage({ type: "NEAR_END_NOTIFY", videoId });
        inlineHint();
      }
    };

    ["timeupdate", "playing", "seeked", "loadedmetadata"].forEach(ev =>
      v.addEventListener(ev, check, { passive: true })
    );
    const iv = setInterval(check, 500);

    // 動画差し替え（YouTubeのSPA遷移）に追従
    new MutationObserver(() => {
      const newId = getVideoId();
      if (newId !== videoId) {
        console.log("[yt-reminder] video changed:", videoId, "->", newId);
        videoId = newId;
        notified = false;
      }
    }).observe(document.body, { childList: true, subtree: true });

    // ページ離脱でクリーンアップ（気になる場合のみ）
    window.addEventListener("beforeunload", () => clearInterval(iv));
  }

  // video要素が出るまで粘る
  function waitAndAttach() {
    const tryAttach = () => {
      const v = document.querySelector("video");
      if (v && (isFiniteDuration(v) || v.readyState > 0)) {
        attachWatch(v);
        return true;
      }
      return false;
    };
    if (tryAttach()) return;
    const iv = setInterval(() => { if (tryAttach()) clearInterval(iv); }, 500);
    // 初期ロードでDOMが組み上がるのを待つ
    const mo = new MutationObserver(() => { if (tryAttach()) { mo.disconnect(); clearInterval(iv); } });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 15000);
  }

  waitAndAttach();
})();
