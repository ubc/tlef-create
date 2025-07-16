require('dotenv').config();
const express = require('express');
const path = require('path');
const exampleRoutes = require('./routes/example/hello');

const app = express();
const port = process.env.TLEF_CREATE_PORT || 8090;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '../public')));

// Page routes
app.get('/settings', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/settings.html'));
});

// API endpoint
app.use('/api/example', exampleRoutes);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log( 'test again' );
});
