const express = require('express'); // Add this missing import
const { protect } = require('../middleware/authMiddleware');
const processVideo = require('../controllers/videosController/processVideo');
const path = require('path');
const fs = require('fs');
const Video = require('../model/uploadVideosSchema');

const router = express.Router();

router.options('/process/:videoId', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(204).end();
});

// Enhanced process route with better validation and logging
router.post('/process/:videoId([a-f0-9]{24})', protect, async (req, res) => {
  console.log(`\n=== PROCESS ROUTE TRIGGERED ===`);
  console.log(`Method: ${req.method}`);
  console.log(`URL: ${req.originalUrl}`);
  console.log(`Params:`, req.params);
  console.log(`User:`, req.user?._id);

  try {
    const { videoId } = req.params;

    // Validate MongoDB ID format
    if (!/^[a-f0-9]{24}$/.test(videoId)) {
      console.error('Invalid video ID format');
      return res.status(400).json({
        success: false,
        error: 'Invalid video ID format'
      });
    }

    // Verify user authentication
    if (!req.user?._id) {
      console.error('Unauthorized - No user in request');
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    // Find the video document
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

    // Validate video URL
    if (!video.videoUrl || typeof video.videoUrl !== 'string') {
      console.error('Invalid video URL in database');
      return res.status(500).json({
        success: false,
        error: 'Invalid video data'
      });
    }

    // Resolve file path - handle both relative and absolute paths
    // Replace the current path resolution with:
const filePath = video.videoUrl.startsWith('http')
  ? video.videoUrl // Handle URLs
  : video.videoUrl.startsWith('/')
    ? video.videoUrl // Handle absolute paths
    : path.join(
        __dirname, 
        process.env.NODE_ENV === 'production' ? '../uploads' : '../../uploads',
        video.videoUrl
      );

    console.log('Resolved file path:', filePath);

    if (!fs.existsSync(filePath)) {
      console.error('Video file not found at path:', filePath);
      return res.status(404).json({
        success: false,
        error: 'Video file missing'
      });
    }

    // Process the video
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
      ...result
    });

  } catch (error) {
    console.error('PROCESSING ERROR:', error);
    return res.status(500).json({
      success: false,
      error: 'Processing failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Thumbnail route remains the same
router.get('/thumbnails/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const video = await Video.findById(videoId);
    
    if (!video || !video.thumbnailUrl) {
      return res.sendFile(path.join(__dirname, '../../backend/public/default-thumbnail.jpg'));
    }

    const thumbnailPath = path.join(__dirname, '../../backend/thumbnails', path.basename(video.thumbnailUrl));
    
    if (fs.existsSync(thumbnailPath)) {
      return res.sendFile(thumbnailPath);
    }
    return res.sendFile(path.join(__dirname, '../../backend/public/default-thumbnail.jpg'));
  } catch (error) {
    console.error('THUMBNAIL ERROR:', error);
    return res.sendFile(path.join(__dirname, '../../backend/public/default-thumbnail.jpg'));
  }
});

module.exports = router;