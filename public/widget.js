(() => {
  const BASE_URL = (document.currentScript && new URL(document.currentScript.src).origin) || location.origin;

  // DOM helper
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "style") Object.assign(el.style, v);
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      if (typeof c === "string") el.appendChild(document.createTextNode(c));
      else el.appendChild(c);
    }
    return el;
  };

  // persistent client id
  const LS_KEY = "stealthChat:clientId";
  let clientId = localStorage.getItem(LS_KEY) || crypto.randomUUID();
  localStorage.setItem(LS_KEY, clientId);

  // username (varsa data-username)
  const scriptEl = document.currentScript;
  const username = (scriptEl && scriptEl.dataset && scriptEl.dataset.username) || "Ziyaretçi";

  // UI State
  let minimized = false;
  let unread = 0;
  let peekTimer = null;

  // Styles (hafif, modern)
  const style = document.createElement("style");
  style.textContent = `
  @keyframes pop { 0%{transform:scale(.9);opacity:.5} 100%{transform:scale(1);opacity:1} }
  @keyframes fadeIn { from{opacity:0; transform: translateY(6px)} to{opacity:1; transform: translateY(0)} }
  @keyframes fadeOut { from{opacity:1} to{opacity:0} }
  .sc-wrap{ position:fixed; right:16px; bottom:16px; width:320px; max-width:calc(100vw - 32px); font-family: ui-sans-serif, system-ui, -apple-system; z-index:999999; }
  .sc-card{ background:#101114; color:#fff; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,.35); overflow:hidden; border:1px solid rgba(255,255,255,.07); }
  .sc-header{ display:flex; align-items:center; gap:10px; padding:12px; background:linear-gradient(180deg,#1b1f2a,#151822); }
  .sc-brand{ display:flex; align-items:center; gap:8px; font-weight:600; }
  .sc-dot{ width:10px; height:10px; border-radius:999px; background:#4ade80; box-shadow:0 0 12px #4ade80; }
  .sc-actions{ margin-left:auto; display:flex; align-items:center; gap:8px; }
  .sc-btn{ background:#232634; border:1px solid rgba(255,255,255,.08); color:#fff; border-radius:10px; padding:6px 10px; cursor:pointer; transition:transform .08s ease, opacity .2s; }
  .sc-btn:hover{ transform:translateY(-1px); }
  .sc-body{ background:#0e0f14; max-height:420px; min-height:280px; overflow:auto; display:flex; flex-direction:column; gap:8px; padding:12px; }
  .sc-msg{ max-width:80%; padding:8px 10px; border-radius:12px; animation:fadeIn .2s ease; word-wrap:break-word; }
  .sc-msg.client{ background:#222632; border:1px solid rgba(255,255,255,.06); align-self:flex-end; }
  .sc-msg.admin{ background:#1a1f2b; border:1px solid rgba(255,255,255,.06); align-self:flex-start; }
  .sc-msg img{ max-width:100%; border-radius:10px; display:block }
  .sc-msg audio{ width:100%; }
  .sc-input{ display:flex; align-items:center; gap:8px; padding:10px; background:#12141b; border-top:1px solid rgba(255,255,255,.08); }
  .sc-field{ flex:1; background:#0c0d13; border:1px solid rgba(255,255,255,.08); color:#fff; border-radius:10px; padding:10px; outline:none; }
  .sc-min{ position:fixed; right:16px; bottom:16px; background:#101114; color:#fff; border:1px solid rgba(255,255,255,.08); border-radius:999px; padding:12px 16px; display:none; align-items:center; gap:10px; box-shadow:0 10px 25px rgba(0,0,0,.35); cursor:pointer; }
  .sc-badge{ min-width:20px; height:20px; border-radius:999px; background:#ef4444; color:#fff; font-size:12px; display:flex; align-items:center; justify-content:center; padding:0 6px; }
  .sc-peek{ position:fixed; right:16px; bottom:70px; background:#151826; color:#fff; border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:10px 12px; box-shadow:0 10px 25px rgba(0,0,0,.35); opacity:0; pointer-events:none; }
  `;
  document.head.appendChild(style);

  // Elements
  const wrap = h("div", { class: "sc-wrap" });
  const card = h("div", { class: "sc-card", style:{ animation:"pop .12s ease" }});

  const header = h("div", { class: "sc-header" },
    h("div", { class: "sc-brand" },
      h("div", { class: "sc-dot" }),
      h("div", {}, "Sohbet (Anon)")
    ),
    h("div", { class: "sc-actions" },
      h("button", { class:"sc-btn", title:"Küçült", onclick: toggleMinimize }, "—"),
      h("button", { class:"sc-btn", title:"Kapat", onclick: () => { wrap.style.display='none'; minBtn.style.display='flex'; } }, "×")
    )
  );

  const body = h("div", { class: "sc-body" });
  const inputRow = h("div", { class: "sc-input" });
  const fileBtn = h("input", { type:"file", accept:"image/*", style:{ display:"none" }});
  const recordBtn = h("button", { class:"sc-btn", title:"Ses Kaydı Başlat/Durdur" }, "🎙");
  const attachBtn = h("button", { class:"sc-btn", title:"Görsel Gönder", onclick: () => fileBtn.click() }, "🖼");
  const field = h("input", { class:"sc-field", placeholder:"Mesaj yaz..." });
  const sendBtn = h("button", { class:"sc-btn" }, "Gönder");
  inputRow.append(fileBtn, attachBtn, recordBtn, field, sendBtn);

  card.append(header, body, inputRow);
  wrap.append(card);
  document.body.appendChild(wrap);

  const minBtn = h("div", { class:"sc-min", onclick: () => { wrap.style.display='block'; minBtn.style.display='none'; unread = 0; updateBadge(); }},
    h("span", {}, "Sohbet"),
    h("div", { class:"sc-badge" }, "0"),
  );
  document.body.appendChild(minBtn);

  const peek = h("div", { class:"sc-peek" });
  document.body.appendChild(peek);

  function toggleMinimize() {
    minimized = !minimized;
    if (minimized) {
      wrap.style.display = "none";
      minBtn.style.display = "flex";
    } else {
      wrap.style.display = "block";
      minBtn.style.display = "none";
      unread = 0; updateBadge();
    }
  }
  function updateBadge() {
    minBtn.querySelector(".sc-badge").textContent = String(unread);
  }
  function showPeek(text) {
    peek.textContent = text.length > 60 ? text.slice(0,60) + "…" : text;
    peek.style.opacity = "1";
    peek.style.animation = "fadeIn .2s ease";
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => {
      peek.style.animation = "fadeOut .5s ease";
      setTimeout(()=> { peek.style.opacity="0"; }, 500);
    }, 2000);
  }

  // WebSocket bağlan
  const ws = new WebSocket(`${BASE_URL.replace("http","ws")}/?role=client&clientId=${encodeURIComponent(clientId)}&username=${encodeURIComponent(username)}`);
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type:"client:history" }));
  });
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "client:history" && Array.isArray(msg.data)) {
      body.innerHTML = "";
      for (const m of msg.data) renderMsg(m.sender, m.type, m.content, m.ts);
      body.scrollTop = body.scrollHeight;
    }
    if (msg.type === "message") {
      renderMsg(msg.from, msg.kind, msg.content, msg.ts);
      if (msg.from === "admin" && minimized) {
        unread++; updateBadge();
        if (msg.kind === "text") showPeek(msg.content);
        else showPeek(msg.kind === "image" ? "📷 Görsel" : "🎧 Ses");
      }
    }
  });

  function renderMsg(from, kind, content, ts) {
    const el = h("div", { class: `sc-msg ${from}` });
    if (kind === "text") el.textContent = content;
    if (kind === "image") {
      const img = h("img", { src: content, alt:"image" });
      el.append(img);
    }
    if (kind === "audio") {
      const audio = h("audio", { controls:true, src: content });
      el.append(audio);
    }
    const small = h("div", { style:{ opacity:.5, fontSize:"11px", marginTop:"4px" }}, new Date(ts||Date.now()).toLocaleString());
    el.appendChild(small);
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  // Gönderim
  sendBtn.addEventListener("click", () => {
    const text = field.value.trim();
    if (!text) return;
    ws.send(JSON.stringify({ type:"client:send", payload:{ text, kind:"text" } }));
    field.value = "";
  });
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendBtn.click();
  });

  // Görsel upload
  fileBtn.addEventListener("change", async () => {
    if (!fileBtn.files || !fileBtn.files[0]) return;
    const fd = new FormData();
    fd.append("file", fileBtn.files[0]);
    fd.append("clientId", clientId);
    fd.append("role", "client");
    const res = await fetch(`${BASE_URL}/api/upload/image`, { method:"POST", body:fd });
    await res.json();
    fileBtn.value = "";
  });

  // Ses kaydı
  let mediaRecorder = null;
  let chunks = [];
  recordBtn.addEventListener("click", async () => {
    if (!mediaRecorder) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type:"audio/webm" });
        chunks = [];
        const file = new File([blob], "voice.webm", { type:"audio/webm" });
        const fd = new FormData();
        fd.append("file", file);
        fd.append("clientId", clientId);
        fd.append("role", "client");
        await fetch(`${BASE_URL}/api/upload/audio`, { method:"POST", body:fd });
      };
      mediaRecorder.start();
      recordBtn.textContent = "⏹";
    } else {
      mediaRecorder.stop();
      mediaRecorder = null;
      recordBtn.textContent = "🎙";
    }
  });
})();
