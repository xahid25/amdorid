const WebSocket = require('ws');
const { exec, spawn } = require('child_process');

const wss = new WebSocket.Server({ port: 8080 });
let activeDevices = new Set();

console.log("🚀 Bridge Server running on port 8080");

wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        const data = JSON.parse(message);

        // ফোন রেজিস্টার এবং অটো-কানেক্ট
        if (data.type === 'REGISTER_PHONE') {
            const ip = data.ip;
            exec(`adb connect ${ip}:5555`, (err, stdout) => {
                if (stdout.includes("connected")) {
                    console.log(`✅ Connected to ${ip}`);
                    activeDevices.add(ip);
                    ws.send(JSON.stringify({ type: 'STATUS', msg: "Device Online" }));
                }
            });
        } 
        
        // কমান্ড এক্সিকিউশন
        else if (data.type === 'COMMAND') {
            exec(`adb -s ${data.ip}:5555 shell "${data.cmd}"`, (err, stdout, stderr) => {
                ws.send(JSON.stringify({ type: 'RESULT', data: stdout || stderr || "Done" }));
            });
        }

        // লাইভ স্ক্রিন স্ট্রিমিং (Optimized)
        else if (data.type === 'REQUEST_SCREEN') {
            const adbProc = spawn('adb', ['-s', `${data.ip}:5555`, 'exec-out', 'screencap', '-p']);
            let chunks = [];
            adbProc.stdout.on('data', (chunk) => chunks.push(chunk));
            adbProc.stdout.on('end', () => {
                const imgBase64 = Buffer.concat(chunks).toString('base64');
                ws.send(JSON.stringify({ type: 'SCREEN', data: imgBase64 }));
            });
        }

        // টাচ কন্ট্রোল লজিক
        else if (data.type === 'TOUCH') {
            exec(`adb -s ${data.ip}:5555 shell input tap ${data.x} ${data.y}`);
        }
    });
});
