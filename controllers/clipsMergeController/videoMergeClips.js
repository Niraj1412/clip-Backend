const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Video = require('../../model/uploadVideosSchema');
const FinalVideo = require('../../model/finalVideosSchema');
const { uploadToS3 } = require('../../utils/s3');

// Set FFmpeg path
ffmpeg.setFfmpegPath(require('ffmpeg-static'));

/**
 * Merges multiple video clips into a single video
 * @param {Array} clips - Array of clip objects with videoId, startTime, endTime
 * @param {Object} user - User information
 * @param {Object} videoInfo - Video title and description
 * @returns {Promise<Object>} - Merged video information
 */
const videoMergeClips = async (clips, user, videoInfo = {}) => {
  try {
    // Validate input
    if (!clips || clips.length === 0) {
      throw new Error('No clips provided for merging');
    }

    // Create directories if they don't exist
    const tempDir = path.join(__dirname, '../../../tmp');
    const outputDir = path.join(__dirname, '../../../output');
    [tempDir, outputDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    const jobId = uuidv4();
    const tempJobDir = path.join(tempDir, jobId);
    fs.mkdirSync(tempJobDir);

    // Calculate total duration and get clip details
    let totalDuration = 0;
    const clipDetails = await Promise.all(
      clips.map(async (clip) => {
        const video = await Video.findById(clip.videoId);
        if (!video) throw new Error(`Video not found for ID: ${clip.videoId}`);

        const clipDuration = clip.endTime - clip.startTime;
        totalDuration += clipDuration;

        return {
          path: video.videoUrl,
          localPath: path.join(tempJobDir, `clip_${clips.indexOf(clip)}.mp4`),
          startTime: clip.startTime,
          endTime: clip.endTime,
          duration: clipDuration,
          videoId: clip.videoId,
          title: clip.title || video.title,
          thumbnail: video.thumbnailUrl,
          originalVideoTitle: video.title
        };
      })
    );

    // Merge videos
    const outputFileName = `merged_${jobId}.mp4`;
    const outputPath = path.join(outputDir, outputFileName);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      let command = ffmpeg();

      // Add all input files with trimming options
      clipDetails.forEach((clip) => {
        command.input(clip.path)
          .inputOptions([`-ss ${clip.startTime}`])
          .inputOptions([`-to ${clip.endTime}`]);
      });

      // Complex filter for concatenation
      command.complexFilter([
        {
          filter: 'concat',
          options: { n: clipDetails.length, v: 1, a: 1 },
          outputs: ['v', 'a']
        }
      ])
      .outputOptions([
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '22'
      ])
      .save(outputPath)
      .on('start', (commandLine) => {
        console.log(`[${jobId}] FFmpeg command:`, commandLine);
      })
      .on('progress', (progress) => {
        console.log(`[${jobId}] Progress: ${progress.percent}%`);
      })
      .on('end', async () => {
        try {
          console.log(`[${jobId}] Merge completed`);
          
          // Upload to S3
          const s3Key = `merged-videos/${outputFileName}`;
          const s3Url = await uploadToS3(outputPath, s3Key);
          
          // Generate thumbnail (implement your thumbnail generation logic)
          const thumbnailUrl = await generateThumbnail(outputPath);

          // Save to database
          const finalVideo = new FinalVideo({
            userId: user.id,
            jobId,
            title: videoInfo.title || `Merged Video ${new Date().toLocaleDateString()}`,
            description: videoInfo.description || '',
            duration: totalDuration,
            s3Url,
            thumbnailUrl,
            userEmail: user.email,
            userName: user.name,
            sourceClips: clipDetails.map(clip => ({
              videoId: clip.videoId,
              title: clip.title,
              startTime: clip.startTime,
              endTime: clip.endTime,
              duration: clip.duration,
              thumbnail: clip.thumbnail,
              originalVideoTitle: clip.originalVideoTitle
            })),
            stats: {
              totalClips: clipDetails.length,
              totalDuration,
              processingTime: Date.now() - startTime,
              mergeDate: new Date()
            }
          });

          await finalVideo.save();

          // Clean up
          fs.rmSync(tempJobDir, { recursive: true, force: true });
          fs.unlinkSync(outputPath);

          resolve({
            success: true,
            videoUrl: s3Url,
            videoId: finalVideo._id,
            thumbnailUrl,
            duration: totalDuration
          });
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (err) => {
        console.error(`[${jobId}] Merge error:`, err);
        fs.rmSync(tempJobDir, { recursive: true, force: true });
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        reject(err);
      });
    });
  } catch (error) {
    console.error('Merge clips error:', error);
    throw error;
  }
};

// Helper function to generate thumbnail (implement your actual thumbnail generation)
const generateThumbnail = async (videoPath) => {
  // Implement your thumbnail generation logic
  return 'https://example.com/default-thumbnail.jpg';
};

module.exports = {
  videoMergeClips
};