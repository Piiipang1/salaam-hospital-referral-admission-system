const express = require('express');
const router  = express.Router();
const filesController = require('../controllers/files.controller');
const auth = require('../middleware/auth');

// GET /api/files/:filename — authenticated access to an uploaded patient file
// (lab result / referral attachment). Replaces the old unauthenticated
// express.static('/uploads') mount, which exposed PHI to anyone with the URL.
router.get('/:filename', auth, filesController.getFile);

module.exports = router;
