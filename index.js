const express = require('express');
const app = express();

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>Success!</title></head>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                <h1>🎉 Your Website is Live!</h1>
                <p>Node.js and Express are working perfectly on Vercel.</p>
                <p style="color: gray;">Deployed via GitHub</p>
            </body>
        </html>
    `);
});

// এই লাইনটি অত্যন্ত গুরুত্বপূর্ণ Vercel-এর জন্য
module.exports = app;
