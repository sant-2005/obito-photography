'use strict';

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

/* ── Serve static files (HTML, CSS, JS, etc.) ── */
app.use(express.static(path.join(__dirname)));

/* ── Default route → admin.html ── */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

/* ── Fallback: only for routes without a file extension ── */
app.get('*', (req, res, next) => {
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(__dirname, 'admin.html'));
});

/* ── Start server ── */
app.listen(PORT, () => {
  console.log(`[Obito Photography] Server running on port ${PORT}`);
});