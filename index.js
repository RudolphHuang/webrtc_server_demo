const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
const httpServer = require('http').createServer(app);
const WebSocket = require('ws');

const wss = new WebSocket.Server({server: httpServer});

// 维护每个 callId 的 caller 和 callee 连接
const calls = {};

function log(...args) {
    console.log(new Date().toISOString(), ...args);
}

function handleOffer(ws, msg, clientAddr) {
    const {callId, offer} = msg;
    if (calls[callId] && calls[callId].caller) {
        ws.send(JSON.stringify({type: 'error', error: 'Room already exists'}));
        log(`[错误] offer 房间已存在: ${callId}`);
        return;
    }
    if (!calls[callId]) calls[callId] = {};
    calls[callId].caller = ws;
    calls[callId].answer = null;
    calls[callId].offer = offer; // 保存 offer 以便 callee join 时转发
    calls[callId].callerCandidates = [];
    calls[callId].answerCandidates = [];
    ws.callRole = 'caller';
    ws.callId = callId;
    log(`[房间] Caller 加入房间 ${callId}`);
    // 通知 caller offer 成功
    ws.send(JSON.stringify({type: 'offer-success', callId}));
    if (calls[callId].callee) {
        log(`[转发] offer 转发给 callee`);
        calls[callId].callee.send(JSON.stringify({type: 'offer', callId, offer}));
    }
}

function handleJoin(ws, msg, clientAddr) {
    const {callId} = msg;
    if (!calls[callId] || !calls[callId].caller) {
        ws.send(JSON.stringify({type: 'error', error: 'Room does not exist'}));
        log(`[错误] join 房间不存在: ${callId}`);
        return;
    }
    if (calls[callId].callee) {
        ws.send(JSON.stringify({type: 'error', error: 'Room is full'}));
        log(`[错误] join 房间已满: ${callId}`);
        return;
    }
    calls[callId].callee = ws;
    ws.callRole = 'callee';
    ws.callId = callId;
    log(`[房间] Callee 加入房间 ${callId}`);
    ws.send(JSON.stringify({type: 'join-success', callId}));

    // 推送 offer
    if (calls[callId].offer) {
        ws.send(JSON.stringify({type: 'offer', callId, offer: calls[callId].offer}));
        log(`[推送] offer 推送给 callee`);
    }
    // 推送之前缓存的 candidate
    // if (calls[callId].callerCandidates) {
    //     for (const candidate of calls[callId].callerCandidates) {
    //         ws.send(JSON.stringify({type: 'candidate', callId, candidate}));
    //         log(`[推送] 缓存 candidate 推送给 callee, callId=${callId}`);
    //     }
    // 清空缓存
    // calls[callId].callerCandidates = [];
    // }
    // 通知 caller 有人加入
    if (calls[callId].caller) {
        log(`[通知] 通知 caller 有人加入房间`);
        calls[callId].caller.send(JSON.stringify({type: 'peer-joined'}));
    }
}

function handleAnswer(ws, msg, clientAddr) {
    const {callId, answer} = msg;
    if (calls[callId]?.caller) {
        calls[callId].answer = answer;
        log(`[转发] answer 转发给 caller`);
        calls[callId].caller.send(JSON.stringify(msg));
        // 回复 callee answer-success
        ws.send(JSON.stringify({type: 'answer-success', callId}));
    } else {
        ws.send(JSON.stringify({type: 'error', error: 'Caller not found'}));
        log(`[错误] answer 转发失败，caller 不存在: ${callId}`);
    }
}

