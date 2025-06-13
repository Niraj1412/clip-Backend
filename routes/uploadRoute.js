const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Video = require('../model/uploadVideosSchema');
const { protect } = require('../middleware/authMiddleware');

// Configure multer for file uploads
const uploadDir = process.env.UPLOADS_DIR || path.join(__dirname, '../backend/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const filetypes = /mp4|webm|mov/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only MP4, WebM, and MOV files are allowed'));
  },
});

// Upload route
router.post('/', protect, upload.single('video'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    filePath = path.join(uploadDir, req.file.filename).replace(/\\/g, '/');
    console.log(`[Upload] File saved at: ${filePath}, size: ${req.file.size} bytes`);

    const video = new Video({
      userId: req.user._id,
      title: req.file.originalname,
      videoUrl: filePath,
      source: 'upload', // Set source
      status: 'uploading',
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await video.save();
    console.log(`[Upload] Saved video with ID: ${video._id}`);

    res.status(200).json({
      success: true,
      videoId: video._id,
    });

    // Trigger background processing
    const processVideo = require('../controllers/processController/processVideo');
    processVideo({
      videoId: video._id,
      filePath,
      userId: req.user._id,
      isBackgroundProcess: true,
      authToken: req.headers.authorization,
    }).catch(err => {
      console.error('[Upload] Background processing error:', err);
    });
  } catch (error) {
    console.error('[Upload] Error:', error);
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`[Cleanup] Deleted file: ${filePath}`);
      } catch (cleanupError) {
        console.error('[Cleanup] Error:', cleanupError);
      }
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to upload video',
    });
  }
});

module.exports = router;