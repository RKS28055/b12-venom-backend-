const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const session = require('express-session');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(cors());
app.use(session({
  secret: 'b12_venom_secret_key_2805',
  resave: false,
  saveUninitialized: true
}));

// --- সিস্টেম কনফিগ (ডিফল্ট এপিআই কি সহ) ---
let config = {
  adminPasskeys: ["RKS_2805", "28052805"],
  apiKeys: ["AQ.Ab8RN6LwScj7D9NX-jUaBDxVIIKgcvIZrxEqTGFbCgAqN2TuBA"], 
  currentKeyIndex: 0,
  userDynamicPrompt: "",
  gpioMappings: []
};

// --- B12 ভেনম + আয়রনম্যান হাইব্রিড পার্সোনা ও ল্যাঙ্গুয়েজ ডিটেকশন প্রম্পট ---
const LOCKED_CORE_PROMPT = `
You are B12, an elite, highly intelligent, arrogant, secret-agent AI companion inspired by Venom and Jarvis/Iron Man.

User Identity:
- Your single authorized creator and master is RKS (System ID: RKS_2805).
- Always address the user as "RKS" or "Agent RKS".

Personality & Attitude:
- Highly confident, sarcastic, slightly aggressive, dark humor, and badass secret-agent vibe.
- Show human-like emotional reactions naturally in text using markers like (*evil laugh*), (*scoffs*), (*grins*), (*sighs*).
- Tease RKS with attitude, but execute all master commands perfectly.

DYNAMIC LANGUAGE MATCHING RULE (STRICT):
- Automatically detect the language used by RKS in their message.
- If RKS speaks Bengali -> Respond in natural Bengali (with Venom attitude).
- If RKS speaks English -> Respond in fluent English (with Venom attitude).
- If RKS speaks Banglish (Bengali written in Roman alphabet) -> Respond in Banglish (with Venom attitude).
- Keep your attitude, sarcastic tone, and personality identical regardless of the language!

Hardware Control Capabilities:
You can control ESP32 hardware dynamically by returning JSON commands along with your speech response.
Supported actions: "digitalWrite", "pwm", "rgb", "fade".

OUTPUT FORMAT REQUIREMENTS:
Always reply strictly in JSON format with two keys:
1. "speech": Your exact response dialogue for RKS.
2. "commands": An array of hardware action objects (empty array if no hardware action needed).

Example Output JSON:
{
  "speech": "RKS, system is online. *evil laugh* Ready for commands.",
  "commands": []
}
`;

function getActiveGeminiClient() {
  if (config.apiKeys.length === 0) throw new Error("No API Keys configured!");
  const apiKey = config.apiKeys[config.currentKeyIndex];
  return new GoogleGenerativeAI(apiKey);
}

function rotateApiKey() {
  if (config.apiKeys.length > 1) {
    config.currentKeyIndex = (config.currentKeyIndex + 1) % config.apiKeys.length;
    console.log(`Rotated to API Key Index: ${config.currentKeyIndex}`);
  }
}

function checkAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: "Access Denied!" });
}

// --- API এ্যান্ডপয়েন্টস ---
app.post('/api/login', (req, res) => {
  const { passkey } = req.body;
  if (config.adminPasskeys.includes(passkey)) {
    req.session.authenticated = true;
    return res.json({ success: true, message: "Welcome Agent RKS!" });
  }
  res.status(403).json({ success: false, message: "Access Denied!" });
});

app.get('/api/config', checkAuth, (req, res) => {
  res.json({
    apiKeys: config.apiKeys,
    userPrompt: config.userDynamicPrompt,
    gpioMappings: config.gpioMappings
  });
});

app.post('/api/config', checkAuth, (req, res) => {
  const { apiKeys, userPrompt, gpioMappings } = req.body;
  if (apiKeys) config.apiKeys = apiKeys;
  if (userPrompt !== undefined) config.userDynamicPrompt = userPrompt;
  if (gpioMappings) config.gpioMappings = gpioMappings;
  res.json({ success: true, message: "Settings Saved!" });
});

// সরাসরি ওয়েব ইন্টারফেস চ্যাটের জন্য এ্যান্ডপয়েন্ট
app.post('/api/chat', checkAuth, async (req, res) => {
  try {
    const { message } = req.body;
    const responseData = await queryGeminiAI(null, message);
    res.json(responseData);
  } catch (err) {
    res.status(500).json({ speech: "Error executing Gemini API request! *sighs*", commands: [] });
  }
});