function handleCandidate(ws, msg, clientAddr) {
    const {callId, candidate} = msg;
    if (!calls[callId]) {
        ws.send(JSON.stringify({type: 'error', error: 'Room does not exist'}));
        log(`[错误] candidate 房间不存在: ${callId}`);
        return;
    }

    // Caller 发送 candidate
    if (ws.callRole === 'caller') {
        calls[callId].callerCandidates.push(candidate);
        log(`[缓存] candidate 缓存到 callerCandidates, callId=${callId}`);
        if (!calls[callId].callee) {
            // callee 还没 join，缓存
            // if (!calls[callId].callerCandidates) calls[callId].callerCandidates = [];

        } else {
            // callee 已 join，直接转发
            calls[callId].callee.send(JSON.stringify({type: 'candidate', callId, candidate}));
            log(`[转发] candidate 从 caller 转发给 callee, callId=${callId}`);
        }
    }
    // Callee 发送 candidate
    else if (ws.callRole === 'callee') {
        calls[callId].answerCandidates.push(candidate);
        if (calls[callId].caller) {
            calls[callId].caller.send(JSON.stringify({type: 'candidate', callId, candidate}));
            log(`[转发] candidate 从 callee 转发给 caller, callId=${callId}`);
        } else {
            // caller 不存在，理论上不会发生
            log(`[警告] candidate callee 发送但 caller 不存在, callId=${callId}`);
        }
    }
}

function handleHangup(ws, msg, clientAddr) {
    const {callId} = msg;
    const target =
        ws.callRole === 'caller'
            ? calls[callId]?.callee
            : calls[callId]?.caller;
    if (target) {
        log(`[通知] hangup 通知对方`);
        target.send(JSON.stringify({type: 'hangup'}));
    }
    log(`[房间] 房间 ${callId} 被销毁`);
    delete calls[callId];
}

wss.on('connection', (ws, req) => {
    const clientAddr = req.socket.remoteAddress + ':' + req.socket.remotePort;
    log(`[连接] 新客户端 ${clientAddr} 已连接`);

    ws.on('message', (message) => {
        let msg;
        try {
            msg = JSON.parse(message);
        } catch (e) {
            ws.send(JSON.stringify({type: 'error', error: 'Invalid JSON'}));
            log(`[错误] 收到无效JSON: ${message}`);
            return;
        }

        log(`[消息] 来自${clientAddr}:`, msg);

        switch (msg.type) {
            case 'offer':
                handleOffer(ws, msg, clientAddr);
                break;
            case 'join':
                handleJoin(ws, msg, clientAddr);
                break;
            case 'answer':
                handleAnswer(ws, msg, clientAddr);
                break;
            case 'candidate':
                handleCandidate(ws, msg, clientAddr);
                break;
            case 'hangup':
                handleHangup(ws, msg, clientAddr);
                break;
            default:
                ws.send(JSON.stringify({type: 'error', error: 'Unknown message type'}));
                log(`[错误] 未知消息类型: ${msg.type}`);
        }
    });

    ws.on('close', () => {
        if (ws.callId && calls[ws.callId]) {
            const target =
                ws.callRole === 'caller'
                    ? calls[ws.callId]?.callee
                    : calls[ws.callId]?.caller;
            if (target) {
                log(`[断开] ${ws.callRole} 断开，通知对方 hangup`);
                target.send(JSON.stringify({type: 'hangup'}));
            }
            log(`[房间] 房间 ${ws.callId} 被销毁（因断开）`);
            delete calls[ws.callId];
        }
        log(`[断开] 客户端 ${clientAddr} 断开连接`);
    });
});

// 提供根据 callId 获取 offer 的 HTTP 接口
app.get('/offer/:callId', (req, res) => {
    const {callId} = req.params;
    if (calls[callId] && calls[callId].offer) {
        res.json({
            offer: calls[callId].offer,
            callerCandidates: calls[callId].callerCandidates || [],
            answerCandidates: calls[callId].answerCandidates || []
        });
    } else {
        res.status(404).json({error: 'Offer not found'});
    }
});

// 启动 HTTP+WebSocket 服务
const PORT = 3000;
httpServer.listen(PORT, () => {
    log(`WebRTC signaling server (HTTP+WS) running on http://localhost:${PORT}`);
});
