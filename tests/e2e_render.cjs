// E2E Test 2: render_view + memory_save
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3456/ws');
let startTime = Date.now();

ws.on('open', () => {
  console.log('Sending render_view + memory test...\n');
  ws.send(JSON.stringify({
    type: 'chat',
    content: 'Build me a simple HTML calculator as a render_view. Also save to memory that I am testing HAG on a Motorola Razr 70.'
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  switch (msg.type) {
    case 'status': console.log(`[${elapsed()}s] Status: ${msg.status}`); break;
    case 'turn': console.log(`[${elapsed()}s] Turn ${msg.turn}/${msg.total}`); break;
    case 'tool_call':
      console.log(`[${elapsed()}s] 🔧 ${msg.name}(${JSON.stringify(msg.args).slice(0, 150)})`);
      break;
    case 'tool_result':
      console.log(`[${elapsed()}s] ↳ ${msg.result.slice(0, 200)}`);
      break;
    case 'message':
      if (msg.role === 'assistant') console.log(`[${elapsed()}s] 🤖 ${msg.content?.slice(0, 200)}`);
      break;
    case 'render_view':
      console.log(`[${elapsed()}s] 📊 RenderView: "${msg.title}" (${msg.html.length} bytes)`);
      console.log(`   HTML preview: ${msg.html.slice(0, 200)}...`);
      break;
    case 'error': console.log(`[${elapsed()}s] ❌ ${msg.message}`); break;
    case 'done':
      console.log(`\n[${elapsed()}s] ✅ Done!`);
      ws.close();
      process.exit(0);
      break;
  }
});

ws.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
setTimeout(() => { console.log('Timeout'); process.exit(1); }, 120000);

function elapsed() { return ((Date.now() - startTime) / 1000).toFixed(1); }