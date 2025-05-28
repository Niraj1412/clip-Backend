const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const processVideo = require('../controllers/videosController/processVideo');
const path = require('path');
const fs = require('fs');
const Video = require('../model/uploadVideosSchema');

const router = express.Router();

// CORS preflight handler
router.options('/process/:videoId', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(204).end();
});

// Unified path resolver for all environments
const resolveFilePath = (videoUrl) => {
  if (videoUrl.startsWith('http')) {
    return videoUrl;
  }

  // Handle Railway production environment
  if (process.env.RAILWAY_ENVIRONMENT === 'production') {
    if (videoUrl.startsWith('uploads/')) {
      return path.join('/backend', videoUrl);
    }
    return path.join('/backend/uploads', path.basename(videoUrl));
  }

  // Handle local development
  const basePath = process.env.NODE_ENV === 'production' 
    ? path.join(__dirname, '../uploads')
    : path.join(__dirname, '../../uploads');

  return videoUrl.startsWith('uploads/')
    ? path.join(basePath, path.basename(videoUrl))
    : path.join(basePath, videoUrl);
};

// Main processing endpoint
router.post('/process/:videoId', protect, async (req, res) => {
  console.log(`\n[${new Date().toISOString()}] PROCESS ROUTE HIT`);
  console.log('Method:', req.method);
  console.log('URL:', req.originalUrl);
  console.log('Params:', req.params);
  console.log('User ID:', req.user?._id);

  try {
    const { videoId } = req.params;

    // Validate input
    if (!videoId || !/^[a-f0-9]{24}$/.test(videoId)) {
      console.error('Invalid video ID format');
      return res.status(400).json({
        success: false,
        error: 'Invalid video ID format'
      });
    }

    if (!req.user?._id) {
      console.error('Unauthorized access attempt');
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    // Find video document
    const video = await Video.findOne({
      _id: videoId,
      userId: req.user._id
    }).lean();

    if (!video) {
      console.error('Video not found for user');
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      });
    }

    if (!video.videoUrl || typeof video.videoUrl !== 'string') {
      console.error('Invalid video URL in database');
      return res.status(500).json({
        success: false,
        error: 'Invalid video data'
      });
    }

    // Resolve and verify file path
    const filePath = resolveFilePath(video.videoUrl);
    console.log('Resolved file path:', filePath);

    if (!fs.existsSync(filePath)) {
      console.error('File not found. Searched locations:', [
        filePath,
        path.join('/app', filePath),
        path.join('/backend', filePath)
      ]);
      return res.status(404).json({
        success: false,
        error: 'Video file not found',
        debug: process.env.NODE_ENV === 'development' ? { attemptedPath: filePath } : undefined
      });
    }

    // Process video
    console.log('Starting video processing...');
    const result = await processVideo({
      videoId,
      filePath,
      userId: req.user._id.toString(),
      authToken: req.headers.authorization || ''
    });

    console.log('Video processing completed successfully');
    return res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('PROCESSING ERROR:', error);
    return res.status(500).json({
      success: false,
      error: 'Video processing failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Thumbnail endpoint
router.get('/thumbnails/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const video = await Video.findById(videoId);
    
    const defaultThumbnail = path.join(__dirname, '../../backend/public/default-thumbnail.jpg');
    
    if (!video || !video.thumbnailUrl) {
      return res.sendFile(defaultThumbnail);
    }

    // Resolve thumbnail path for different environments
    const thumbnailPath = process.env.RAILWAY_ENVIRONMENT === 'production'
      ? path.join('/backend/thumbnails', path.basename(video.thumbnailUrl))
      : path.join(__dirname, '../../backend/thumbnails', path.basename(video.thumbnailUrl));

    return fs.existsSync(thumbnailPath)
      ? res.sendFile(thumbnailPath)
      : res.sendFile(defaultThumbnail);
  } catch (error) {
    console.error('THUMBNAIL ERROR:', error);
    return res.sendFile(path.join(__dirname, '../../backend/public/default-thumbnail.jpg'));
  }
});

module.exports = router;