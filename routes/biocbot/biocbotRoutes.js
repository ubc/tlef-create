import express from 'express';

const router = express.Router();

// Example route for BIOCBOT app
router.get('/', (req, res) => {
  res.json({ message: 'Hello from the BIOCBOT app API!' });
});

// Add more BIOCBOT specific routes here
// router.get('/data', (req, res) => { ... });

export default router;