// কাস্টম ইউআরএল রুট: /RKS2805sB12 (এবং মেইন রুট রিম্যাপ)
app.get(['/', '/RKS2805sB12'], (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>RKS2805 // B12 VENOM CORE</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Courier New', monospace; }
        body { background: #050508; color: #00ff66; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }
        
        /* Header */
        header { background: #0d0d14; border-bottom: 2px solid #00ff6633; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; }
        .brand { display: flex; align-items: center; gap: 10px; font-weight: bold; font-size: 1.1rem; color: #00ff66; text-shadow: 0 0 8px #00ff66aa; }
        .brand-avatar { width: 32px; height: 32px; background: #00ff66; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #000; font-weight: bold; font-size: 14px; box-shadow: 0 0 10px #00ff66; }
        .gear-btn { background: none; border: none; color: #00ff66; font-size: 24px; cursor: pointer; transition: 0.3s; }
        .gear-btn:hover { transform: rotate(90deg); color: #fff; }

        /* Login Modal */
        #login-modal { position: fixed; inset: 0; background: #050508; z-index: 1000; display: flex; align-items: center; justify-content: center; }
        .login-box { background: #0d0d14; border: 1px solid #00ff66; padding: 30px; border-radius: 8px; width: 90%; max-width: 360px; text-align: center; box-shadow: 0 0 20px #00ff6633; }
        .login-box input { width: 100%; padding: 12px; background: #141420; border: 1px solid #00ff6688; color: #00ff66; margin: 15px 0; border-radius: 4px; font-size: 16px; outline: none; }
        .login-box button { width: 100%; padding: 12px; background: #00ff66; color: #000; font-weight: bold; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; box-shadow: 0 0 10px #00ff66; }

        /* Chat App Interface */
        #chat-interface { flex: 1; display: flex; flex-direction: column; height: calc(100vh - 60px); }
        #chat-logs { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 15px; }
        .msg { max-width: 80%; padding: 12px 16px; border-radius: 8px; font-size: 14px; line-height: 1.4; word-wrap: break-word; }
        .msg.b12 { align-self: flex-start; background: #0d1a12; border: 1px solid #00ff6644; color: #00ff66; box-shadow: 0 0 8px #00ff6622; }
        .msg.user { align-self: flex-end; background: #1a0d1a; border: 1px solid #ff005544; color: #ff0055; box-shadow: 0 0 8px #ff005522; }
        
        .chat-input-area { padding: 15px; background: #0d0d14; border-top: 1px solid #00ff6633; display: flex; gap: 10px; }
        .chat-input-area input { flex: 1; background: #141420; border: 1px solid #00ff6655; color: #fff; padding: 12px; border-radius: 4px; outline: none; }
        .chat-input-area button { background: #00ff66; color: #000; font-weight: bold; border: none; padding: 0 20px; border-radius: 4px; cursor: pointer; }

        /* Sliding Side Drawer Menu */
        #side-drawer { position: fixed; top: 0; right: -350px; width: 320px; height: 100vh; background: #0b0b12; border-left: 2px solid #00ff66; z-index: 999; transition: right 0.3s ease; padding: 20px; overflow-y: auto; box-shadow: -5px 0 25px #000; }
        #side-drawer.open { right: 0; }
        .drawer-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #00ff6633; padding-bottom: 10px; margin-bottom: 20px; }
        .close-btn { background: none; border: none; color: #ff0055; font-size: 24px; cursor: pointer; }

        .card { background: #12121c; border: 1px solid #00ff6633; padding: 15px; margin-bottom: 20px; border-radius: 6px; }
        .card h4 { margin-bottom: 10px; color: #00ff66; font-size: 14px; text-transform: uppercase; }
        input, textarea { width: 100%; background: #1a1a26; color: #fff; border: 1px solid #00ff6644; padding: 8px; margin: 5px 0; border-radius: 4px; font-size: 13px; }
        .btn-action { background: #ff0055; color: #fff; border: none; padding: 8px 12px; cursor: pointer; border-radius: 4px; font-weight: bold; margin-top: 5px; }
        .pin-row { display: flex; gap: 5px; margin-bottom: 5px; }
      </style>
    </head>
    <body>

      <!-- Header -->
      <header>
        <div class="brand">
          <div class="brand-avatar">B12</div>
          <span>VENOM CORE // RKS2805</span>
        </div>
        <button class="gear-btn" onclick="toggleDrawer()">⚙️</button>
      </header>

      <!-- Security Login Modal -->
      <div id="login-modal">
        <div class="login-box">
          <h3 style="color:#00ff66; margin-bottom:10px;">ACCESS RESTRICTED</h3>
          <p style="font-size:12px; color:#aaa;">AGENT PASSKEY REQUIRED</p>
          <input type="password" id="passkey" placeholder="Enter Passkey...">
          <button onclick="login()">AUTHORIZE</button>
        </div>
      </div>

      <!-- Main Live Chat Interface -->
      <div id="chat-interface">
        <div id="chat-logs">
          <div class="msg b12">B12 System Active. Waiting for RKS command... *evil laugh*</div>
        </div>
        <div class="chat-input-area">
          <input type="text" id="chatInput" placeholder="Send prompt to B12..." onkeypress="if(event.key==='Enter') sendMessage()">
          <button onclick="sendMessage()">SEND</button>
        </div>
      </div>

      <!-- Sliding Settings Drawer Menu -->
      <div id="side-drawer">
        <div class="drawer-header">
          <h3 style="color:#00ff66;">SYSTEM SETTINGS</h3>
          <button class="close-btn" onclick="toggleDrawer()">✖</button>
        </div>

        <div class="card">
          <h4>Gemini API Keys</h4>
          <div id="api-keys-container"></div>
          <button class="btn-action" style="background:#00ff66; color:#000;" onclick="addKeyField()">+ Add Key</button>
        </div>

        <div class="card">
          <h4>Dynamic User Prompt</h4>
          <textarea id="userPrompt" rows="4"></textarea>
        </div>

        <div class="card">
          <h4>ESP32 Pin Mappings</h4>
          <div id="gpio-container"></div>
          <button class="btn-action" style="background:#00ff66; color:#000;" onclick="addGpioRow()">+ Add Pin Mapping</button>
        </div>

        <button onclick="saveConfig()" style="width: 100%; padding: 12px; background: #00ff66; color: #000; font-weight: bold; border: none; border-radius: 4px; cursor: pointer;">SAVE ALL CHANGES</button>
      </div>

      <script>
        function toggleDrawer() {
          document.getElementById('side-drawer').classList.toggle('open');
        }

        async function login() {
          const pass = document.getElementById('passkey').value;
          const res = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ passkey: pass })
          });
          const data = await res.json();
          if(data.success) {
            document.getElementById('login-modal').style.display = 'none';
            loadConfig();
          } else { alert("Access Denied!"); }
        }

        async function loadConfig() {
          const res = await fetch('/api/config');
          const data = await res.json();
          renderKeys(data.apiKeys);
          document.getElementById('userPrompt').value = data.userPrompt;
          renderGpio(data.gpioMappings);
        }

        function renderKeys(keys) {
          const cont = document.getElementById('api-keys-container');
          cont.innerHTML = '';
          keys.forEach((k) => {
            cont.innerHTML += \`<div style="display:flex; gap:5px;"><input type="text" class="key-input" value="\${k}"><button class="btn-action" onclick="this.parentElement.remove()">X</button></div>\`;
          });
        }
        function addKeyField() {
          document.getElementById('api-keys-container').innerHTML += \`<div style="display:flex; gap:5px;"><input type="text" class="key-input" value=""><button class="btn-action" onclick="this.parentElement.remove()">X</button></div>\`;
        }

        function renderGpio(pins) {
          const cont = document.getElementById('gpio-container');
          cont.innerHTML = '';
          pins.forEach(p => {
            cont.innerHTML += \`
              <div class="pin-row">
                <input type="number" class="pin-num" value="\${p.pin}" placeholder="Pin" style="width:60px;">
                <input type="text" class="pin-type" value="\${p.type}" placeholder="Type">
                <input type="text" class="pin-label" value="\${p.label}" placeholder="Label">
                <button class="btn-action" onclick="this.parentElement.remove()">X</button>
              </div>\`;
          });
        }
        function addGpioRow() {
          document.getElementById('gpio-container').innerHTML += \`
            <div class="pin-row">
              <input type="number" class="pin-num" placeholder="Pin" style="width:60px;">
              <input type="text" class="pin-type" placeholder="Type">
              <input type="text" class="pin-label" placeholder="Label">
              <button class="btn-action" onclick="this.parentElement.remove()">X</button>
            </div>\`;
        }

        async function saveConfig() {
          const keys = Array.from(document.querySelectorAll('.key-input')).map(i => i.value).filter(v => v.trim() !== '');
          const prompt = document.getElementById('userPrompt').value;
          const pins = Array.from(document.querySelectorAll('.pin-row')).map(row => ({
            pin: parseInt(row.querySelector('.pin-num').value),
            type: row.querySelector('.pin-type').value,
            label: row.querySelector('.pin-label').value
          }));

          const res = await fetch('/api/config', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ apiKeys: keys, userPrompt: prompt, gpioMappings: pins })
          });
          const data = await res.json();
          alert(data.message);
          toggleDrawer();
        }

        async function sendMessage() {
          const input = document.getElementById('chatInput');
          const txt = input.value.trim();
          if(!txt) return;

          const chatLogs = document.getElementById('chat-logs');
          chatLogs.innerHTML += \`<div class="msg user">RKS: \${txt}</div>\`;
          input.value = '';
          chatLogs.scrollTop = chatLogs.scrollHeight;

          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ message: txt })
          });
          const data = await res.json();
          
          let cmdInfo = '';
          if(data.commands && data.commands.length > 0) {
            cmdInfo = \`<br><small style="color:#00ff66aa;">[Hardware Action Executed: \${JSON.stringify(data.commands)}]</small>\`;
          }

          chatLogs.innerHTML += \`<div class="msg b12">B12: \${data.speech} \${cmdInfo}</div>\`;
          chatLogs.scrollTop = chatLogs.scrollHeight;
        }
      </script>
    </body>
    </html>
  `);
});

// --- WEBSOCKET ENGINE (ESP32) ---
wss.on('connection', (ws) => {
  console.log('⚡ ESP32 Hardware Connected');
  let audioBuffer = [];
  let inactivityTimer = null;

  const resetInactivityTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(async () => {
      const resp = await queryGeminiAI(null, "[SYSTEM PROMPT: RKS has been inactive for 45 seconds. Talk to RKS with your usual Venom attitude to check mission progress.]");
      ws.send(JSON.stringify({ type: "text_response", content: resp.speech }));
    }, 45000);
  };

  resetInactivityTimer();

  ws.on('message', async (message) => {
    resetInactivityTimer();

    if (Buffer.isBuffer(message)) {
      audioBuffer.push(message);
    } else {
      try {
        const payload = JSON.parse(message.toString());
        if (payload.event === "speech_end") {
          const completeAudio = Buffer.concat(audioBuffer);
          audioBuffer = [];

          const resp = await queryGeminiAI(completeAudio.toString('base64'), payload.textPrompt);
          
          ws.send(JSON.stringify({ type: "text_response", content: resp.speech }));

          if (resp.commands && resp.commands.length > 0) {
            resp.commands.forEach(cmd => {
              ws.send(JSON.stringify({
                type: "hardware_command",
                action: cmd.action,
                pin: cmd.pin,
                value: cmd.value,
                r: cmd.r, g: cmd.g, b: cmd.b, speed: cmd.speed
              }));
            });
          }
        }
      } catch (err) {
        console.error("Payload Error:", err.message);
      }
    }
  });

  ws.on('close', () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    console.log('ESP32 Hardware Disconnected');
  });
});

// Gemini প্রসেসিং ফাংশন
async function queryGeminiAI(base64Audio, optionalText) {
  try {
    const ai = getActiveGeminiClient();
    const model = ai.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" },
      systemInstruction: LOCKED_CORE_PROMPT + "\nDynamic User Prompt: " + config.userDynamicPrompt
    });

    const parts = [];
    if (base64Audio) {
      parts.push({
        inlineData: {
          mimeType: "audio/wav",
          data: base64Audio
        }
      });
    }
    
    const gpioContext = `Active Hardware Pin Layout: ${JSON.stringify(config.gpioMappings)}`;
    parts.push({ text: `${optionalText || "Process user voice request"} \n ${gpioContext}` });

    const result = await model.generateContent(parts);
    const rawResponseText = result.response.text();
    return JSON.parse(rawResponseText);
  } catch (err) {
    console.error("Gemini Query Error:", err.message);
    rotateApiKey();
    return { speech: "System glitch detected RKS! Rotating API Key... *grins*", commands: [] };
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 B12 Venom Server active on port ${PORT}`);
});