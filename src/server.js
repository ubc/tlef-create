require('dotenv').config();
const express = require('express');
const path = require('path');
const exampleRoutes = require('./routes/example/hello');

const app = express();
const port = process.env.TLEF_CREATE_PORT || 8090;

const isProduction = process.env.NODE_ENV === 'production';
const staticDir = isProduction
  ? path.join(__dirname, '../dist')
  : path.join(__dirname, '../public');

app.use(express.static(staticDir));

// Page routes
app.get('/settings', (req, res) => {
    res.sendFile(path.join(staticDir, 'settings.html'));
});

// API endpoint
app.use('/api/example', exampleRoutes);

// Serve index.html for all other routes (SPA fallback)
if (isProduction) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
