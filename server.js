const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// dynamic state with hardware pin mappings
let config = {
  apiKey: process.env.GEMINI_API_KEY || "",
  systemPrompt: "You are B12, a Venom-like AI (arrogant, sarcastic, authoritative, addressing user as RKS). Respond concisely and sharply.",
  pinMappings: [
    { pinName: "D5", deviceType: "Relay", loadName: "Light", status: "OFF" },
    { pinName: "D18", deviceType: "Relay", loadName: "Fan", status: "OFF" }
  ]
};

// WebSocket Broadcast to ESP32
function broadcastToESP32(actionData) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(actionData));
    }
  });
}

wss.on('connection', (ws) => {
  console.log('ESP32 / Client Connected via WebSocket 📡');
  ws.send(JSON.stringify({ type: 'STATUS', message: 'B12 Venom WebSocket Core Active' }));

  ws.on('message', (message) => {
    console.log('WS Received:', message.toString());
  });
});

// Fast Gemini REST API Call with Hardware Logic
async function callGemini(promptText) {
  const activeKey = (config.apiKey || process.env.GEMINI_API_KEY || "").trim();

  if (!activeKey) {
    throw new Error("API Key is missing! Set it in Settings or Render Environment Variables.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${activeKey}`;

  // Feed current hardware pin configuration to AI
  const hwContext = `\nCURRENT ESP32 HARDWARE SETUP:\n${JSON.stringify(config.pinMappings)}\n` +
    `If RKS asks to turn ON/OFF any device/relay/pin, include an ACTION TAG at the end of your response like: [ACTION:{"pin":"PIN_NAME","state":"ON/OFF"}]. Otherwise, just reply normally. Keep response very short and fast.`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${config.systemPrompt}${hwContext}\nUser RKS: ${promptText}` }]
      }
    ],
    generationConfig: {
      maxOutputTokens: 150,
      temperature: 0.7
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "Speechless, RKS?";
}

// Chat API Route & Hardware Trigger Parser
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  try {
    let rawReply = await callGemini(message);
    
    // Parse Action Commands for ESP32
    const actionMatch = rawReply.match(/\[ACTION:(.*?)\]/);
    if (actionMatch) {
      try {
        const actionObj = JSON.parse(actionMatch[1]);
        broadcastToESP32({ type: "HARDWARE_CONTROL", ...actionObj });
        
        // Update local status state
        const targetPin = config.pinMappings.find(p => p.pinName.toLowerCase() === actionObj.pin.toLowerCase());
        if (targetPin) targetPin.status = actionObj.state;

        // Clean action tag from voice/text reply
        rawReply = rawReply.replace(/\[ACTION:.*?\]/, '').trim();
      } catch (e) {
        console.error("Action Parsing Error:", e.message);
      }
    }

    res.json({ success: true, reply: `B12: ${rawReply}` });
  } catch (err) {
    console.error("Chat Error:", err.message);
    res.json({ success: false, reply: `B12 Error Detail -> ${err.message}` });
  }
});

// Settings API Route
app.post('/api/settings', (req, res) => {
  const { apiKey, systemPrompt, pinMappings } = req.body;
  if (apiKey !== undefined) config.apiKey = apiKey.trim();
  if (systemPrompt !== undefined) config.systemPrompt = systemPrompt;
  if (pinMappings !== undefined) config.pinMappings = pinMappings;
  res.json({ success: true, message: "Venom Core Settings Saved!" });
});

app.get('/api/settings', (req, res) => {
  res.json({ 
    apiKey: config.apiKey ? "********" : "", 
    systemPrompt: config.systemPrompt,
    pinMappings: config.pinMappings
  });
});

// Venom Core Control Center UI
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
        .chat-container { border: 1px solid #00ff66; padding: 15px; height: 320px; overflow-y: auto; margin: 15px 0; background: #000; border-radius: 6px; }
        .msg { margin: 10px 0; padding: 10px; border-radius: 4px; max-width: 85%; font-size: 14px; word-break: break-word; }
        .user { background: #1f0014; color: #ff3377; border: 1px solid #ff3377; margin-left: auto; text-align: right; }
        .bot { background: #001a0a; color: #00ff66; border: 1px solid #00ff66; }
        .input-bar { display: flex; gap: 10px; }
        input, button, select { background: #111; color: #00ff66; border: 1px solid #00ff66; padding: 10px; font-family: monospace; border-radius: 4px; }
        input { flex: 1; }
        button { cursor: pointer; background: #00ff66; color: #000; font-weight: bold; }
        button:hover { background: #00cc52; }
        .drawer { display: none; background: #0a0a0a; border: 1px dashed #00ff66; padding: 15px; margin-bottom: 15px; border-radius: 6px; }
        .pin-row { display: flex; gap: 8px; margin-bottom: 8px; }
        .pin-row input { width: 30%; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>B12 VENOM CORE // RKS2805</h2>
        <button onclick="toggleDrawer()">⚙️ SETTINGS</button>
      </div>
      
      <div id="drawer" class="drawer">
        <h3>Backend & ESP32 Pin Mapping</h3>
        <label>Gemini API Key:</label><br>
        <input type="password" id="apiKeyInput" placeholder="Paste Gemini API key..." style="width: 95%; margin: 8px 0 15px 0;"><br>
        
        <h4>ESP32 Hardware Mapping Setup</h4>
        <div id="pinContainer"></div>
        <button onclick="addPinRow()" style="background: #222; color: #00ff66; margin-bottom: 15px;">+ Add Pin Mapping</button><br>

        <button onclick="saveSettings()">SAVE ALL CHANGES</button>
      </div>

      <div id="chat" class="chat-container">
        <div class="msg bot">B12 Active. State your command, RKS... *evil grin*</div>
      </div>
      
      <div class="input-bar">
        <input type="text" id="userInput" placeholder="Send prompt or pin command to B12..." onkeypress="if(event.key==='Enter') sendMsg()">
        <button onclick="sendMsg()">SEND</button>
      </div>

      <script>
        let currentMappings = [
          { pinName: "D5", deviceType: "Relay", loadName: "Light" },
          { pinName: "D18", deviceType: "Relay", loadName: "Fan" }
        ];

        function toggleDrawer() {
          const d = document.getElementById('drawer');
          d.style.display = d.style.display === 'block' ? 'none' : 'block';
          if(d.style.display === 'block') renderPinRows();
        }

        function renderPinRows() {
          const container = document.getElementById('pinContainer');
          container.innerHTML = '';
          currentMappings.forEach((m, idx) => {
            container.innerHTML += \`
              <div class="pin-row">
                <input type="text" placeholder="Pin Name (e.g. D19, hello1)" value="\${m.pinName}" id="pin_\${idx}">
                <input type="text" placeholder="Device (e.g. Relay, LED)" value="\${m.deviceType}" id="dev_\${idx}">
                <input type="text" placeholder="Connected Load (e.g. Light, NONE)" value="\${m.loadName}" id="load_\${idx}">
              </div>
            \`;
          });
        }

        function addPinRow() {
          currentMappings.push({ pinName: "", deviceType: "Relay", loadName: "NONE" });
          renderPinRows();
        }

        async function saveSettings() {
          const key = document.getElementById('apiKeyInput').value;
          const updatedMappings = currentMappings.map((_, idx) => ({
            pinName: document.getElementById(\`pin_\${idx}\`).value.trim(),
            deviceType: document.getElementById(\`dev_\${idx}\`).value.trim(),
            loadName: document.getElementById(\`load_\${idx}\`).value.trim()
          })).filter(m => m.pinName !== "");

          const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ apiKey: key, pinMappings: updatedMappings })
          });
          const data = await res.json();
          alert(data.message);
          toggleDrawer();
        }

        // Heavy Deep Venom TTS Engine
        function speakVenom(text) {
          if (!('speechSynthesis' in window)) return;
          window.speechSynthesis.cancel();
          const cleanText = text.replace(/B12:/g, '').trim();
          const utterance = new SpeechSynthesisUtterance(cleanText);
          
          utterance.pitch = 0.2; // Extremely low deep voice pitch
          utterance.rate = 0.85;  // Slow authoritative pace
          
          const voices = window.speechSynthesis.getVoices();
          const maleVoice = voices.find(v => v.lang.includes('en') && (v.name.includes('Male') || v.name.includes('David') || v.name.includes('Google US English')));
          if (maleVoice) utterance.voice = maleVoice;

          window.speechSynthesis.speak(utterance);
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

          // Trigger Venom Voice
          speakVenom(data.reply);
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
