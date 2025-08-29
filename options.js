// 既定値（ここにチャンネルIDを固定）
const DEFAULTS = {
  channelId: "UCwjx6ZG4pwCvAPSozYEWymA",
  checkTimesJst: ["19:02"],
  weekdaysToCheck: [3,6]
};

function load(){
  chrome.storage.sync.get({config: DEFAULTS}, ({config})=>{
    document.getElementById("channelId").value = (config.channelId ?? DEFAULTS.channelId);
    document.getElementById("times").value     = (config.checkTimesJst ?? DEFAULTS.checkTimesJst).join(",");
    document.getElementById("days").value      = (config.weekdaysToCheck ?? DEFAULTS.weekdaysToCheck).join(",");
  });
}

function save(){
  const cfg = {
    channelId: document.getElementById("channelId").value.trim(),
    checkTimesJst: document.getElementById("times").value.split(",").map(s=>s.trim()).filter(Boolean),
    weekdaysToCheck: document.getElementById("days").value.split(",").map(s=>parseInt(s,10)).filter(n=>!isNaN(n))
  };
  chrome.storage.sync.set({config: cfg}, ()=>{
    const msg = document.getElementById("msg");
    msg.textContent = "保存しました";
    setTimeout(()=>msg.textContent="", 1500);
  });
}

function resetToDefaults(){
  chrome.storage.sync.set({config: DEFAULTS}, load);
}

document.addEventListener("DOMContentLoaded", ()=>{
  document.getElementById("save").addEventListener("click", save);
  document.getElementById("reset").addEventListener("click", resetToDefaults);
  load();
});
