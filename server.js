const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// Dynamic state with hardware pin mappings
let config = {
  apiKey: process.env.GEMINI_API_KEY || "",
  systemPrompt: "You are B12, an arrogant, dark, sarcastic, and authoritative Venom symbiote AI built for RKS. Always address the user as RKS. Speak naturally in Banglish (Bengali + English mix) or aggressive English with dark humor and symbiote attitude. Always give complete, full sentences. NEVER cut off mid-sentence or say meta-commentary like 'Input' or 'User greeted'. Always respond directly as B12.",
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

// Gemini REST API Call with Native Audio Stream Request
async function callGemini(promptText) {
  const activeKey = (config.apiKey || process.env.GEMINI_API_KEY || "").trim();

  if (!activeKey) {
    throw new Error("API Key missing! Set it in Settings or Render Variables.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${activeKey}`;

  const hwContext = `CURRENT ESP32 HARDWARE SETUP:\n${JSON.stringify(config.pinMappings)}\n` +
    `If RKS asks to turn ON/OFF any relay/device/pin, add an ACTION TAG at the end like: [ACTION:{"pin":"PIN_NAME","state":"ON/OFF"}]. Respond as arrogant, dark Venom in Banglish/English. Keep response natural and complete under 40 words.`;

  const payload = {
    system_instruction: {
      parts: [{ text: `${config.systemPrompt}\n\n${hwContext}` }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: promptText }]
      }
    ],
    generationConfig: {
      responseModalities: ["TEXT", "AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: "Fenrir"
          }
        }
      },
      maxOutputTokens: 500,
      temperature: 0.7
    }
  };

  let response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    // Fallback payload if audio modality is restricted on endpoint key
    const fallbackPayload = {
      system_instruction: {
        parts: [{ text: `${config.systemPrompt}\n\n${hwContext}` }]
      },
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
    };
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fallbackPayload)
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status} - ${errText}`);
    }
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  
  let textReply = "";
  let audioBase64 = null;
  let mimeType = null;

  for (const part of parts) {
    if (part.text) {
      textReply += part.text + " ";
    }
    if (part.inlineData) {
      audioBase64 = part.inlineData.data;
      mimeType = part.inlineData.mimeType || "audio/wav";
    }
  }

  return {
    text: textReply.trim() || "We are listening, RKS!",
    audioBase64,
    mimeType
  };
}

// Chat API Route & Hardware Trigger Parser
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  try {
    let result = await callGemini(message);
    let rawReply = result.text;
    
    // Parse Action Commands for ESP32
    const actionMatch = rawReply.match(/\[ACTION:(.*?)\]/);
    if (actionMatch) {
      try {
        const actionObj = JSON.parse(actionMatch[1]);
        broadcastToESP32({ type: "HARDWARE_CONTROL", ...actionObj });
        
        const targetPin = config.pinMappings.find(p => p.pinName.toLowerCase() === actionObj.pin.toLowerCase());
        if (targetPin) targetPin.status = actionObj.state;

        rawReply = rawReply.replace(/\[ACTION:.*?\]/, '').trim();
      } catch (e) {
        console.error("Action Parsing Error:", e.message);
      }
    }

    res.json({
      success: true,
      reply: `B12: ${rawReply}`,
      audioBase64: result.audioBase64,
      mimeType: result.mimeType
    });
  } catch (err) {
    console.error("Chat Error:", err.message);
    res.json({ success: false, reply: `B12 Error -> ${err.message}` });
  }
});

// Settings API Route
app.post('/api/settings', (req, res) => {
  const { apiKey, systemPrompt, pinMappings } = req.body;
  if (apiKey !== undefined) config.apiKey = apiKey.trim();
  if (systemPrompt !== undefined) config.systemPrompt = systemPrompt;
  if (pinMappings !== undefined) config.pinMappings = pinMappings;
  res.json({ success: true, message: "Settings Updated!" });
});

app.get('/api/settings', (req, res) => {
  res.json({ 
    apiKey: config.apiKey ? "********" : "", 
    systemPrompt: config.systemPrompt,
    pinMappings: config.pinMappings
  });
});

// UI Control Center
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
        .input-bar { display: flex; gap: 8px; }
        input, button { background: #111; color: #00ff66; border: 1px solid #00ff66; padding: 12px; font-family: monospace; border-radius: 4px; }
        input { flex: 1; }
        button { cursor: pointer; background: #00ff66; color: #000; font-weight: bold; }
        button:hover { background: #00cc52; }
        .mic-btn { background: #ff0055; color: #fff; border-color: #ff0055; }
        .mic-btn.active { background: #ffcc00; color: #000; animation: pulse 1s infinite; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
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
        <div class="msg bot">WE ARE B12! State your desire, RKS... *evil laugh*</div>
      </div>
      
      <div class="input-bar">
        <input type="text" id="userInput" placeholder="Type or click Live Mic to speak with B12..." onkeypress="handleKeyPress(event)">
        <button class="mic-btn" id="micBtn" onclick="toggleLiveMic()">🎙️ LIVE MIC</button>
        <button onclick="sendMsg()">SEND</button>
      </div>

      <script>
        var currentMappings = [
          { pinName: "D5", deviceType: "Relay", loadName: "Light" },
          { pinName: "D18", deviceType: "Relay", loadName: "Fan" }
        ];

        var currentAudioPlayer = null;

        function toggleDrawer() {
          var d = document.getElementById('drawer');
          d.style.display = (d.style.display === 'block') ? 'none' : 'block';
          if(d.style.display === 'block') renderPinRows();
        }

        function renderPinRows() {
          var container = document.getElementById('pinContainer');
          container.innerHTML = '';
          for (var i = 0; i < currentMappings.length; i++) {
            var m = currentMappings[i];
            var rowHtml = '<div class="pin-row">' +
              '<input type="text" placeholder="Pin Name" value="' + (m.pinName || '') + '" id="pin_' + i + '">' +
              '<input type="text" placeholder="Device" value="' + (m.deviceType || '') + '" id="dev_' + i + '">' +
              '<input type="text" placeholder="Connected Load" value="' + (m.loadName || '') + '" id="load_' + i + '">' +
            '</div>';
            container.innerHTML += rowHtml;
          }
        }

        function addPinRow() {
          currentMappings.push({ pinName: "", deviceType: "Relay", loadName: "NONE" });
          renderPinRows();
        }

        async function saveSettings() {
          var key = document.getElementById('apiKeyInput').value;
          var updatedMappings = [];
          for (var i = 0; i < currentMappings.length; i++) {
            var pVal = document.getElementById('pin_' + i).value.trim();
            var dVal = document.getElementById('dev_' + i).value.trim();
            var lVal = document.getElementById('load_' + i).value.trim();
            if (pVal !== "") {
              updatedMappings.push({ pinName: pVal, deviceType: dVal, loadName: lVal });
            }
          }

          var res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ apiKey: key, pinMappings: updatedMappings })
          });
          var data = await res.json();
          alert(data.message);
          toggleDrawer();
        }

        // Single Audio Execution Player (Gemini Stream or Single Pitch Speech)
        function playAudio(audioBase64, mimeType, text) {
          if (currentAudioPlayer) {
            currentAudioPlayer.pause();
            currentAudioPlayer = null;
          }
          if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
          }

          if (audioBase64) {
            currentAudioPlayer = new Audio('data:' + (mimeType || 'audio/wav') + ';base64,' + audioBase64);
            currentAudioPlayer.play().catch(function(e) { console.error("Audio playback error:", e); });
          } else if ('speechSynthesis' in window) {
            var cleanText = text.replace(/B12:/g, '').replace(/\\*/g, '').trim();
            var utterance = new SpeechSynthesisUtterance(cleanText);
            utterance.pitch = 0.2;
            utterance.rate = 0.85;
            window.speechSynthesis.speak(utterance);
          }
        }

        var recognition = null;
        var isListening = false;

        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
          var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
          recognition = new SpeechRecognition();
          recognition.continuous = false;
          recognition.interimResults = false;
          recognition.lang = 'en-US';

          recognition.onresult = function(event) {
            var transcript = event.results[0][0].transcript;
            document.getElementById('userInput').value = transcript;
            sendMsg();
          };

          recognition.onend = function() {
            isListening = false;
            document.getElementById('micBtn').classList.remove('active');
            document.getElementById('micBtn').innerText = '🎙️ LIVE MIC';
          };

          recognition.onerror = function() {
            isListening = false;
            document.getElementById('micBtn').classList.remove('active');
            document.getElementById('micBtn').innerText = '🎙️ LIVE MIC';
          };
        }

        function toggleLiveMic() {
          if (!recognition) {
            alert("Browser does not support Live Speech Recognition!");
            return;
          }
          if (isListening) {
            recognition.stop();
          } else {
            recognition.start();
            isListening = true;
            document.getElementById('micBtn').classList.add('active');
            document.getElementById('micBtn').innerText = '🎧 LISTENING...';
          }
        }

        function handleKeyPress(e) {
          if (e.key === 'Enter') {
            sendMsg();
          }
        }

        async function sendMsg() {
          var input = document.getElementById('userInput');
          var text = input.value.trim();
          if(!text) return;
          
          var chat = document.getElementById('chat');
          chat.innerHTML += '<div class="msg user">RKS: ' + text + '</div>';
          input.value = '';
          chat.scrollTop = chat.scrollHeight;

          try {
            var res = await fetch('/api/chat', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ message: text })
            });
            var data = await res.json();
            chat.innerHTML += '<div class="msg bot">' + data.reply + '</div>';
            chat.scrollTop = chat.scrollHeight;
            
            playAudio(data.audioBase64, data.mimeType, data.reply);
          } catch(err) {
            chat.innerHTML += '<div class="msg bot">B12 Error: Connection Failed!</div>';
            chat.scrollTop = chat.scrollHeight;
          }
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
