const Video = require('../../model/uploadVideosSchema');
const { generateTranscript } = require('../transcriptsController/videoGenerateTranscript');
const { generateThumbnail } = require('./thumbnailGenerator');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const processVideo = async ({ videoId, filePath, userId, isBackgroundProcess = false, authToken }) => {
  try {
    console.log(`Starting processing for video: ${videoId}`);
    console.log('Auth token:', authToken ? 'provided' : 'not provided');

    // Find video with proper authorization
    const video = await Video.findOne({
      _id: videoId,
      ...(!isBackgroundProcess && { userId })
    });

    if (!video) {
      throw new Error('Video not found or unauthorized access');
    }

    // Path resolution and validation (existing code remains the same)
    let finalFilePath;
    if (filePath) {
      finalFilePath = path.isAbsolute(filePath) 
        ? filePath 
        : path.resolve(__dirname, '../../', filePath);
    } else {
      const video = await Video.findById(videoId);
      if (!video?.videoUrl) throw new Error('No video URL found');
      finalFilePath = path.resolve(__dirname, '../../', video.videoUrl);
    }

    // File verification (existing code remains the same)
    if (!fs.existsSync(finalFilePath)) {
      throw new Error(`Video file not found at: ${finalFilePath}`);
    }

    // Verify file content
    const stats = fs.statSync(finalFilePath);
    if (stats.size === 0) {
      throw new Error('File exists but is empty (0 bytes)');
    }

    // Create thumbnails directory if it doesn't exist
    const thumbnailsDir = path.join(__dirname, '../../backend/thumbnails');
    if (!fs.existsSync(thumbnailsDir)) {
      fs.mkdirSync(thumbnailsDir, { recursive: true });
    }

    // Generate thumbnail
    const thumbnailFilename = `${videoId}.jpg`;
    const thumbnailPath = path.join(thumbnailsDir, thumbnailFilename);
    try {
      await generateThumbnail(finalFilePath, thumbnailPath);
      video.thumbnailUrl = `/thumbnails/${thumbnailFilename}`;
    } catch (thumbnailError) {
      console.error('Using default thumbnail due to:', thumbnailError);
      video.thumbnailUrl = '/default-thumbnail.jpg';
    }

    // Generate transcript
    console.log(`Generating transcript for video: ${videoId}`);
    const transcript = await generateTranscript(finalFilePath);

    // Update video status with transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const updatedVideo = await Video.findByIdAndUpdate(
        videoId,
        {
          status: 'processed',
          transcript,
          thumbnailUrl: video.thumbnailUrl,
          duration: transcript.duration,
          updatedAt: new Date(),
          processingCompletedAt: new Date()
        },
        { new: true, session }
      );

      await session.commitTransaction();
      console.log(`Successfully processed video ${videoId}`);

      return {
        success: true,
        videoId: updatedVideo._id,
        status: updatedVideo.status,
        thumbnailUrl: updatedVideo.thumbnailUrl,
        transcriptId: transcript.id
      };
    } catch (dbError) {
      await session.abortTransaction();
      throw dbError;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error(`Processing failed for video ${videoId}:`, error.stack || error);

    // Error handling (existing code remains the same)
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date()
    };

    try {
      await Video.findByIdAndUpdate(
        videoId,
        {
          status: 'failed',
          error: errorDetails,
          updatedAt: new Date()
        }
      );
    } catch (dbError) {
      console.error('Failed to update video status:', dbError);
    }

    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupError) {
        console.error('File cleanup failed:', cleanupError);
      }
    }

    const processingError = new Error(`Video processing failed: ${error.message}`);
    processingError.details = errorDetails;
    throw processingError;
  }
};

module.exports = processVideo;