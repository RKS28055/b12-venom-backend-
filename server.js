const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const googleTTS = require('google-tts-api');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '15mb' }));

// ESP32 Available Pins Array
const ALL_ESP32_PINS = [
  "GPIO0", "GPIO1 (TX)", "GPIO2", "GPIO3 (RX)", "GPIO4", "GPIO5",
  "GPIO12", "GPIO13", "GPIO14", "GPIO15", "GPIO16", "GPIO17",
  "GPIO18", "GPIO19", "GPIO21", "GPIO22", "GPIO23", "GPIO25",
  "GPIO26", "GPIO27", "GPIO32", "GPIO33", "GPIO34 (Input Only)",
  "GPIO35 (Input Only)", "GPIO36 (VP)", "GPIO39 (VN)"
];

// Server Configuration
let config = {
  apiKey: process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE",
  systemPrompt: "You are B12, an arrogant, dark, sarcastic, and authoritative Venom symbiote AI built for RKS. Always address the user as RKS. Respond strictly in pure Bengali using Bengali script (বাংলা বর্ণমালা) or aggressive English. NO Banglish. Adjust response length dynamically. For hardware actions, append [ACTION:{\"pin\":\"PIN_NAME\",\"state\":\"ON/OFF\"}] at the end.",
  pinMappings: [] // Starts completely empty as requested
};

// WebSocket logic for ESP32 Audio / Text streaming
wss.on('connection', (ws) => {
  console.log('ESP32 Connected to B12 Core 📡');
  let audioBuffers = [];

  ws.on('message', async (message) => {
    if (Buffer.isBuffer(message)) {
      audioBuffers.push(message);
      return;
    }

    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'END_AUDIO') {
        const completeAudio = Buffer.concat(audioBuffers);
        audioBuffers = []; // Clear memory

        const base64Audio = completeAudio.toString('base64');
        let replyText = "";
        
        try {
          replyText = await callGemini({ audioBase64: base64Audio, mimeType: "audio/wav" });
        } catch (err) {
          // If Gemini fails, convert the Error message into speech for ESP32!
          replyText = `সিস্টেম এরর দেখা দিয়েছে, RKS! ${err.message}`;
        }
        
        await processAndStreamResponse(ws, replyText);
      }
    } catch (err) {
      console.error('WS Processing Error:', err.message);
    }
  });
});

async function processAndStreamResponse(ws, text) {
  let cleanText = text;
  
  // Extract Action Tag for Relays / Pins
  const actionMatch = text.match(/\[ACTION:(.*?)\]/);
  if (actionMatch) {
    try {
      const actionObj = JSON.parse(actionMatch[1]);
      const mappedPin = config.pinMappings.find(p => p.pinName.toLowerCase().includes(actionObj.pin.toLowerCase()));
      
      ws.send(JSON.stringify({ 
        type: "HARDWARE_CONTROL", 
        pin: actionObj.pin, 
        state: actionObj.state,
        triggerState: mappedPin ? mappedPin.triggerState : "HIGH"
      }));
      
      cleanText = text.replace(/\[ACTION:.*?\]/, '').trim();
    } catch (e) {}
  }

  // Send Text Reply
  ws.send(JSON.stringify({ type: "TEXT_REPLY", text: cleanText }));

  // Convert Text/Error to TTS Audio for ESP32 Playback
  try {
    const ttsBase64 = await googleTTS.getAudioBase64(cleanText.substring(0, 300), {
      lang: 'bn',
      slow: false,
      host: 'https://translate.google.com',
    });

    const audioBuffer = Buffer.from(ttsBase64, 'base64');
    const chunkSize = 1024 * 4;

    for (let i = 0; i < audioBuffer.length; i += chunkSize) {
      const chunk = audioBuffer.subarray(i, i + chunkSize);
      ws.send(JSON.stringify({ 
        type: "AUDIO_CHUNK", 
        data: chunk.toString('base64'),
        isFinal: (i + chunkSize) >= audioBuffer.length
      }));
    }
  } catch (err) {
    console.error("TTS Fallback Error:", err.message);
  }
}

