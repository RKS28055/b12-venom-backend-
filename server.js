const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '10mb' }));

// Global Configuration
let config = {
  // Set your Gemini API Key directly here or via environment variable
  apiKey: process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE",
  systemPrompt: "You are B12, an arrogant, dark, sarcastic, and authoritative Venom symbiote AI built for RKS. Always address the user as RKS. You must respond either in pure Bengali using proper Bengali script (বাংলা বর্ণমালা/হরফ) or in aggressive English. STRICTLY DO NOT write Bengali words using English/Latin alphabet (No Banglish). Maintain dark Venom attitude at all times. Adjust output length dynamically based on the query.",
  pinMappings: [
    { pinName: "D5", deviceType: "Relay", callName: "Main Light", status: "OFF" },
    { pinName: "D18", deviceType: "Relay", callName: "Fan", status: "OFF" }
  ]
};

// WebSocket Handler (Ready for ESP32 connection in future)
wss.on('connection', (ws) => {
  console.log('ESP32 / Client Connected via WebSocket 📡');
  ws.send(JSON.stringify({ type: 'STATUS', message: 'B12 Venom Core Online' }));

  ws.on('message', (message) => {
    console.log('WS Received:', message.toString());
  });
});

function broadcastToESP32(actionData) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(actionData));
    }
  });
}

// Gemini 1.5 Flash Core (High Speed & Large Daily Quota)
async function callGemini(inputData) {
  const apiKey = (config.apiKey || process.env.GEMINI_API_KEY || "").trim();
  
  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY_HERE") {
    throw new Error("No API Key configured in server.js code!");
  }

  const model = "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const hwContext = `CURRENT HARDWARE PIN & COMPONENT MAPPINGS:\n${JSON.stringify(config.pinMappings)}\n` +
    `If RKS asks to turn ON/OFF or control any component/pin/callName, append an ACTION TAG at the end like: [ACTION:{"pin":"PIN_NAME","state":"ON/OFF"}]. Complete your text response naturally.`;

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
    contents: [{ role: "user", parts: userParts }],
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.7
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API Error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const textReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "WE ARE HERE, RKS!";
  return textReply;
}

// REST APIs
app.post('/api/chat', async (req, res) => {
  const { message, audioBase64, mimeType } = req.body;
  try {
    let replyText = await callGemini({ text: message, audioBase64, mimeType });
    
    // Check Action Tags for hardware
    const actionMatch = replyText.match(/\[ACTION:(.*?)\]/);
    if (actionMatch) {
      try {
        const actionObj = JSON.parse(actionMatch[1]);
        broadcastToESP32({ type: "HARDWARE_CONTROL", ...actionObj });
        
        // Update local state
        const target = config.pinMappings.find(p => p.pinName.toLowerCase() === actionObj.pin.toLowerCase());
        if (target) target.status = actionObj.state;

        replyText = replyText.replace(/\[ACTION:.*?\]/, '').trim();
      } catch (e) {
        console.error("Action Parsing Error:", e.message);
      }
    }

    res.json({ success: true, reply: replyText });
  } catch (err) {
    console.error("Chat Error:", err.message);
    res.json({ success: false, reply: `B12 Error -> ${err.message}` });
  }
});

// Settings API (System Prompt & Pin Mappings)
app.post('/api/settings', (req, res) => {
  const { systemPrompt, pinMappings } = req.body;
  if (systemPrompt !== undefined) config.systemPrompt = systemPrompt;
  if (pinMappings !== undefined) config.pinMappings = pinMappings;
  res.json({ success: true, message: "Settings Updated Successfully! ⚡" });
});

app.get('/api/settings', (req, res) => {
  res.json({ 
    systemPrompt: config.systemPrompt,
    pinMappings: config.pinMappings
  });
});

