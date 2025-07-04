const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 3000 });

// 维护每个 callId 的 caller 和 callee 连接
const calls = {};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

wss.on('connection', (ws, req) => {
  const clientAddr = req.socket.remoteAddress + ':' + req.socket.remotePort;
  log(`[连接] 新客户端 ${clientAddr} 已连接`);

  ws.on('message', (message) => {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
      log(`[错误] 收到无效JSON: ${message}`);
      return;
    }

    log(`[消息] 来自${clientAddr}:`, msg);

    const { type, callId } = msg;

    if (type === 'offer') {
      if (calls[callId] && calls[callId].caller) {
        // 房间已存在，不能重复创建
        ws.send(JSON.stringify({ type: 'error', error: 'Room already exists' }));
        log(`[错误] offer 房间已存在: ${callId}`);
        return;
      }
      if (!calls[callId]) calls[callId] = {};
      calls[callId].caller = ws;
      ws.callRole = 'caller';
      ws.callId = callId;
      log(`[房间] Caller 加入房间 ${callId}`);
      // offer 也要转发给 callee（如果已存在）
      if (calls[callId].callee) {
        log(`[转发] offer 转发给 callee`);
        calls[callId].callee.send(JSON.stringify(msg));
      }
    } else if (type === 'join') {
      if (!calls[callId] || !calls[callId].caller) {
        // 房间不存在
        ws.send(JSON.stringify({ type: 'error', error: 'Room does not exist' }));
        log(`[错误] join 房间不存在: ${callId}`);
        return;
      }
      if (calls[callId].callee) {
        // 房间已满
        ws.send(JSON.stringify({ type: 'error', error: 'Room is full' }));
        log(`[错误] join 房间已满: ${callId}`);
        return;
      }
      calls[callId].callee = ws;
      ws.callRole = 'callee';
      ws.callId = callId;
      log(`[房间] Callee 加入房间 ${callId}`);
      // 通知 caller 有人加入
      if (calls[callId].caller) {
        log(`[通知] 通知 caller 有人加入房间`);
        calls[callId].caller.send(JSON.stringify({ type: 'peer-joined' }));
      }
    } else if (type === 'answer' && calls[callId]?.caller) {
      log(`[转发] answer 转发给 caller`);
      // 转发 answer 给 caller
      calls[callId].caller.send(JSON.stringify(msg));
    } else if (type === 'candidate') {
      // ICE candidate 转发
      const target =
        ws.callRole === 'caller'
          ? calls[callId]?.callee
          : calls[callId]?.caller;
      if (target) {
        log(`[转发] candidate 转发给 ${ws.callRole === 'caller' ? 'callee' : 'caller'}`);
        target.send(JSON.stringify(msg));
      } else {
        log(`[警告] candidate 目标不存在`);
      }
    } else if (type === 'hangup') {
      // 通知对方挂断
      const target =
        ws.callRole === 'caller'
          ? calls[callId]?.callee
          : calls[callId]?.caller;
      if (target) {
        log(`[通知] hangup 通知对方`);
        target.send(JSON.stringify({ type: 'hangup' }));
      }
      log(`[房间] 房间 ${callId} 被销毁`);
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
        log(`[断开] ${ws.callRole} 断开，通知对方 hangup`);
        target.send(JSON.stringify({ type: 'hangup' }));
      }
      log(`[房间] 房间 ${ws.callId} 被销毁（因断开）`);
      delete calls[ws.callId];
    }
    log(`[断开] 客户端 ${clientAddr} 断开连接`);
  });
});

log('WebRTC signaling server running on ws://localhost:3000');
