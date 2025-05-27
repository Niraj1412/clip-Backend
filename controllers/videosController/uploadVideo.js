const { v4: uuidv4 } = require('uuid');
const Video = require('../../model/uploadVideosSchema');
const path = require('path');
const fs = require('fs');
const { processVideo } = require('./processVideo'); // Your existing processing function

const uploadVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: false,
        error: 'No file uploaded'
      });
    }

    // Generate full absolute file path
    const absoluteFilePath = path.resolve(req.file.path);

    // Create video record
    const videoId = uuidv4();
    const video = new Video({
      userId: req.user._id,
      title: req.file.originalname,
      videoUrl: absoluteFilePath,  // Store full path for later processing
      status: 'Processing',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await video.save();

    // Process video in background
    processVideo({
      videoId: video._id,
      filePath: absoluteFilePath,
      userId: req.user._id,
      isBackgroundProcess: true,
      authToken: req.headers.authorization
    }).catch(err => console.error('Background processing error:', err));

    res.status(200).json({
      status: true,
      videoId: video._id,
      message: 'Upload successful. Processing started.'
    });

  } catch (error) {
    console.error('Upload error:', error);

    // Clean up file if error occurred
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }

    res.status(500).json({
      status: false,
      error: 'Failed to process upload'
    });
  }
};

module.exports = uploadVideo;
