const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { protect } = require('../middleware/authMiddleware');
const Video = require('../model/uploadVideosSchema');
const processVideo = require('../controllers/videosController/processVideo');
const mongoose = require('mongoose');

const router = express.Router();

// Configure upload directory - using absolute path
const uploadDir = path.resolve(__dirname, '../../backend/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log(`Created upload directory: ${uploadDir}`);
}

// Enhanced storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  }
});

// File validation
const fileFilter = (req, file, cb) => {
  const validTypes = [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-m4v'
  ];

  if (!validTypes.includes(file.mimetype)) {
    const error = new Error('Invalid file type');
    error.code = 'LIMIT_FILE_TYPE';
    return cb(error);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB
  },
  fileFilter
});

// Main upload endpoint
router.post('/', protect, upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      status: false,
      error: 'No file uploaded'
    });
  }

  try {
    // Create video record with correct path
    const video = new Video({
      userId: req.user._id,
      title: req.file.originalname,
      videoUrl: path.join('uploads', req.file.filename).replace(/\\/g, '/'),
      status: 'uploading',
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await video.save();

    // Process video in background
    processVideo({
      videoId: video._id,
      filePath: req.file.path,
      userId: req.user._id,
      isBackgroundProcess: true,
      authToken: req.headers.authorization
    }).catch(err => {
      console.error('Background processing error:', err);
      // Update status if processing fails
      Video.findByIdAndUpdate(video._id, {
        status: 'failed',
        error: err.message
      }).catch(console.error);
    });

    res.status(200).json({
      status: true,
      videoId: video._id,
      message: 'Upload successful. Processing started.',
      fileUrl: `/uploads/${req.file.filename}`
    });

  } catch (error) {
    console.error('Upload error:', error);

    // Clean up file if error occurred
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      status: false,
      error: 'Failed to process upload',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Error handling middleware
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_TYPE') {
    return res.status(415).json({
      status: false,
      error: 'Invalid file type. Only MP4, WebM, MOV, and M4V are allowed.'
    });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      status: false,
      error: 'File too large. Maximum size is 500MB.'
    });
  }

  console.error('Upload error:', err);
  res.status(500).json({
    status: false,
    error: 'File upload failed'
  });
});

module.exports = router;