// Gemini 1.5 Flash Core Call
async function callGemini(inputData) {
  const apiKey = (config.apiKey || process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY_HERE") {
    throw new Error("এপিআই কী দেওয়া নেই! server.js চেক করুন।");
  }

  // Dual Fallback Model Strategy
  const model = "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const hwContext = `HARDWARE PIN MAPPINGS:\n${JSON.stringify(config.pinMappings)}\n` +
    `Understand pin trigger states (+/HIGH or -/LOW) and call names. If user asks to turn on/off, append [ACTION:{"pin":"PIN_NAME","state":"ON/OFF"}].`;

  let userParts = [];
  if (inputData.audioBase64) {
    userParts.push({
      inline_data: { mime_type: inputData.mimeType || "audio/wav", data: inputData.audioBase64 }
    });
    if (inputData.text) userParts.push({ text: inputData.text });
  } else {
    userParts.push({ text: inputData.text });
  }

  const payload = {
    system_instruction: { parts: [{ text: `${config.systemPrompt}\n\n${hwContext}` }] },
    contents: [{ role: "user", parts: userParts }],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.7 }
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
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "WE ARE HERE, RKS!";
}

// REST APIs
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  try {
    const replyText = await callGemini({ text: message });
    res.json({ success: true, reply: replyText });
  } catch (err) {
    // Return error message directly to UI so TTS can speak the error
    res.json({ success: false, reply: `B12 Error: ${err.message}` });
  }
});

app.post('/api/settings', (req, res) => {
  const { systemPrompt, pinMappings } = req.body;
  if (systemPrompt !== undefined) config.systemPrompt = systemPrompt;
  if (pinMappings !== undefined) config.pinMappings = pinMappings;
  res.json({ success: true, message: "Settings Saved Successfully! ⚡" });
});

app.get('/api/settings', (req, res) => {
  res.json({ systemPrompt: config.systemPrompt, pinMappings: config.pinMappings, allPins: ALL_ESP32_PINS });
});

