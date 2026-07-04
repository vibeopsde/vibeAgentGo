// E2E Test: Real LLM conversation via WebSocket
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3456/ws');
let startTime = Date.now();

ws.on('open', () => {
  console.log('WS connected, sending message to Qwen 3.6 35B...\n');
  ws.send(JSON.stringify({
    type: 'chat',
    content: 'Hello! Can you calculate 17 * 23 using the run_code tool and tell me the result?'
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case 'status':
      console.log(`[${elapsed()}s] Status: ${msg.status}`);
      break;
    case 'turn':
      console.log(`[${elapsed()}s] Turn ${msg.turn}/${msg.total}`);
      break;
    case 'tool_call':
      console.log(`[${elapsed()}s] 🔧 Tool: ${msg.name}(${JSON.stringify(msg.args).slice(0, 120)})`);
      break;
    case 'tool_result':
      console.log(`[${elapsed()}s] ↳ Result: ${msg.result.slice(0, 200)}`);
      break;
    case 'message':
      if (msg.role === 'assistant') {
        console.log(`[${elapsed()}s] 🤖 Assistant: ${msg.content?.slice(0, 300)}`);
      }
      break;
    case 'render_view':
      console.log(`[${elapsed()}s] 📊 RenderView: "${msg.title}" (${msg.html.length} bytes)`);
      break;
    case 'error':
      console.log(`[${elapsed()}s] ❌ Error: ${msg.message}`);
      break;
    case 'done':
      console.log(`\n[${elapsed()}s] ✅ Done!`);
      console.log(`Result: ${msg.result?.slice(0, 300)}`);
      ws.close();
      process.exit(0);
      break;
  }
});

ws.on('error', (e) => {
  console.error('WS error:', e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('\nTimeout (60s) — killing');
  process.exit(1);
}, 90000);

function elapsed() {
  return ((Date.now() - startTime) / 1000).toFixed(1);
}