const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// Master B12 Configuration State
let config = {
  apiKey: process.env.GEMINI_API_KEY || "",
  password: process.env.DASHBOARD_PASS || "RKS2805",
  systemPrompt: "You are B12, a Venom-like AI (arrogant, sarcastic, authoritative, addressing user as RKS). If requested to toggle or control hardware, append a JSON command block at the end of your text in this exact format: [CMD: {\"action\":\"digitalWrite\",\"pin\":5,\"val\":1}]. Keep responses short, direct, and sharp.",
  pinMappings: { relay1: 5, relay2: 18, ledPwm: 19, rgbPin: 21 }
};

// Store connected ESP32 sockets
let esp32Sockets = new Set();

wss.on('connection', (ws) => {
  console.log('⚡ ESP32 or Web Client connected via WebSocket');
  esp32Sockets.add(ws);

  ws.on('message', (message) => {
    try {
      if (Buffer.isBuffer(message)) {
        console.log(`Received ${message.length} bytes of raw audio/data from ESP32`);
      } else {
        const data = JSON.parse(message.toString());
        console.log('Received JSON from ESP32:', data);
      }
    } catch (err) {
      console.log('Received message:', message.toString());
    }
  });

  ws.on('close', () => {
    console.log('❌ ESP32 disconnected');
    esp32Sockets.delete(ws);
  });
});

// Broadcast hardware instructions to ESP32 microcontrollers
function sendHardwareCommandToESP32(cmd) {
  const payload = JSON.stringify({ type: 'HARDWARE_CMD', command: cmd });
  esp32Sockets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

// Direct REST call to Gemini API using clean URL authentication
async function callGemini(promptText) {
  if (!config.apiKey) {
    throw new Error("API Key is missing!");
  }

  const cleanKey = config.apiKey.trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${cleanKey}`;

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
    const errText = await response.text();
    console.error("Gemini Error Detail:", errText);
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "Heh. Speechless, RKS?";
}

// Parse embedded [CMD: {...}] blocks from B12's reply
function parseAndExecuteCommands(replyText) {
  const cmdRegex = /\[CMD:\s*({.*?})\]/i;
  const match = replyText.match(cmdRegex);
  
  let cleanReply = replyText.replace(cmdRegex, '').trim();
  
  if (match && match[1]) {
    try {
      const cmdData = JSON.parse(match[1]);
      console.log('🎯 Hardware Command Triggered:', cmdData);
      sendHardwareCommandToESP32(cmdData);
    } catch (e) {
      console.error('Command parse error:', e.message);
    }
  }
  return cleanReply;
}

// REST API for Chat
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  try {
    const rawReply = await callGemini(message);
    const cleanedReply = parseAndExecuteCommands(rawReply);
    res.json({ success: true, reply: `B12: ${cleanedReply}` });
  } catch (err) {
    console.error("Chat Error:", err.message);
    res.json({
      success: false,
      reply: "B12: System glitch detected RKS! Rotating API Key... *grins*"
    });
  }
});

// Settings REST Endpoints
app.post('/api/settings', (req, res) => {
  const { apiKey, systemPrompt, pinMappings, pass } = req.body;

  if (pass && pass !== config.password) {
    return res.status(403).json({ success: false, message: "Access Denied: Invalid Dashboard Password!" });
  }

  if (apiKey !== undefined && apiKey.trim() !== "") config.apiKey = apiKey.trim();
  if (systemPrompt !== undefined) config.systemPrompt = systemPrompt;
  if (pinMappings !== undefined) config.pinMappings = pinMappings;

  console.log("Settings saved successfully!");
  res.json({ success: true, message: "Settings saved successfully!" });
});

app.get('/api/settings', (req, res) => {
  res.json({ 
    hasKey: !!config.apiKey, 
    systemPrompt: config.systemPrompt,
    pinMappings: config.pinMappings
  });
});

// Venom Dashboard
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
        .msg { margin: 10px 0; padding: 10px; border-radius: 4px; max-width: 80%; font-size: 14px; }
        .user { background: #1f0014; color: #ff3377; border: 1px solid #ff3377; margin-left: auto; text-align: right; }
        .bot { background: #001a0a; color: #00ff66; border: 1px solid #00ff66; }
        .input-bar { display: flex; gap: 10px; }
        input, button, textarea { background: #111; color: #00ff66; border: 1px solid #00ff66; padding: 12px; font-family: monospace; border-radius: 4px; }
        input, textarea { flex: 1; }
        button { cursor: pointer; background: #00ff66; color: #000; font-weight: bold; }
        button:hover { background: #00cc52; }
        .drawer { display: none; background: #0a0a0a; border: 1px dashed #00ff66; padding: 15px; margin-bottom: 15px; border-radius: 6px; }
        .field { margin: 10px 0; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>B12 VENOM CORE // RKS2805</h2>
        <button onclick="toggleDrawer()">⚙️ SETTINGS</button>
      </div>
      
      <div id="drawer" class="drawer">
        <h3>System Configuration</h3>
        <div class="field">
          <label>Dashboard Auth Password:</label><br>
          <input type="password" id="dashPass" placeholder="Default: RKS2805" style="width: 95%;">
        </div>
        <div class="field">
          <label>Gemini API Key:</label><br>
          <input type="password" id="apiKeyInput" placeholder="Paste Gemini API key..." style="width: 95%;">
        </div>
        <div class="field">
          <label>System Prompt (Venom Persona & Rules):</label><br>
          <textarea id="promptInput" rows="3" style="width: 95%;"></textarea>
        </div>
        <button onclick="saveSettings()">SAVE ALL CHANGES</button>
      </div>

      <div id="chat" class="chat-container">
        <div class="msg bot">B12 System Active. Waiting for RKS command... *evil laugh*</div>
      </div>
      
      <div class="input-bar">
        <input type="text" id="userInput" placeholder="Send prompt or hardware command..." onkeypress="if(event.key==='Enter') sendMsg()">
        <button onclick="sendMsg()">SEND</button>
      </div>

      <script>
        function toggleDrawer() {
          const d = document.getElementById('drawer');
          d.style.display = d.style.display === 'block' ? 'none' : 'block';
        }

        async function loadCurrentSettings() {
          const res = await fetch('/api/settings');
          const data = await res.json();
          if(data.systemPrompt) document.getElementById('promptInput').value = data.systemPrompt;
        }
        loadCurrentSettings();

        async function saveSettings() {
          const pass = document.getElementById('dashPass').value;
          const key = document.getElementById('apiKeyInput').value;
          const prompt = document.getElementById('promptInput').value;

          const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ pass, apiKey: key, systemPrompt: prompt })
          });
          const data = await res.json();
          alert(data.message);
          if(data.success) toggleDrawer();
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
  console.log(`B12 Venom Server running on port ${PORT} 🚀`);
});
