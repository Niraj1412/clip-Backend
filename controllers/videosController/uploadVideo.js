const { v4: uuidv4 } = require('uuid');
const Video = require('../../model/uploadVideosSchema');
const path = require('path');
const fs = require('fs');
const processVideo = require('./processVideo'); // Use default import

const uploadVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: false,
        error: 'No file uploaded'
      });
    }

    // Store relative path for portability
    const relativeFilePath = `uploads/${req.file.filename}`;

    // Create video record
    const video = new Video({
      userId: req.user._id,
      title: req.file.originalname,
      videoUrl: relativeFilePath, // Store relative path
      status: 'processing',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await video.save();

    const absolutePath = path.resolve(__dirname, '../../backend/uploads', req.file.filename);

    // Process video in background
    processVideo({
      videoId: video._id,
      filePath: absolutePath,
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
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      status: false,
      error: 'Failed to process upload'
    });
  }
};

module.exports = uploadVideo;