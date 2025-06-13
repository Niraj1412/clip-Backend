const Video = require('../../model/uploadVideosSchema');
const { generateTranscript } = require('../transcriptsController/videoGenerateTranscript');
const { generateThumbnail } = require('./thumbnailGenerator');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const processVideo = async ({ videoId, filePath, userId, isBackgroundProcess = false, authToken }) => {
  let finalFilePath;
  try {
    console.log(`Starting processing for video: ${videoId}`);
    console.log('Auth token:', authToken ? 'provided' : 'not provided');

    const video = await Video.findOne({
      _id: videoId,
      ...(!isBackgroundProcess && { userId }),
    });

    if (!video) {
      throw new Error('Video not found or unauthorized access');
    }

    // Resolve file path
    const uploadsBase = process.env.UPLOADS_DIR || '/app/backend/uploads';
    if (filePath) {
      finalFilePath = filePath.startsWith('uploads/') || filePath.startsWith('backend/uploads/')
        ? path.join(uploadsBase, path.basename(filePath))
        : path.resolve(uploadsBase, path.basename(filePath));
    } else {
      if (!video.videoUrl) throw new Error('No video URL found');
      finalFilePath = video.videoUrl.startsWith('uploads/') || video.videoUrl.startsWith('backend/uploads/')
        ? path.join(uploadsBase, path.basename(video.videoUrl))
        : path.join(uploadsBase, path.basename(video.videoUrl));
    }

    console.log(`[Debug] Resolved file path: ${finalFilePath}`);

    if (!fs.existsSync(finalFilePath)) {
      throw new Error(`Video file not found at: ${finalFilePath}`);
    }

    const stats = fs.statSync(finalFilePath);
    if (stats.size === 0) {
      throw new Error('File exists but is empty (0 bytes)');
    }

    // Create thumbnails directory
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
    const transcript = await generateTranscript({
      filePath: finalFilePath,
      videoId: video.videoId, // For YouTube videos
      source: video.source,
    });

    // Validate and normalize transcript
    if (!transcript?.segments?.length) {
      throw new Error('No transcript segments generated');
    }

    const normalizedTranscript = {
      text: transcript.text || '',
      language: transcript.language || 'en',
      segments: transcript.segments.map((segment, index) => {
        let start = segment.start ?? segment.startTime ?? 0;
        let end = segment.end ?? segment.endTime ?? 0;

        // Convert milliseconds to seconds if needed
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

        return {
          id: segment.id || `segment-${index}`,
          text: segment.text || '',
          start: Number(start.toFixed(3)),
          end: Number(end.toFixed(3)),
          duration: Number((end - start).toFixed(3)),
          confidence: segment.confidence ?? null,
          words: segment.words || [],
        };
      }),
    };

    console.log(`[Process] Normalized transcript:`, JSON.stringify(normalizedTranscript.segments.slice(0, 2), null, 2));

    // Validate duration
    let duration = transcript.duration || 0;
    if (duration > 1000) {
      console.warn(`[Transcript] Large duration: ${duration}, converting from ms to s`);
      duration /= 1000;
    }
    if (!duration && normalizedTranscript.segments.length) {
      duration = normalizedTranscript.segments[normalizedTranscript.segments.length - 1].end;
    }

    // Update video with transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const updatedVideo = await Video.findByIdAndUpdate(
        videoId,
        {
          status: 'processed',
          transcript: normalizedTranscript,
          thumbnailUrl: video.thumbnailUrl,
          duration: Number(duration.toFixed(3)),
          updatedAt: new Date(),
          processingCompletedAt: new Date(),
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
        transcriptId: updatedVideo.transcript.id,
      };
    } catch (dbError) {
      await session.abortTransaction();
      throw dbError;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error(`Processing failed for video ${videoId}:`, error.stack || error);

    const errorDetails = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date(),
    };

    try {
      await Video.findByIdAndUpdate(videoId, {
        status: 'failed',
        processingError: errorDetails.message,
        updatedAt: new Date(),
      });
    } catch (dbError) {
      console.error('Failed to update video status:', dbError);
    }

    if (finalFilePath && fs.existsSync(finalFilePath) && finalFilePath.includes('/tmp/')) {
      try {
        fs.unlinkSync(finalFilePath);
        console.log(`[Cleanup] Deleted temporary file: ${finalFilePath}`);
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