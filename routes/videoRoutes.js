const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Video = require('../model/uploadVideosSchema');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/authMiddleware');

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later',
});

// Apply rate limiter globally
router.use(apiLimiter);

// Apply auth middleware
router.use(protect);

/**
 * @route GET /api/v1/video/:videoId/transcript
 * @desc Get transcript for a video with proper status checks and timestamp validation
 */
router.get('/:videoId/transcript', async (req, res) => {
  try {
    if (!req.params.videoId || !mongoose.Types.ObjectId.isValid(req.params.videoId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid video ID format',
      });
    }

    const video = await Video.findOne({
      _id: req.params.videoId,
      userId: req.user._id,
    }).lean();

    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found or not owned by user',
      });
    }

    if (video.status !== 'processed' && !video.transcript) {
      return res.status(423).json({
        success: false,
        error: 'Video processing not completed',
        status: video.status,
        processingCompletedAt: video.processingCompletedAt,
      });
    }

    if (!video.transcript || !video.transcript.segments) {
      return res.status(404).json({
        success: false,
        error: 'Transcript not available',
        hint: 'The video may not have audio or processing failed',
      });
    }

    // Normalize and validate segments
    const segments = (video.transcript.segments || []).map((segment, index) => {
      // Extract start and end, handling both field names
      let start = segment.start ?? segment.startTime ?? 0;
      let end = segment.end ?? segment.endTime ?? 0;

      // Convert milliseconds to seconds if values are unusually large
      if (start > 1000) {
        console.warn(`[Transcript] Large start time at segment ${index}: ${start}, converting from ms to s`);
        start /= 1000;
      }
      if (end > 1000) {
        console.warn(`[Transcript] Large end time at segment ${index}: ${end}, converting from ms to s`);
        end /= 1000;
      }

      // Validate timestamps
      if (typeof start !== 'number' || start < 0) {
        console.warn(`[Transcript] Invalid start time at segment ${index}: ${start}, setting to 0`);
        start = 0;
      }
      if (typeof end !== 'number' || end <= start) {
        console.warn(`[Transcript] Invalid end time at segment ${index}: ${end}, adjusting`);
        end = start + 1;
      }

      // Ensure end doesn't exceed video duration
      if (video.duration && end > video.duration) {
        console.warn(`[Transcript] End time at segment ${index} exceeds duration (${video.duration}s), clamping`);
        end = video.duration;
      }

      return {
        id: segment.id || `segment-${index}`,
        text: segment.text || '',
        start: Number(start.toFixed(3)), // Seconds, 3 decimal places
        end: Number(end.toFixed(3)), // Seconds, 3 decimal places
        duration: Number((end - start).toFixed(3)),
        confidence: segment.confidence ?? null,
        words: segment.words || [],
      };
    });

    const response = {
      success: true,
      data: {
        videoId: video._id,
        title: video.title,
        status: video.status,
        duration: video.duration,
        processingTime: video.processingCompletedAt
          ? new Date(video.processingCompletedAt) - new Date(video.createdAt)
          : null,
        transcript: {
          text: video.transcript.text || '',
          segments,
          language: video.transcript.language || 'en',
          processingStatus: 'completed',
        },
      },
    };

    console.log(`[Transcript] Response for video ${videoId}:`, JSON.stringify(response.data.transcript.segments.slice(0, 2), null, 2));

    res.json(response);
  } catch (error) {
    console.error('Transcript fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while fetching transcript',
      ...(process.env.NODE_ENV === 'development' && {
        details: error.message,
        stack: error.stack,
      }),
    });
  }
});

/**
 * @route GET /api/v1/video/:videoId/details
 * @desc Get video metadata with user ownership check
 */
router.get('/:videoId/details', async (req, res) => {
  try {
    if (!req.params.videoId || !mongoose.Types.ObjectId.isValid(req.params.videoId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid video ID format',
      });
    }

    const video = await Video.findOne({
      _id: req.params.videoId,
      userId: req.user._id,
    })
      .select('-processingError -__v')
      .lean();

    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found or access denied',
      });
    }

    // Calculate duration from transcript if not set
    let duration = video.duration || 0;
    if (!duration && video.transcript?.segments?.length > 0) {
      const lastSegment = video.transcript.segments[video.transcript.segments.length - 1];
      duration = lastSegment.end || lastSegment.endTime || 0;
      // Convert milliseconds to seconds if needed
      if (duration > 1000) {
        duration /= 1000;
      }
    }

    // Convert to ISO format
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    const durationISO = `PT${minutes}M${seconds}S`;

    const response = {
      success: true,
      data: {
        videoId: video._id,
        userId: video.userId,
        title: video.title,
        description: '',
        videoUrl: video.videoUrl,
        thumbnailUrl: video.thumbnailUrl,
        duration: Number(duration.toFixed(3)), // Seconds
        durationISO,
        fileSize: video.fileSize,
        mimeType: video.mimeType,
        status: video.status,
        createdAt: video.createdAt,
        updatedAt: video.updatedAt,
        processingCompletedAt: video.processingCompletedAt,
        hasTranscript: !!video.transcript,
      },
    };

    res.json(response);
  } catch (error) {
    console.error('Video details error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while fetching video details',
      ...(process.env.NODE_ENV === 'development' && {
        details: error.message,
      }),
    });
  }
});

module.exports = router;