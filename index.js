const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('<h1>My Node.js Site on Vercel</h1><p>GitHub diye host kora hoyeche!</p>');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
