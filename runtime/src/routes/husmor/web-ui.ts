export const HUSMOR_WEB_HTML = `<!DOCTYPE html>
<html lang="no">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Husmor">
<link rel="manifest" href="data:application/json,${encodeURIComponent(JSON.stringify({
  name: 'Husmor',
  short_name: 'Husmor',
  start_url: '/husmor/web',
  display: 'standalone',
  background_color: '#f8f7f4',
  theme_color: '#4a6741',
}))}">
<title>Husmor</title>
<style>
  :root {
    --bg: #f8f7f4;
    --surface: #fff;
    --text: #1a1a1a;
    --text-muted: #6b6b6b;
    --accent: #4a6741;
    --accent-light: #e8f0e6;
    --user-bubble: #4a6741;
    --user-text: #fff;
    --assistant-bubble: #fff;
    --border: #e5e3de;
    --input-bg: #fff;
    --sidebar-bg: #f0efe9;
    --radius: 16px;
    --safe-bottom: env(safe-area-inset-bottom, 0px);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    height: 100%;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    -webkit-text-size-adjust: 100%;
  }

  body {
    display: flex;
    height: 100dvh;
    overflow: hidden;
  }

  /* --- Login screen --- */
  #login {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    padding: 24px;
    gap: 16px;
  }
  #login h1 { font-size: 28px; font-weight: 700; color: var(--accent); }
  #login p { color: var(--text-muted); font-size: 14px; }
  #login input {
    width: 100%;
    max-width: 320px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
    font-size: 16px;
    outline: none;
    background: var(--surface);
  }
  #login input:focus { border-color: var(--accent); }
  #login button {
    width: 100%;
    max-width: 320px;
    padding: 14px;
    border: none;
    border-radius: 12px;
    background: var(--accent);
    color: #fff;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  #login .error { color: #c0392b; font-size: 13px; display: none; }

  /* --- App layout --- */
  #app { display: none; width: 100%; height: 100%; flex-direction: column; }
  #app.active { display: flex; }

  /* --- Header --- */
  header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    padding-top: max(12px, env(safe-area-inset-top, 0px));
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    gap: 12px;
    flex-shrink: 0;
  }
  header h1 { font-size: 18px; font-weight: 700; color: var(--accent); flex: 1; }
  header button {
    background: none;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 8px 14px;
    font-size: 14px;
    cursor: pointer;
    color: var(--text);
    min-height: 44px;
    min-width: 44px;
  }

  /* --- Sidebar (conversations) --- */
  #sidebar {
    display: none;
    position: fixed;
    top: 0; left: 0;
    width: 280px;
    height: 100%;
    background: var(--sidebar-bg);
    z-index: 100;
    flex-direction: column;
    border-right: 1px solid var(--border);
    padding-top: max(12px, env(safe-area-inset-top, 0px));
  }
  #sidebar.open { display: flex; }
  #sidebar-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    gap: 8px;
  }
  #sidebar-header h2 { font-size: 16px; font-weight: 600; flex: 1; }
  #sidebar-header button {
    background: none; border: none;
    font-size: 22px; cursor: pointer; color: var(--text-muted);
    min-height: 44px; min-width: 44px;
    display: flex; align-items: center; justify-content: center;
  }
  #conv-list {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .conv-item {
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    font-size: 14px;
    min-height: 48px;
    display: flex;
    align-items: center;
  }
  .conv-item:active { background: var(--accent-light); }
  .conv-item.active { background: var(--accent-light); font-weight: 600; }
  #sidebar-overlay {
    display: none;
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: rgba(0,0,0,0.3);
    z-index: 99;
  }
  #sidebar-overlay.open { display: block; }

  /* --- Messages --- */
  #messages {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .msg {
    max-width: 85%;
    padding: 12px 16px;
    border-radius: var(--radius);
    font-size: 15px;
    line-height: 1.5;
    word-wrap: break-word;
    white-space: pre-wrap;
  }
  .msg.user {
    align-self: flex-end;
    background: var(--user-bubble);
    color: var(--user-text);
    border-bottom-right-radius: 4px;
  }
  .msg.assistant {
    align-self: flex-start;
    background: var(--assistant-bubble);
    color: var(--text);
    border-bottom-left-radius: 4px;
    border: 1px solid var(--border);
  }
  .msg.streaming { opacity: 0.9; }
  #empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 15px;
    text-align: center;
    padding: 24px;
  }

  /* --- Input bar --- */
  #input-bar {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 12px 16px;
    padding-bottom: max(12px, var(--safe-bottom));
    background: var(--surface);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  #msg-input {
    flex: 1;
    padding: 12px 16px;
    border: 1px solid var(--border);
    border-radius: 24px;
    font-size: 16px;
    outline: none;
    resize: none;
    max-height: 120px;
    min-height: 48px;
    line-height: 1.4;
    font-family: inherit;
    background: var(--input-bg);
  }
  #msg-input:focus { border-color: var(--accent); }
  #send-btn {
    width: 48px;
    height: 48px;
    border: none;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    font-size: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  #send-btn:disabled { opacity: 0.4; cursor: default; }

  /* --- Desktop sidebar always visible --- */
  @media (min-width: 768px) {
    #sidebar {
      display: flex;
      position: relative;
      flex-shrink: 0;
    }
    #sidebar-overlay { display: none !important; }
    #sidebar-header button:last-child { display: none; }
    .msg { max-width: 70%; }
    #menu-btn { display: none; }
  }
</style>
</head>
<body>

<!-- Login -->
<div id="login">
  <h1>Husmor</h1>
  <p>Skriv inn tilgangskoden</p>
  <input id="token-input" type="password" placeholder="Tilgangskode" autocomplete="off">
  <button id="login-btn" onclick="doLogin()">Logg inn</button>
  <div class="error" id="login-error">Feil tilgangskode</div>
</div>

<!-- App -->
<div id="app">
  <!-- Sidebar -->
  <div id="sidebar-overlay" onclick="toggleSidebar()"></div>
  <div id="sidebar">
    <div id="sidebar-header">
      <h2>Samtaler</h2>
      <button onclick="newConversation()" title="Ny samtale">+</button>
      <button onclick="toggleSidebar()" title="Lukk">&times;</button>
    </div>
    <div id="conv-list"></div>
  </div>

  <!-- Main -->
  <div style="flex:1;display:flex;flex-direction:column;min-width:0;height:100%;">
    <header>
      <button id="menu-btn" onclick="toggleSidebar()">&#9776;</button>
      <h1>Husmor</h1>
      <button onclick="newConversation()">Ny samtale</button>
    </header>

    <div id="messages">
      <div id="empty-state">Send en melding for a starte</div>
    </div>

    <div id="input-bar">
      <textarea id="msg-input" rows="1" placeholder="Skriv en melding..." onkeydown="handleKey(event)" oninput="autoGrow(this)"></textarea>
      <button id="send-btn" onclick="sendMessage()" disabled>&#9654;</button>
    </div>
  </div>
</div>

<script>
let token = localStorage.getItem('husmor_token') || '';
let conversationId = null;
let streaming = false;

// Check for saved token on load
if (token) {
  verifyToken();
} else {
  document.getElementById('token-input').focus();
}

async function doLogin() {
  token = document.getElementById('token-input').value.trim();
  if (!token) return;
  const ok = await verifyToken();
  if (!ok) {
    document.getElementById('login-error').style.display = 'block';
    token = '';
  }
}

async function verifyToken() {
  try {
    const res = await fetch('/husmor/web/conversations', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (res.ok) {
      localStorage.setItem('husmor_token', token);
      document.getElementById('login').style.display = 'none';
      document.getElementById('app').classList.add('active');
      loadConversations();
      document.getElementById('msg-input').focus();
      setupViewport();
      return true;
    }
    return false;
  } catch { return false; }
}

function setupViewport() {
  // Handle mobile keyboard resize
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const vh = window.visualViewport.height;
      document.getElementById('app').style.height = vh + 'px';
      scrollToBottom();
    });
    window.visualViewport.addEventListener('scroll', () => {
      document.getElementById('app').style.height = window.visualViewport.height + 'px';
    });
  }
}

async function loadConversations() {
  try {
    const res = await fetch('/husmor/web/conversations', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    const list = document.getElementById('conv-list');
    list.innerHTML = '';
    for (const c of data.conversations) {
      const el = document.createElement('div');
      el.className = 'conv-item' + (c.id === conversationId ? ' active' : '');
      el.textContent = c.title || 'Uten tittel';
      el.onclick = () => loadConversation(c.id);
      list.appendChild(el);
    }
  } catch {}
}

async function loadConversation(id) {
  conversationId = id;
  try {
    const res = await fetch('/husmor/web/conversations/' + id + '/messages', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    const container = document.getElementById('messages');
    container.innerHTML = '';
    for (const m of data.messages) {
      addBubble(m.role, m.content);
    }
    scrollToBottom();
    loadConversations();
    toggleSidebar(false);
  } catch {}
}

function newConversation() {
  conversationId = null;
  document.getElementById('messages').innerHTML =
    '<div id="empty-state">Send en melding for a starte</div>';
  loadConversations();
  toggleSidebar(false);
  document.getElementById('msg-input').focus();
}

function toggleSidebar(force) {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  const open = force !== undefined ? force : !sb.classList.contains('open');
  sb.classList.toggle('open', open);
  ov.classList.toggle('open', open);
}

function addBubble(role, text) {
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.textContent = text;
  document.getElementById('messages').appendChild(el);
  return el;
}

function scrollToBottom() {
  const c = document.getElementById('messages');
  requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  document.getElementById('send-btn').disabled = !el.value.trim() || streaming;
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

async function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || streaming) return;

  streaming = true;
  input.value = '';
  input.style.height = 'auto';
  document.getElementById('send-btn').disabled = true;

  addBubble('user', text);
  scrollToBottom();

  const bubble = addBubble('assistant', '');
  bubble.classList.add('streaming');

  try {
    const res = await fetch('/husmor/web/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ conversationId, message: text }),
    });

    if (!res.ok) {
      bubble.textContent = 'Beklager, noe gikk galt.';
      bubble.classList.remove('streaming');
      streaming = false;
      document.getElementById('send-btn').disabled = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let fullReply = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split('\\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.text) {
            fullReply += d.text;
            bubble.textContent = fullReply;
            scrollToBottom();
          }
          if (d.done) {
            conversationId = d.conversationId;
            loadConversations();
          }
          if (d.error) {
            bubble.textContent = fullReply || 'Beklager, noe gikk galt.';
          }
        } catch {}
      }
    }

    if (!fullReply) {
      bubble.textContent = 'Beklager, fikk ikke noe svar.';
    }
  } catch {
    bubble.textContent = 'Nettverksfeil. Prov igjen.';
  }

  bubble.classList.remove('streaming');
  streaming = false;
  document.getElementById('send-btn').disabled = false;
  input.focus();
}

// Login form: Enter to submit
document.getElementById('token-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') doLogin();
});
</script>
</body>
</html>`;
