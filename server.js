const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// System state configuration
let config = {
  apiKey: process.env.GEMINI_API_KEY || "",
  systemPrompt: "You are B12, a Venom-like AI (arrogant, sarcastic, authoritative, addressing user as RKS). Respond concisely and sharply.",
  pinMappings: { relay1: 5, relay2: 18 }
};

// WebSocket handling for ESP32 & clients
wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');
  ws.send(JSON.stringify({ type: 'STATUS', message: 'B12 WebSocket Active' }));

  ws.on('message', (message) => {
    console.log('Received WS message:', message.toString());
  });
});

// Direct REST call using gemini-2.0-flash
async function callGemini(promptText) {
  const activeKey = (config.apiKey || process.env.GEMINI_API_KEY || "").trim();

  if (!activeKey) {
    throw new Error("API Key is missing! Set it in Settings or Render Environment Variables.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${activeKey}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${config.systemPrompt}\nUser RKS: ${promptText}` }]
      }
    ]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini Direct REST Error Raw:", errorText);
    throw new Error(`HTTP ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return reply || "Heh. Speechless, RKS?";
}

// Chat API Route
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  try {
    const reply = await callGemini(message);
    res.json({ success: true, reply: `B12: ${reply}` });
  } catch (err) {
    console.error("Chat Process Error:", err.message);
    res.json({
      success: false,
      reply: `B12 Error Detail -> ${err.message}`
    });
  }
});

// Settings Endpoints
app.post('/api/settings', (req, res) => {
  const { apiKey, systemPrompt } = req.body;
  if (apiKey !== undefined) config.apiKey = apiKey.trim();
  if (systemPrompt !== undefined) config.systemPrompt = systemPrompt;
  console.log("Settings updated! Active key length:", config.apiKey.length);
  res.json({ success: true, message: "Settings saved successfully!" });
});

app.get('/api/settings', (req, res) => {
  res.json({ apiKey: config.apiKey ? "********" : "", systemPrompt: config.systemPrompt });
});

// Venom Core Control Center Dashboard
app.get('/RKS2805sB12', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>VENOM CORE // RKS2805</title>
      <style>
        body { background: #050505; color: #00ff66; font-family: monospace; margin: 0; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #00ff66; padding-bottom: 10px; }
        .chat-container { border: 1px solid #00ff66; padding: 15px; height: 350px; overflow-y: auto; margin: 15px 0; background: #000; border-radius: 6px; }
        .msg { margin: 10px 0; padding: 10px; border-radius: 4px; max-width: 85%; font-size: 14px; word-break: break-word; }
        .user { background: #1f0014; color: #ff3377; border: 1px solid #ff3377; margin-left: auto; text-align: right; }
        .bot { background: #001a0a; color: #00ff66; border: 1px solid #00ff66; }
        .input-bar { display: flex; gap: 10px; }
        input, button { background: #111; color: #00ff66; border: 1px solid #00ff66; padding: 12px; font-family: monospace; border-radius: 4px; }
        input { flex: 1; }
        button { cursor: pointer; background: #00ff66; color: #000; font-weight: bold; }
        button:hover { background: #00cc52; }
        .drawer { display: none; background: #0a0a0a; border: 1px dashed #00ff66; padding: 15px; margin-bottom: 15px; border-radius: 6px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>B12 VENOM CORE // RKS2805</h2>
        <button onclick="toggleDrawer()">⚙️ SETTINGS</button>
      </div>
      
      <div id="drawer" class="drawer">
        <h3>Backend Configuration</h3>
        <label>Gemini API Key:</label><br>
        <input type="password" id="apiKeyInput" placeholder="Paste Gemini API key..." style="width: 95%; margin: 8px 0;"><br>
        <button onclick="saveSettings()">SAVE ALL CHANGES</button>
      </div>

      <div id="chat" class="chat-container">
        <div class="msg bot">B12 System Active. Waiting for RKS command... *evil laugh*</div>
      </div>
      
      <div class="input-bar">
        <input type="text" id="userInput" placeholder="Send prompt to B12..." onkeypress="if(event.key==='Enter') sendMsg()">
        <button onclick="sendMsg()">SEND</button>
      </div>

      <script>
        function toggleDrawer() {
          const d = document.getElementById('drawer');
          d.style.display = d.style.display === 'block' ? 'none' : 'block';
        }

        async function saveSettings() {
          const key = document.getElementById('apiKeyInput').value;
          if(!key) { alert('Please enter an API key'); return; }
          const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ apiKey: key })
          });
          const data = await res.json();
          alert(data.message);
          toggleDrawer();
        }

        async function sendMsg() {
          const input = document.getElementById('userInput');
          const text = input.value.trim();
          if(!text) return;
          
          const chat = document.getElementById('chat');
          chat.innerHTML += '<div class="msg user">RKS: ' + text + '</div>';
          input.value = '';
          chat.scrollTop = chat.scrollHeight;

          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ message: text })
          });
          const data = await res.json();
          chat.innerHTML += '<div class="msg bot">' + data.reply + '</div>';
          chat.scrollTop = chat.scrollHeight;
        }
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`B12 Venom Server running on port ${PORT}`);
});