// Full Web Control Center Interface
app.get('/RKS2805sB12', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8">
      <title>B12 VENOM CORE // RKS2805</title>
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
        input[type="text"], select { background: #111; color: #00ff66; border: 1px solid #00ff66; padding: 10px; font-family: monospace; border-radius: 4px; }
        input[type="text"] { flex: 1; font-size: 14px; }
        button.send-btn { background: #00ff66; color: #000; border: 1px solid #00ff66; padding: 12px 24px; font-weight: bold; cursor: pointer; border-radius: 4px; font-family: monospace; }
        .mic-btn { background: #ff0055; color: #fff; border: 1px solid #ff0055; padding: 12px; cursor: pointer; border-radius: 4px; font-family: monospace; font-weight: bold; }

        .drawer { display: none; background: #0a0a0a; border: 1px solid #00ff66; padding: 20px; margin-bottom: 20px; border-radius: 6px; }
        textarea { width: 100%; background: #111; color: #00ff66; border: 1px solid #00ff66; padding: 10px; font-family: monospace; border-radius: 4px; resize: vertical; margin-bottom: 15px; }
        
        .pin-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        .pin-table th, .pin-table td { border: 1px solid #222; padding: 8px; text-align: left; }
        .pin-table th { background: #111; color: #00ff66; font-size: 12px; }
        .pin-table input, .pin-table select { width: 100%; background: #000; color: #00ff66; border: 1px solid #333; }
        .del-btn { background: #ff0055; color: #fff; border: none; padding: 6px 10px; cursor: pointer; border-radius: 3px; }
        .add-btn { background: #222; color: #00ff66; border: 1px solid #00ff66; padding: 8px 12px; cursor: pointer; margin-bottom: 15px; border-radius: 4px; }
        .save-btn { background: #00ff66; color: #000; border: none; padding: 12px; font-weight: bold; cursor: pointer; width: 100%; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>B12 VENOM CORE // RKS2805</h2>
        <button class="gear-btn" onclick="toggleDrawer()">⚙️ SETTINGS</button>
      </div>
      
      <!-- Settings Drawer -->
      <div id="drawer" class="drawer">
        <h3>1. Custom System Prompt (AI Behavior Instructions)</h3>
        <textarea id="promptInput" rows="3" placeholder="Write custom prompt instructions for B12..."></textarea>
        
        <h3>2. ESP32 Pin Mappings (4 Dynamic Columns)</h3>
        <table class="pin-table">
          <thead>
            <tr>
              <th style="width: 25%;">1. Select Pin (ESP32)</th>
              <th style="width: 25%;">2. Component Type</th>
              <th style="width: 25%;">3. Call Name / Load Name</th>
              <th style="width: 15%;">4. Output Signal State</th>
              <th style="width: 10%;">Action</th>
            </tr>
          </thead>
          <tbody id="pinContainer"></tbody>
        </table>
        <button class="add-btn" onclick="addPinRow()">+ Add New Pin Mapping</button>

        <button class="save-btn" onclick="saveSettings()">SAVE ALL CONFIGURATIONS ⚡</button>
      </div>

      <!-- Chat UI -->
      <div id="chat" class="chat-container">
        <div class="msg bot">B12: WE ARE ONLINE, RKS! Say something... 😈</div>
      </div>
      
      <div class="input-bar">
        <input type="text" id="userInput" placeholder="Type or use Live Mic..." onkeypress="handleKeyPress(event)">
        <button class="mic-btn" id="micBtn" onclick="toggleLiveMic()">🎙️ LIVE MIC</button>
        <button class="send-btn" onclick="sendMsg()">SEND</button>
      </div>

      <script>
        var currentMappings = [];
        var allPins = [];

        function speakVenom(text) {
          if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            var ut = new SpeechSynthesisUtterance(text);
            ut.lang = 'bn-BD';
            ut.pitch = 0.2; // Venom Deep Pitch
            ut.rate = 0.85;  // Authoritative Slow Speed
            window.speechSynthesis.speak(ut);
          }
        }

        async function loadSettings() {
          try {
            var res = await fetch('/api/settings');
            var data = await res.json();
            allPins = data.allPins || [];
            if(data.systemPrompt) document.getElementById('promptInput').value = data.systemPrompt;
            currentMappings = data.pinMappings || [];
            renderPinRows();
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

          // Collect currently selected pins across rows
          var selectedPins = currentMappings.map(m => m.pinName).filter(Boolean);

          for (var i = 0; i < currentMappings.length; i++) {
            var m = currentMappings[i];
            var tr = document.createElement('tr');

            // Build dynamic dropdown options (Filtering out used pins)
            var optionsHtml = '<option value="">-- Select Pin --</option>';
            for (var j = 0; j < allPins.length; j++) {
              var p = allPins[j];
              if (!selectedPins.includes(p) || p === m.pinName) {
                var selected = (p === m.pinName) ? 'selected' : '';
                optionsHtml += '<option value="' + p + '" ' + selected + '>' + p + '</option>';
              }
            }

            tr.innerHTML = 
              '<td><select id="pin_' + i + '" onchange="updateRowPin(' + i + ')">' + optionsHtml + '</select></td>' +
              '<td><input type="text" value="' + (m.componentType || '') + '" id="dev_' + i + '" placeholder="Relay / LED / Motor / Sensor..."></td>' +
              '<td><input type="text" value="' + (m.callName || '') + '" id="call_' + i + '" placeholder="যেমন: ফ্যান, লাইট ১..."></td>' +
              '<td>' +
                '<select id="trig_' + i + '">' +
                  '<option value="HIGH" ' + (m.triggerState === "HIGH" ? "selected" : "") + '>HIGH (+ / পজিটিভ)</option>' +
                  '<option value="LOW" ' + (m.triggerState === "LOW" ? "selected" : "") + '>LOW (- / নেগেটিভ)</option>' +
                '</select>' +
              '</td>' +
              '<td><button class="del-btn" onclick="removePinRow(' + i + ')">X</button></td>';
            container.appendChild(tr);
          }
        }

        function updateRowPin(index) {
          var sel = document.getElementById('pin_' + index);
          currentMappings[index].pinName = sel.value;
          renderPinRows(); // Re-render to update pin dropdown list across all rows
        }

        function addPinRow() {
          currentMappings.push({ pinName: "", componentType: "", callName: "", triggerState: "HIGH" });
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
            var pVal = document.getElementById('pin_' + i).value;
            var dVal = document.getElementById('dev_' + i).value.trim();
            var cVal = document.getElementById('call_' + i).value.trim();
            var tVal = document.getElementById('trig_' + i).value;

            if (pVal !== "") {
              updatedMappings.push({ pinName: pVal, componentType: dVal, callName: cVal, triggerState: tVal });
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

        // Voice Input & Chat Handling
        var recognition = null;
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
          var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
          recognition = new SpeechRecognition();
          recognition.lang = 'bn-BD';

          recognition.onresult = function(event) {
            document.getElementById('userInput').value = event.results[0][0].transcript;
            sendMsg();
          };
        }

        function toggleLiveMic() {
          if (recognition) recognition.start();
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

          try {
            var res = await fetch('/api/chat', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ message: text })
            });
            var data = await res.json();
            
            chat.innerHTML += '<div class="msg bot">B12: ' + data.reply + '</div>';
            chat.scrollTop = chat.scrollHeight;
            
            // Speak reply OR Speak the error!
            speakVenom(data.reply);

          } catch(err) {
            var errText = "B12 Error: সার্ভার কানেকশন ড্রপ করেছে!";
            chat.innerHTML += '<div class="msg bot">' + errText + '</div>';
            speakVenom(errText);
          }
        }
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`B12 Core Online on Port ${PORT} 🚀`));
