import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import exampleRoutes from './routes/example/hello.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
