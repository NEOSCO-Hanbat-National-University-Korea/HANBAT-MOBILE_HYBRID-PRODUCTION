/**
 * Neosco Support — Mobile Live Session Script  (devsupport.wiseneoscoindia.com)
 * Include in <head>. Auto-starts live debug session. Recording is manual-only.
 *
 * UUID resolution order:
 *   1. window.deviceUUID   (set by your app before this script)
 *   2. localStorage "deviceUUID"  (persists across sessions on same device)
 *   3. Generated UUID, saved to localStorage
 *
 * Once your app has a meaningful user/session label, call:
 *   window.updateNeoscoTitle("screen-or-user-name");
 */
(function () {
  var HOST = "devsupport.wiseneoscoindia.com";
  var BUFFER_MAX_BYTES = 50 * 1024 * 1024; // 50 MB recording buffer
  var pendingTitle = null;
  var recordingActive = false;
  var debugMode = false;
  var debugModeSubscribers = [];
  var floatingPosition = null;

  // ─── UUID ──────────────────────────────────────────────────────────────────
  // window.deviceUUID is injected by the native wrapper ~150 ms after loadEnd,
  // so we cannot resolve it at parse-time. resolveUUID() is called inside
  // initSession() which runs after all remote scripts have loaded.

  function generateUUID() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  var uuid = null; // resolved lazily in initSession

  function resolveUUID() {
    var id = (typeof window.deviceUUID === "string" && window.deviceUUID) || null;
    if (!id) {
      try {
        id = localStorage.getItem("deviceUUID");
        if (!id) { id = generateUUID(); localStorage.setItem("deviceUUID", id); }
      } catch (e) { id = generateUUID(); }
    }
    // Keep localStorage in sync so debug identifier is stable across sessions
    if (id) { try { localStorage.setItem("deviceUUID", id); } catch (e) {} }
    uuid = id;
  }

  // Poll until window.deviceUUID is available (injected by native app), then run callback.
  // Falls through after ~300 ms so we never stall indefinitely.
  function waitForDeviceUUID(callback) {
    if (window.deviceUUID) { callback(); return; }
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (window.deviceUUID || tries >= 6) { clearInterval(timer); callback(); }
    }, 50);
  }

  // ─── Debug mode (persisted) ────────────────────────────────────────────────

  try { debugMode = localStorage.getItem("neoscoDebugMode") === "1"; } catch (e) {}

  function setDebugMode(enabled) {
    debugMode = !!enabled;
    try { localStorage.setItem("neoscoDebugMode", debugMode ? "1" : "0"); } catch (e) {}
    for (var i = 0; i < debugModeSubscribers.length; i++) {
      try { debugModeSubscribers[i](debugMode); } catch (e) {}
    }
    return debugMode;
  }

  // ─── Floating position (persisted) ────────────────────────────────────────

  try {
    var _pos = localStorage.getItem("neoscoFloatingPosition");
    if (_pos) {
      var _p = JSON.parse(_pos);
      if (_p && typeof _p.x === "number") floatingPosition = { x: _p.x, y: _p.y };
    }
  } catch (e) {}

  function setFloatingPosition(pos) {
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return null;
    floatingPosition = { x: pos.x, y: pos.y };
    try { localStorage.setItem("neoscoFloatingPosition", JSON.stringify(floatingPosition)); } catch (e) {}
    return { x: floatingPosition.x, y: floatingPosition.y };
  }

  // ─── Script loader ────────────────────────────────────────────────────────

  function loadScript(src, onload) {
    var s = document.createElement("script");
    s.src = src; s.crossOrigin = "anonymous"; s.onload = onload;
    s.onerror = function () { console.warn("[Neosco] Failed to load: " + src); };
    document.head.appendChild(s);
  }

  // ─── Startup: load all scripts, register plugins, then init session ───────
  //
  // DataHarborPlugin.upload() needs the debug session room params (roomId, clientId)
  // that are injected INTO the plugin during session init — so plugins MUST
  // be registered on the SDK class BEFORE instantiating the session.
  // We use autoStart:false so recording stays idle until the user taps the button.

  window.updateNeoscoTitle = function (title) {
    if (!title) return;
    pendingTitle = title;
    if (!window.$support || typeof window.$support.updateRoomInfo !== "function") return;
    var cur = window.$support.$pageSpyConfig && window.$support.$pageSpyConfig.title;
    if (cur !== title) window.$support.updateRoomInfo({ title: title });
  };

  function initSession() {
    if (typeof PageSpy !== "function") { console.warn("[Neosco] Debug SDK unavailable"); return; }

    // Resolve UUID now — window.deviceUUID should be available at this point
    resolveUUID();

    window.$harbor = new DataHarborPlugin({
      maximum: BUFFER_MAX_BYTES,
      autoStart: false,
      onAfterUpload: function (url) { console.info("[Neosco] Replay:", url); },
    });
    window.$rrweb = new RRWebPlugin({
      autoStart: false,
      maskInputOptions: { password: true, email: false },
      sampling: { mousemove: false, scroll: false, input: "last" },
      checkoutEveryNms: 5 * 60 * 1000,
    });

    PageSpy.registerPlugin(window.$harbor);
    PageSpy.registerPlugin(window.$rrweb);

    // Reuse existing session from sessionStorage to avoid creating a new room on reload.
    // PageSpy recreates the room whenever project/title change, so we preserve them.
    var sessionProject = null;
    var sessionTitle = "-";
    try {
      var _stored = JSON.parse(sessionStorage.getItem("page-spy-room") || "null");
      if (_stored && typeof _stored.project === "string" && _stored.project) {
        sessionProject = _stored.project;
        sessionTitle = _stored.title || "-";
        console.info("[Neosco] Resuming session:", _stored.address);
      }
    } catch (e) {}

    if (!sessionProject) {
      sessionProject = "HANBAT-" + uuid;
    }

    window.$support = new PageSpy({
      project: sessionProject,
      title: sessionTitle,
      autoRender: false,
    });

    if (pendingTitle) window.updateNeoscoTitle(pendingTitle);
  }

  // Load plugins → SDK (all needed before session init).
  // After all scripts are ready, wait for window.deviceUUID injection before starting.
  loadScript("https://" + HOST + "/plugin/data-harbor/index.min.js", function () {
    loadScript("https://" + HOST + "/plugin/rrweb/index.min.js", function () {
      loadScript("//" + HOST + "/page-spy/index.min.js", function () {
        waitForDeviceUUID(initSession);
      });
    });
  });

  // ─── Recording controls ───────────────────────────────────────────────────

  window.startNeoscoRecording = function () {
    if (!window.$rrweb || !window.$harbor) {
      console.warn("[Neosco] Plugins not ready yet");
      return;
    }
    if (window.$rrweb && typeof window.$rrweb.start === "function") window.$rrweb.start();
    if (window.$harbor && typeof window.$harbor.start === "function") window.$harbor.start();
    recordingActive = true;
    console.info("[Neosco] Recording started");
  };

  window.stopNeoscoRecording = function () {
    if (window.$rrweb && typeof window.$rrweb.stop === "function") window.$rrweb.stop();
    if (window.$harbor && typeof window.$harbor.stop === "function") window.$harbor.stop();
    recordingActive = false;
    console.info("[Neosco] Recording stopped");
  };

  window.discardNeoscoRecording = function () {
    window.stopNeoscoRecording();
    if (window.$harbor && typeof window.$harbor.reharbor === "function") window.$harbor.reharbor();
    console.info("[Neosco] Recording discarded");
  };

  window.doNeoscoUpload = function (onDone) {
    if (!window.$harbor || typeof window.$harbor.upload !== "function") {
      console.warn("[Neosco] Upload unavailable");
      if (typeof onDone === "function") onDone(false);
      return;
    }
    window.$harbor.upload({ clearCache: true })
      .then(function (url) { console.info("[Neosco] Uploaded:", url); if (typeof onDone === "function") onDone(true, url); })
      .catch(function (err) { console.warn("[Neosco] Upload failed:", err); if (typeof onDone === "function") onDone(false, err); });
  };

  window.isNeoscoRecordingActive = function () { return !!recordingActive; };

  // ─── Public API ───────────────────────────────────────────────────────────

  window.getNeoscoDebugMode = function () { return !!debugMode; };
  window.setNeoscoDebugMode = function (enabled) { return setDebugMode(enabled); };
  window.toggleNeoscoDebugMode = function () { return setDebugMode(!debugMode); };
  window.getNeoscoDebugIdentifier = function () { return uuid ? String(uuid).slice(0, 8) : "-"; };

  window.subscribeNeoscoDebugMode = function (callback) {
    if (typeof callback !== "function") return function () {};
    debugModeSubscribers.push(callback);
    try { callback(debugMode); } catch (e) {}
    return function () {
      var idx = debugModeSubscribers.indexOf(callback);
      if (idx >= 0) debugModeSubscribers.splice(idx, 1);
    };
  };

  window.getNeoscoFloatingPosition = function () {
    return floatingPosition ? { x: floatingPosition.x, y: floatingPosition.y } : null;
  };
  window.setNeoscoFloatingPosition = function (pos) { return setFloatingPosition(pos); };

  // ─── Floating debug button (self-contained, no React) ─────────────────────

  var _ui = { btn: null, overlay: null, pollId: null, raf: null, drag: { active: false, moved: false, ox: 0, oy: 0 } };

  var _ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>';

  function _lang() { try { return localStorage.getItem("app_language") || "ko"; } catch (e) { return "ko"; } }

  var _i18n = {
    ko: { stop: "녹화 중지", msg: "캡처한 데이터를 어떻게 처리하시겠습니까?", save: "저장 및 공유", discard: "삭제", keep: "계속 녹화",
          uploading: "업로드 중…", uploadOk: "업로드 완료!", uploadErr: "업로드 실패" },
    en: { stop: "Stop Recording?", msg: "What would you like to do with the captured data?", save: "Save & Share", discard: "Discard", keep: "Keep Recording",
          uploading: "Uploading…", uploadOk: "Upload complete!", uploadErr: "Upload failed" },
  };

  function _t(k) { var l = _lang(); return (_i18n[l] && _i18n[l][k]) || _i18n.en[k] || k; }

  // Brief toast notification — auto-dismisses after `duration` ms
  function _showToast(text, isError, duration) {
    var toast = document.createElement("div");
    toast.textContent = text;
    toast.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:20px;font-size:14px;font-weight:600;color:#fff;background:" + (isError ? "#ff3b30" : "#34c759") + ";box-shadow:0 4px 16px rgba(0,0,0,0.25);z-index:100001;pointer-events:none;white-space:nowrap;opacity:1;transition:opacity 0.3s;";
    document.body.appendChild(toast);
    var t = setTimeout(function () {
      toast.style.opacity = "0";
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 350);
    }, duration || 3000);
    return function () { clearTimeout(t); if (toast.parentNode) toast.parentNode.removeChild(toast); };
  }

  function _clampPos(x, y) {
    return { x: Math.min(Math.max(8, x), window.innerWidth - 56), y: Math.min(Math.max(8, y), window.innerHeight - 56) };
  }

  function _applyBtnPos() {
    if (!_ui.btn || !floatingPosition) return;
    _ui.btn.style.transform = "translate3d(" + floatingPosition.x + "px," + floatingPosition.y + "px,0)";
  }

  function _syncBtnColor() {
    if (!_ui.btn) return;
    _ui.btn.style.background = recordingActive ? "#ef4444" : "rgba(71,85,105,0.8)";
  }

  function _closeDialog() {
    if (!_ui.overlay) return;
    document.body.removeChild(_ui.overlay);
    _ui.overlay = null;
  }

  function _showDialog() {
    if (_ui.overlay) return;

    var ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:100000;display:flex;align-items:flex-end;padding:0 0 16px;box-sizing:border-box;";

    var sheet = document.createElement("div");
    sheet.style.cssText = "width:100%;padding:0 16px;max-width:480px;margin:0 auto;display:flex;flex-direction:column;gap:8px;";

    // action card (iOS action sheet style)
    var card = document.createElement("div");
    card.style.cssText = "border-radius:14px;overflow:hidden;";

    var header = document.createElement("div");
    header.style.cssText = "padding:14px 16px;text-align:center;background:#f2f2f7;";
    var tEl = document.createElement("p");
    tEl.textContent = _t("stop");
    tEl.style.cssText = "margin:0 0 4px;font-size:15px;font-weight:700;color:#1c1c1e;";
    var mEl = document.createElement("p");
    mEl.textContent = _t("msg");
    mEl.style.cssText = "margin:0;font-size:12px;color:#8e8e93;";
    header.appendChild(tEl);
    header.appendChild(mEl);

    function _mkBtn(label, color, weight, topBorder, bg, onClick) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = label;
      b.style.cssText = "display:block;width:100%;padding:15px;border:none;" + (topBorder ? "border-top:0.5px solid #c8c8cc;" : "") + "font-size:17px;font-weight:" + weight + ";color:" + color + ";background:" + bg + ";cursor:pointer;box-sizing:border-box;-webkit-tap-highlight-color:transparent;";
      b.addEventListener("click", onClick);
      b.addEventListener("pointerdown", function () { b.style.background = "#dcdce0"; });
      b.addEventListener("pointerup", function () { b.style.background = bg; });
      b.addEventListener("pointerleave", function () { b.style.background = bg; });
      return b;
    }

    card.appendChild(header);
    card.appendChild(_mkBtn(_t("save"),    "#34c759", "600", true,  "#f2f2f7", function () {
      _closeDialog();
      window.stopNeoscoRecording();
      var _dismissUploading = _showToast(_t("uploading"), false, 60000);
      window.doNeoscoUpload(function (ok) {
        _dismissUploading();
        _showToast(ok ? _t("uploadOk") : _t("uploadErr"), !ok, ok ? 3000 : 4000);
      });
    }));
    card.appendChild(_mkBtn(_t("discard"), "#ff3b30", "400", true,  "#f2f2f7", function () { _closeDialog(); window.discardNeoscoRecording(); }));

    // separate "keep" button
    var keepWrap = document.createElement("div");
    keepWrap.style.cssText = "border-radius:14px;overflow:hidden;";
    keepWrap.appendChild(_mkBtn(_t("keep"), "#1c1c1e", "600", false, "#fff", _closeDialog));

    sheet.appendChild(card);
    sheet.appendChild(keepWrap);
    ov.appendChild(sheet);
    document.body.appendChild(ov);
    _ui.overlay = ov;
  }

  function _onBtnPointerDown(e) {
    e.preventDefault();
    _ui.drag.active = true; _ui.drag.moved = false;
    var fp = floatingPosition || { x: 0, y: 0 };
    _ui.drag.ox = e.clientX - fp.x;
    _ui.drag.oy = e.clientY - fp.y;
    _ui.btn.setPointerCapture(e.pointerId);
  }

  function _onBtnPointerMove(e) {
    if (!_ui.drag.active) return;
    e.preventDefault();
    var c = _clampPos(e.clientX - _ui.drag.ox, e.clientY - _ui.drag.oy);
    var fp = floatingPosition || { x: 0, y: 0 };
    if (Math.abs(c.x - fp.x) > 2 || Math.abs(c.y - fp.y) > 2) _ui.drag.moved = true;
    floatingPosition = c;
    if (_ui.raf === null) {
      _ui.raf = requestAnimationFrame(function () { _ui.raf = null; _applyBtnPos(); });
    }
  }

  function _onBtnPointerUp(e) {
    _ui.drag.active = false;
    _ui.btn.releasePointerCapture(e.pointerId);
    if (_ui.raf !== null) { cancelAnimationFrame(_ui.raf); _ui.raf = null; }
    _applyBtnPos();
    setFloatingPosition(floatingPosition);
  }

  function _onBtnClick() {
    if (_ui.drag.moved) { _ui.drag.moved = false; return; }
    if (!recordingActive) { window.startNeoscoRecording(); }
    else { _showDialog(); }
  }

  function _showBubble() {
    if (_ui.btn) return;
    var saved = floatingPosition;
    var c = _clampPos(saved ? saved.x : window.innerWidth - 64, saved ? saved.y : window.innerHeight - 120);
    floatingPosition = c;
    var btn = document.createElement("button");
    btn.innerHTML = _ICON; btn.type = "button";
    btn.setAttribute("aria-label", "Neosco");
    btn.style.cssText = "position:fixed;left:0;top:0;width:48px;height:48px;border-radius:50%;border:none;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,0.25);cursor:pointer;z-index:99999;touch-action:none;will-change:transform;padding:0;outline:none;transition:background 0.2s;-webkit-tap-highlight-color:transparent;";
    _ui.btn = btn;
    _syncBtnColor();
    _applyBtnPos();
    btn.addEventListener("pointerdown", _onBtnPointerDown);
    btn.addEventListener("pointermove", _onBtnPointerMove);
    btn.addEventListener("pointerup", _onBtnPointerUp);
    btn.addEventListener("click", _onBtnClick);
    document.body.appendChild(btn);
    _ui.pollId = setInterval(_syncBtnColor, 400);
  }

  function _hideBubble() {
    if (_ui.pollId) { clearInterval(_ui.pollId); _ui.pollId = null; }
    _closeDialog();
    if (_ui.btn) { document.body.removeChild(_ui.btn); _ui.btn = null; }
  }

  window.subscribeNeoscoDebugMode(function (enabled) {
    if (enabled) {
      if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", _showBubble); }
      else { _showBubble(); }
    } else {
      _hideBubble();
    }
  });
})();
