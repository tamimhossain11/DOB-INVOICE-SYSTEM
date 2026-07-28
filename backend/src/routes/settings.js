'use strict';

const express = require('express');
const { getSettings, setSetting, DEFAULT_SETTINGS } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(getSettings());
});

router.put('/', (req, res) => {
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      setSetting(key, String(req.body[key] ?? ''));
    }
  }
  res.json(getSettings());
});

module.exports = router;
