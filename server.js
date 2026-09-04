const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '10mb' }));

let config = {
  // Can contain multiple API keys separated by commas: "KEY_1, KEY_2, KEY_3"
  apiKey: process.env.GEMINI_API_KEY || "",
  systemPrompt: "You are B12, an arrogant, dark, sarcastic, and authoritative Venom symbiote AI built for RKS. Always address the user as RKS. You must respond either in pure Bengali using proper Bengali script (বাংলা বর্ণমালা/হরফ) or in aggressive English. STRICTLY DO NOT write Bengali words using English/Latin alphabet (No Banglish). Maintain dark Venom attitude, sarcasm, and evil personality at all times. Adjust your output length dynamically: if RKS asks a short question, answer briefly; if RKS asks for a paragraph or explanation, give a full, detailed, and complete response without cutting off.",
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
  ws.send(JSON.stringify({ type: 'STATUS', message: 'B12 Venom Core Active' }));

  ws.on('message', (message) => {
    console.log('WS Received:', message.toString());
  });
});

// Gemini API Core Engine (Multi-Key & Multi-Model Quota Fallback)
async function callGemini(inputData) {
  const rawKeys = (config.apiKey || process.env.GEMINI_API_KEY || "").trim();
  
  if (!rawKeys) {
    throw new Error("No API Keys found! Please add your API keys in Settings.");
  }

  const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);
  
  // Fallback array across active Gemini models to bypass 429 Quota Exhausted errors
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

  const hwContext = `CURRENT ESP32 HARDWARE SETUP:\n${JSON.stringify(config.pinMappings)}\n` +
    `If RKS asks to turn ON/OFF any relay/device/pin, add an ACTION TAG at the end like: [ACTION:{"pin":"PIN_NAME","state":"ON/OFF"}]. Complete your response fully.`;

  let userParts = [];
  if (inputData.audioBase64) {
    userParts.push({
      inline_data: {
        mime_type: inputData.mimeType || "audio/wav",
        data: inputData.audioBase64
      }
    });
    if (inputData.text) userParts.push({ text: inputData.text });
  } else {
    userParts.push({ text: inputData.text });
  }

  const payload = {
    system_instruction: {
      parts: [{ text: `${config.systemPrompt}\n\n${hwContext}` }]
    },
    contents: [
      {
        role: "user",
        parts: userParts
      }
    ],
    generationConfig: {
      responseModalities: ["TEXT", "AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: "Fenrir" // Deep Venom Voice
          }
        }
      },
      maxOutputTokens: 2048,
      temperature: 0.7
    }
  };

  let lastError = "";

  // Try each API Key across available models until success
  for (let i = 0; i < apiKeys.length; i++) {
    const currentKey = apiKeys[i];

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data = await response.json();
          const parts = data.candidates?.[0]?.content?.parts || [];
          
          let textReply = "";
          let audioBase64 = null;
          let mimeType = null;

          for (const part of parts) {
            if (part.text) textReply += part.text + " ";
            if (part.inlineData) {
              audioBase64 = part.inlineData.data;
              mimeType = part.inlineData.mimeType || "audio/pcm";
            }
          }

          console.log(`[Success] Key #${i + 1} succeeded on model ${model}`);

          return {
            text: textReply.trim() || "আমরা শুনছি, RKS!",
            audioBase64,
            mimeType
          };
        }

        const errText = await response.text();
        if (response.status === 429) {
          console.warn(`[429 Quota Exceeded] Key #${i + 1} on ${model}. Trying next model/key...`);
        } else {
          console.warn(`[API Error] Key #${i + 1} on ${model}: ${errText}`);
        }
        lastError = `HTTP ${response.status} - ${errText}`;

      } catch (err) {
        console.error(`[Fetch Error] Key #${i + 1} failed on ${model}:`, err.message);
        lastError = err.message;
      }
    }
  }

  throw new Error(`All API Keys and Models exhausted! Please add an extra API key in Settings or wait a few seconds for quota reset. Detail: ${lastError}`);
}

