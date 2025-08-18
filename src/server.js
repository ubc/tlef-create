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

// Serve index.html for all routes (SPA fallback) - EXCEPT API routes
app.get('*', (req, res) => {
  // Don't serve frontend for API routes - let them fail so browser will make actual API calls
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found - check backend server' });
  }
  res.sendFile(path.join(staticDir, 'index.html'));
});


app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
