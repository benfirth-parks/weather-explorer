/* App feedback box (shared by Ben's live apps). A small "Suggest a change" button in the corner opens a box where a
 * colleague types a suggestion. It posts to this site's Netlify form "app-feedback" (the hidden static copy of the
 * form in the page lets Netlify accept it). Suggestions then wait in Ben's COO dashboard for his approval before any
 * change is built. Usage: <script src="app-feedback.js" data-app="Weather Actuals" defer></script>
 * Self-contained: no libraries, its own styles under .afb-, nothing else on the page is touched. */
(function () {
  var me = document.currentScript;
  var APP = (me && me.getAttribute("data-app")) || document.title || "App";
  var css = [
    ".afb-btn{position:fixed;left:16px;bottom:16px;z-index:2147483000;font:600 14px/1 system-ui,sans-serif;padding:11px 14px;border-radius:22px;border:1px solid rgba(0,0,0,.15);background:#16202b;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;min-height:44px}",
    ".afb-btn:focus-visible,.afb-box button:focus-visible,.afb-box textarea:focus-visible,.afb-box input:focus-visible{outline:3px solid #7cc2ff;outline-offset:2px}",
    ".afb-box{position:fixed;left:16px;bottom:72px;z-index:2147483001;width:min(360px,calc(100vw - 32px));background:#fff;color:#16202b;border:1px solid #d9e0e7;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.25);padding:16px;font:15px/1.45 system-ui,sans-serif}",
    ".afb-box h2{margin:0 0 4px;font-size:17px}",
    ".afb-box p{margin:0 0 10px;color:#5b6876;font-size:13px}",
    ".afb-box textarea,.afb-box input{display:block;width:100%;box-sizing:border-box;font:16px system-ui,sans-serif;padding:9px 10px;border:1px solid #c5ced8;border-radius:8px;margin:0 0 8px;background:#fff;color:#16202b}",
    ".afb-box textarea{min-height:96px;resize:vertical}",
    ".afb-row{display:flex;gap:8px;justify-content:flex-end}",
    ".afb-row button{font:600 15px system-ui,sans-serif;padding:9px 14px;border-radius:8px;min-height:44px;cursor:pointer;border:1px solid #c5ced8;background:#fff;color:#16202b}",
    ".afb-row .afb-send{background:#ff5a1f;border-color:#ff5a1f;color:#fff}",
    ".afb-msg{font-size:14px;margin:6px 0 0}",
    "@media (prefers-color-scheme:dark){.afb-box{background:#18202a;color:#e6ebf0;border-color:#2a3542}.afb-box textarea,.afb-box input,.afb-row button{background:#0f141a;color:#e6ebf0;border-color:#2a3542}.afb-box p{color:#98a5b3}}",
    "@media print{.afb-btn,.afb-box{display:none}}"
  ].join("\n");

  function init() {
    if (document.querySelector(".afb-btn")) return;
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "afb-btn";
    btn.textContent = "Suggest a change";
    btn.setAttribute("aria-expanded", "false");

    var box = document.createElement("div");
    box.className = "afb-box";
    box.hidden = true;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Suggest a change");
    box.innerHTML =
      '<h2>Suggest a change</h2>' +
      '<p>What would make this app better for you? Ben reviews every suggestion.</p>' +
      '<label class="afb-sr" style="position:absolute;left:-9999px" for="afb-text">Suggestion</label>' +
      '<textarea id="afb-text" maxlength="2000" placeholder="e.g. Show the hourly table without having to click"></textarea>' +
      '<label style="position:absolute;left:-9999px" for="afb-name">Your name (optional)</label>' +
      '<input id="afb-name" maxlength="80" placeholder="Your name (optional)" autocomplete="name">' +
      '<div class="afb-row"><button type="button" class="afb-cancel">Cancel</button><button type="button" class="afb-send">Send</button></div>' +
      '<p class="afb-msg" aria-live="polite"></p>';

    document.body.appendChild(box);
    document.body.appendChild(btn);
    var text = box.querySelector("#afb-text"), name = box.querySelector("#afb-name"), msg = box.querySelector(".afb-msg");
    var send = box.querySelector(".afb-send");

    function toggle(open) {
      box.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      if (open) { msg.textContent = ""; text.focus(); }
    }
    btn.addEventListener("click", function () { toggle(box.hidden); });
    box.querySelector(".afb-cancel").addEventListener("click", function () { toggle(false); btn.focus(); });
    box.addEventListener("keydown", function (e) { if (e.key === "Escape") { toggle(false); btn.focus(); } });

    send.addEventListener("click", function () {
      var s = text.value.trim();
      if (!s) { msg.textContent = "Type a suggestion first."; text.focus(); return; }
      send.disabled = true;
      msg.textContent = "Sending…";
      var body = new URLSearchParams({
        "form-name": "app-feedback", app: APP, subject: "App feedback: " + APP,
        suggestion: s, name: name.value.trim(), page: location.pathname, "bot-field": ""
      });
      fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() })
        .then(function (r) {
          if (!r.ok) throw new Error("The server answered " + r.status);
          text.value = "";
          msg.textContent = "Thanks, sent to Ben.";
          setTimeout(function () { toggle(false); }, 1800);
        })
        .catch(function () { msg.textContent = "Couldn't send it. Check your connection and try again."; })
        .then(function () { send.disabled = false; });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