// Unified Chat API Endpoint
app.post('/api/chat', async (req, res) => {
  const { message, audioBase64, mimeType } = req.body;
  try {
    let result = await callGemini({ text: message, audioBase64, mimeType });
    let rawReply = result.text;
    
    // Parse Action Commands for Hardware
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

// Settings API Routes
app.post('/api/settings', (req, res) => {
  const { apiKey, systemPrompt, pinMappings } = req.body;
  if (apiKey !== undefined) config.apiKey = apiKey.trim();
  if (systemPrompt !== undefined) config.systemPrompt = systemPrompt;
  if (pinMappings !== undefined) config.pinMappings = pinMappings;
  res.json({ success: true, message: "Settings Updated Successfully!" });
});

app.get('/api/settings', (req, res) => {
  res.json({ 
    apiKey: config.apiKey, 
    systemPrompt: config.systemPrompt,
    pinMappings: config.pinMappings
  });
});

// Web UI Control Center
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
        .msg { margin: 10px 0; padding: 10px; border-radius: 4px; max-width: 85%; font-size: 14px; word-break: break-word; line-height: 1.5; }
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
        <h3>Backend & Multi API Key Setup</h3>
        <label>Gemini API Keys (Separate multiple keys with commas):</label><br>
        <textarea id="apiKeyInput" rows="3" placeholder="AIzaSyA..., AIzaSyB..." style="width: 95%; background:#111; color:#00ff66; border:1px solid #00ff66; margin: 8px 0 15px 0; padding:10px; font-family:monospace;"></textarea><br>
        
        <h4>ESP32 Hardware Mapping Setup</h4>
        <div id="pinContainer"></div>
        <button onclick="addPinRow()" style="background: #222; color: #00ff66; margin-bottom: 15px;">+ Add Pin Mapping</button><br>

        <button onclick="saveSettings()">SAVE ALL CHANGES</button>
      </div>

      <div id="chat" class="chat-container">
        <div class="msg bot">WE ARE B12! State your desire, RKS... *evil laugh*</div>
      </div>
      
      <div class="input-bar">
        <input type="text" id="userInput" placeholder="Type or click Live Mic to speak..." onkeypress="handleKeyPress(event)">
        <button class="mic-btn" id="micBtn" onclick="toggleLiveMic()">🎙️ LIVE MIC</button>
        <button onclick="sendMsg()">SEND</button>
      </div>

      <script>
        var currentMappings = [
          { pinName: "D5", deviceType: "Relay", loadName: "Light" },
          { pinName: "D18", deviceType: "Relay", loadName: "Fan" }
        ];

        var audioCtx = null;

        function getAudioContext() {
          if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
          }
          if (audioCtx.state === 'suspended') {
            audioCtx.resume();
          }
          return audioCtx;
        }

        // Web Audio API PCM Decoder Engine for Gemini Venom Voice
        function playVenomAudio(base64Data) {
          if (!base64Data) return;
          try {
            var ctx = getAudioContext();
            var binaryString = window.atob(base64Data);
            var len = binaryString.length;
            var bytes = new Uint8Array(len);
            for (var i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            var int16Array = new Int16Array(bytes.buffer);
            var float32Array = new Float32Array(int16Array.length);
            for (var j = 0; j < int16Array.length; j++) {
              float32Array[j] = int16Array[j] / 32768.0;
            }

            var audioBuffer = ctx.createBuffer(1, float32Array.length, 24000);
            audioBuffer.getChannelData(0).set(float32Array);

            var source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);
            source.start(0);
          } catch (e) {
            console.error("PCM Engine Error, Fallback Audio:", e);
            var fallback = new Audio("data:audio/wav;base64," + base64Data);
            fallback.play().catch(function(err){ console.error("Fallback play failed:", err); });
          }
        }

        async function loadSettings() {
          try {
            var res = await fetch('/api/settings');
            var data = await res.json();
            if(data.apiKey) document.getElementById('apiKeyInput').value = data.apiKey;
            if(data.pinMappings) {
              currentMappings = data.pinMappings;
              renderPinRows();
            }
          } catch(e) {}
        }

        function toggleDrawer() {
          var d = document.getElementById('drawer');
          d.style.display = (d.style.display === 'block') ? 'none' : 'block';
          if(d.style.display === 'block') {
            loadSettings();
          }
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

        var recognition = null;
        var isListening = false;

        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
          var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
          recognition = new SpeechRecognition();
          recognition.continuous = false;
          recognition.interimResults = false;
          recognition.lang = 'bn-BD';

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
          getAudioContext();
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
          if (e.key === 'Enter') sendMsg();
        }

        async function sendMsg() {
          getAudioContext();
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
            
            if(data.audioBase64) {
              playVenomAudio(data.audioBase64);
            }
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
  console.log(`B12 Venom Fast Core Server running on port ${PORT} 🚀`);
});
