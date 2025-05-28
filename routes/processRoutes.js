const express = require('express');
const {protect} = require('../middleware/authMiddleware');
const processVideo = require('../controllers/videosController/processVideo');
const path = require('path');
const fs = require('fs');
const Video = require('../model/uploadVideosSchema');

const router = express.Router();
// Add these logs right before processing:

router.post('/process/:videoId', protect, async (req, res) => {
  console.log(`Process route hit for videoId: ${req.params.videoId}`);
  try {
    const { videoId } = req.params;

    // Validate input
    if (!videoId || typeof videoId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid video ID'
      });
    }

    // Ensure user is authenticated
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access. User not authenticated.'
      });
    }

    // Find video owned by the current user
    const video = await Video.findOne({
      _id: videoId,
      userId: req.user._id
    });

    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found or unauthorized access'
      });
    }

    // Check if videoUrl exists and is a valid string
    if (!video.videoUrl || typeof video.videoUrl !== 'string') {
      return res.status(500).json({
        success: false,
        error: 'Invalid video URL in database'
      });
    }

    // Resolve full absolute file path safely
    const filePath = path.resolve(video.videoUrl);
console.log('Stored videoUrl:', video.videoUrl);
console.log('Resolved filePath:', filePath);
console.log('Full absolute path:', path.resolve(filePath));
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'Video file not found on server'
      });
    }

    // Pass video details to processor
    const result = await processVideo({
      videoId,
      filePath,
      userId: req.user._id.toString(),
      authToken: req.headers.authorization || ''
    });

    res.status(200).json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('Video Processing Error:', error);

    res.status(500).json({
      success: false,
      error: 'Video processing failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Add this to your processRoutes.js
router.get('/thumbnails/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const video = await Video.findById(videoId);
    
    if (!video || !video.thumbnailUrl) {
      return res.sendFile(path.join(__dirname, '../../backend/public/default-thumbnail.jpg'));
    }

    const thumbnailPath = path.join(__dirname, '../../backend/thumbnails', path.basename(video.thumbnailUrl));
    
    if (fs.existsSync(thumbnailPath)) {
      res.sendFile(thumbnailPath);
    } else {
      res.sendFile(path.join(__dirname, '../../backend/public/default-thumbnail.jpg'));
    }
  } catch (error) {
    console.error('Error serving thumbnail:', error);
    res.sendFile(path.join(__dirname, '../../backend/public/default-thumbnail.jpg'));
  }
});

module.exports = router;
