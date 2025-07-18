require('dotenv').config();
const express = require('express');
const path = require('path');
const exampleRoutes = require('./routes/example/hello');

const app = express();
const port = process.env.TLEF_CREATE_PORT || 8090;

const staticDir = path.join(__dirname, '../dist');

app.use(express.static(staticDir));

// API endpoint
app.use('/api/example', exampleRoutes);

// Serve index.html for all routes (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});


app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