// Full Web Control Center Interface
app.get('/RKS2805sB12', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>VENOM CORE // RKS2805</title>
      <style>
        * { box-sizing: border-box; }
        body { background: #050505; color: #00ff66; font-family: 'Courier New', monospace; margin: 0; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #00ff66; padding-bottom: 12px; }
        .header h2 { margin: 0; font-size: 20px; text-shadow: 0 0 8px #00ff66; }
        .gear-btn { background: #111; color: #00ff66; border: 1px solid #00ff66; padding: 8px 16px; cursor: pointer; font-family: monospace; border-radius: 4px; font-weight: bold; }
        .gear-btn:hover { background: #00ff66; color: #000; }
        
        .chat-container { border: 1px solid #00ff66; padding: 15px; height: 380px; overflow-y: auto; margin: 20px 0; background: #000; border-radius: 6px; }
        .msg { margin: 12px 0; padding: 12px; border-radius: 4px; max-width: 85%; font-size: 14px; word-break: break-word; line-height: 1.5; }
        .user { background: #1f0014; color: #ff3377; border: 1px solid #ff3377; margin-left: auto; text-align: right; }
        .bot { background: #001a0a; color: #00ff66; border: 1px solid #00ff66; }
        
        .input-bar { display: flex; gap: 10px; }
        input[type="text"] { background: #111; color: #00ff66; border: 1px solid #00ff66; padding: 12px; font-family: monospace; border-radius: 4px; flex: 1; font-size: 14px; }
        button.send-btn { background: #00ff66; color: #000; border: 1px solid #00ff66; padding: 12px 24px; font-weight: bold; cursor: pointer; border-radius: 4px; font-family: monospace; }
        button.send-btn:hover { background: #00cc52; }
        .mic-btn { background: #ff0055; color: #fff; border: 1px solid #ff0055; padding: 12px; cursor: pointer; border-radius: 4px; font-family: monospace; font-weight: bold; }
        .mic-btn.active { background: #ffcc00; color: #000; animation: pulse 1s infinite; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }

        /* Settings Drawer Modal */
        .drawer { display: none; background: #0a0a0a; border: 1px solid #00ff66; padding: 20px; margin-bottom: 20px; border-radius: 6px; box-shadow: 0 0 15px rgba(0,255,102,0.1); }
        .drawer h3 { margin-top: 0; color: #00ff66; border-bottom: 1px dashed #00ff66; padding-bottom: 6px; font-size: 16px; }
        textarea { width: 100%; background: #111; color: #00ff66; border: 1px solid #00ff66; padding: 10px; font-family: monospace; border-radius: 4px; resize: vertical; margin-bottom: 15px; }
        
        .pin-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        .pin-table th, .pin-table td { border: 1px solid #222; padding: 8px; text-align: left; }
        .pin-table th { background: #111; color: #00ff66; font-size: 13px; }
        .pin-table input { width: 100%; background: #000; color: #00ff66; border: 1px solid #333; padding: 6px; font-family: monospace; border-radius: 3px; }
        .del-btn { background: #ff0055; color: #fff; border: none; padding: 6px 10px; cursor: pointer; border-radius: 3px; font-family: monospace; }
        .add-btn { background: #222; color: #00ff66; border: 1px solid #00ff66; padding: 8px 12px; cursor: pointer; margin-bottom: 15px; border-radius: 4px; font-family: monospace; }
        .save-btn { background: #00ff66; color: #000; border: none; padding: 12px 20px; font-weight: bold; cursor: pointer; width: 100%; border-radius: 4px; font-family: monospace; font-size: 15px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>B12 VENOM CORE // RKS2805</h2>
        <button class="gear-btn" onclick="toggleDrawer()">⚙️ SETTINGS</button>
      </div>
      
      <!-- Settings Drawer -->
      <div id="drawer" class="drawer">
        <h3>1. Custom System Prompt (AI Personality & Rules)</h3>
        <textarea id="promptInput" rows="4" placeholder="Write custom prompt instructions for B12..."></textarea>
        
        <h3>2. ESP32 Pin, Component & Call Name Mappings</h3>
        <table class="pin-table">
          <thead>
            <tr>
              <th>Pin Name (e.g. D5)</th>
              <th>Component Type (e.g. Relay, Sensor)</th>
              <th>Call Name / Load Name (e.g. "ফ্যান", "Light")</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="pinContainer"></tbody>
        </table>
        <button class="add-btn" onclick="addPinRow()">+ Add New Pin Mapping</button>

        <button class="save-btn" onclick="saveSettings()">SAVE ALL CHANGES ⚡</button>
      </div>

      <!-- Chat UI -->
      <div id="chat" class="chat-container">
        <div class="msg bot">B12: WE ARE ONLINE, RKS! State your command... 😈</div>
      </div>
      
      <div class="input-bar">
        <input type="text" id="userInput" placeholder="Type or use Live Mic..." onkeypress="handleKeyPress(event)">
        <button class="mic-btn" id="micBtn" onclick="toggleLiveMic()">🎙️ LIVE MIC</button>
        <button class="send-btn" onclick="sendMsg()">SEND</button>
      </div>

      <script>
        var currentMappings = [];

        // Deep Venom Voice Synthesizer
        function speakVenom(text) {
          if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            var ut = new SpeechSynthesisUtterance(text);
            ut.lang = 'bn-BD';
            ut.pitch = 0.2; // Venom Deep Pitch
            ut.rate = 0.85;  // Authoritative slow speed
            window.speechSynthesis.speak(ut);
          }
        }

        async function loadSettings() {
          try {
            var res = await fetch('/api/settings');
            var data = await res.json();
            if(data.systemPrompt) document.getElementById('promptInput').value = data.systemPrompt;
            if(data.pinMappings) {
              currentMappings = data.pinMappings;
              renderPinRows();
            }
          } catch(e) {}
        }

        function toggleDrawer() {
          var d = document.getElementById('drawer');
          d.style.display = (d.style.display === 'block') ? 'none' : 'block';
          if(d.style.display === 'block') loadSettings();
        }

        function renderPinRows() {
          var container = document.getElementById('pinContainer');
          container.innerHTML = '';
          for (var i = 0; i < currentMappings.length; i++) {
            var m = currentMappings[i];
            var tr = document.createElement('tr');
            tr.innerHTML = 
              '<td><input type="text" value="' + (m.pinName || '') + '" id="pin_' + i + '" placeholder="D5"></td>' +
              '<td><input type="text" value="' + (m.deviceType || '') + '" id="dev_' + i + '" placeholder="Relay"></td>' +
              '<td><input type="text" value="' + (m.callName || '') + '" id="call_' + i + '" placeholder="Light / ফ্যান"></td>' +
              '<td><button class="del-btn" onclick="removePinRow(' + i + ')">X</button></td>';
            container.appendChild(tr);
          }
        }

        function addPinRow() {
          currentMappings.push({ pinName: "", deviceType: "Relay", callName: "" });
          renderPinRows();
        }

        function removePinRow(index) {
          currentMappings.splice(index, 1);
          renderPinRows();
        }

        async function saveSettings() {
          var promptVal = document.getElementById('promptInput').value;
          var updatedMappings = [];
          for (var i = 0; i < currentMappings.length; i++) {
            var pVal = document.getElementById('pin_' + i).value.trim();
            var dVal = document.getElementById('dev_' + i).value.trim();
            var cVal = document.getElementById('call_' + i).value.trim();
            if (pVal !== "") {
              updatedMappings.push({ pinName: pVal, deviceType: dVal, callName: cVal });
            }
          }

          var res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ systemPrompt: promptVal, pinMappings: updatedMappings })
          });
          var data = await res.json();
          alert(data.message);
          toggleDrawer();
        }

        // Voice Recognition
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
            chat.innerHTML += '<div class="msg bot">B12: ' + data.reply + '</div>';
            chat.scrollTop = chat.scrollHeight;
            
            speakVenom(data.reply);

          } catch(err) {
            chat.innerHTML += '<div class="msg bot">B12 Error: Server Connection Failed!</div>';
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
  console.log(`B12 Venom Server Online on Port ${PORT} 🚀`);
});
