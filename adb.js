const net = require('net');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { ip, command } = req.body;

    return new Promise((resolve) => {
        const client = new net.Socket();
        let output = '';

        // ফোনের ADB পোর্ট ৫৫৫৫ তে কানেক্ট করা
        client.connect(5555, ip, () => {
            // এটি একটি সিম্পল ADB Shell কমান্ড ফরম্যাট
            // বিস্তারিত ADB প্রোটোকল হ্যান্ডলিং এর জন্য এটি বেসিক কমান্ড পাঠাবে
            client.write(`shell:${command}\0`);
        });

        client.on('data', (data) => {
            output += data.toString('utf8');
            client.destroy(); // ডেটা পাওয়ার পর কানেকশন শেষ
        });

        client.on('error', (err) => {
            resolve(res.status(500).json({ error: "Phone not reachable: " + err.message }));
        });

        client.on('close', () => {
            resolve(res.status(200).json({ output: output || "Command sent (No output)" }));
        });

        // ৫ সেকেন্ড পর অটো টাইমআউট
        setTimeout(() => {
            client.destroy();
            resolve(res.status(408).json({ error: "Timeout: Phone did not respond" }));
        }, 5000);
    });
}
