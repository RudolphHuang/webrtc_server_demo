const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 3000 });

// 维护每个 callId 的 caller 和 callee 连接
const calls = {};

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
      return;
    }

    const { type, callId } = msg;

    if (type === 'offer') {
      // 创建新通话
      if (!calls[callId]) calls[callId] = {};
      calls[callId].caller = ws;
      ws.callRole = 'caller';
      ws.callId = callId;
      // offer 也要转发给 callee（如果已存在）
      if (calls[callId].callee) {
        calls[callId].callee.send(JSON.stringify(msg));
      }
    } else if (type === 'join') {
      // 加入通话
      if (!calls[callId]) calls[callId] = {};
      calls[callId].callee = ws;
      ws.callRole = 'callee';
      ws.callId = callId;
      // 通知 caller 有人加入
      if (calls[callId].caller) {
        calls[callId].caller.send(JSON.stringify({ type: 'peer-joined' }));
      }
    } else if (type === 'answer' && calls[callId]?.caller) {
      // 转发 answer 给 caller
      calls[callId].caller.send(JSON.stringify(msg));
    } else if (type === 'candidate') {
      // ICE candidate 转发
      const target =
        ws.callRole === 'caller'
          ? calls[callId]?.callee
          : calls[callId]?.caller;
      if (target) {
        target.send(JSON.stringify(msg));
      }
    } else if (type === 'hangup') {
      // 通知对方挂断
      const target =
        ws.callRole === 'caller'
          ? calls[callId]?.callee
          : calls[callId]?.caller;
      if (target) {
        target.send(JSON.stringify({ type: 'hangup' }));
      }
      // 清理
      delete calls[callId];
    }
  });

  ws.on('close', () => {
    // 清理 calls
    if (ws.callId && calls[ws.callId]) {
      const target =
        ws.callRole === 'caller'
          ? calls[ws.callId]?.callee
          : calls[ws.callId]?.caller;
      if (target) {
        target.send(JSON.stringify({ type: 'hangup' }));
      }
      delete calls[ws.callId];
    }
  });
});

console.log('WebRTC signaling server running on ws://localhost:3000');
