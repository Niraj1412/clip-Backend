const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Video = require('../../model/uploadVideosSchema');
const FinalVideo = require('../../model/finalVideosSchema');
const { uploadToS3 } = require('../../utils/s3');
const { generateThumbnail } = require('../videosController/thumbnailGenerator'); // Import your thumbnail generator

// Configure FFmpeg path based on environment
const ffmpegPath = process.env.NODE_ENV === 'production' 
  ? process.env.FFMPEG_PATH || '/usr/bin/ffmpeg'
  : require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Resolves the full path to a video file
 * @param {string} filePath - The stored file path
 * @returns {string} - Absolute path to the file
 */
const resolveVideoPath = (filePath) => {
  // Handle absolute paths
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  // Handle production paths (Railway)
  if (process.env.RAILWAY_ENVIRONMENT === 'production') {
    const productionPaths = [
      path.join('/backend/uploads', path.basename(filePath)),
      path.join('/app/uploads', path.basename(filePath)),
      path.join('/uploads', path.basename(filePath))
    ];

    for (const p of productionPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  // Development paths
  const devPath = path.join(__dirname, '../../uploads', path.basename(filePath));
  if (fs.existsSync(devPath)) return devPath;

  throw new Error(`Could not resolve path for: ${filePath}`);
};

/**
 * Merges multiple video clips into a single video
 * @param {Array} clips - Array of clip objects with videoId, startTime, endTime
 * @param {Object} user - User information
 * @param {Object} videoInfo - Video title and description
 * @returns {Promise<Object>} - Merged video information
 */
const videoMergeClips = async (clips, user, videoInfo = {}) => {
  const jobId = uuidv4();
  console.log(`[${jobId}] Starting video merge process`);

  try {
    // Validate input
    if (!clips || clips.length === 0) {
      throw new Error('No clips provided for merging');
    }

    // Create working directories
    const tempDir = process.env.TEMP_DIR || path.join(__dirname, '../../../tmp');
    const outputDir = process.env.OUTPUT_DIR || path.join(__dirname, '../../../output');
    
    [tempDir, outputDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    const tempJobDir = path.join(tempDir, jobId);
    fs.mkdirSync(tempJobDir);

    // Calculate total duration and get clip details with resolved paths
    let totalDuration = 0;
    const clipDetails = await Promise.all(
      clips.map(async (clip) => {
        const video = await Video.findById(clip.videoId);
        if (!video) throw new Error(`Video not found for ID: ${clip.videoId}`);

        // Resolve the actual file path
        const resolvedPath = resolveVideoPath(video.videoUrl);
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`Video file not found at: ${resolvedPath}`);
        }

        const clipDuration = clip.endTime - clip.startTime;
        totalDuration += clipDuration;

        return {
          path: resolvedPath,
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

    console.log(`[${jobId}] Starting FFmpeg merge process`);

    return new Promise((resolve, reject) => {
      let command = ffmpeg();
      let ffmpegProcess;

      // Add all input files with trimming options
      clipDetails.forEach((clip) => {
        command.input(clip.path)
          .inputOptions([`-ss ${clip.startTime}`])
          .inputOptions([`-to ${clip.endTime}`]);
      });

      // Set up FFmpeg command
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
        '-crf', '22',
        '-movflags', '+faststart'
      ])
      .on('start', (commandLine) => {
        console.log(`[${jobId}] FFmpeg command:`, commandLine);
        ffmpegProcess = commandLine;
      })
      .on('progress', (progress) => {
        console.log(`[${jobId}] Progress: ${Math.round(progress.percent || 0)}%`);
      })
      .on('end', async () => {
        try {
          console.log(`[${jobId}] Merge completed successfully`);
          
          // Generate thumbnail using your existing function
          const thumbnailPath = path.join(outputDir, `thumbnail_${jobId}.jpg`);
          let thumbnailUrl = '';
          try {
            await generateThumbnail(outputPath, thumbnailPath);
            
            // Upload thumbnail to S3
            const thumbnailKey = `merged-videos/${user.id}/thumbnails/thumbnail_${jobId}.jpg`;
            thumbnailUrl = await uploadToS3(thumbnailPath, thumbnailKey, {
              ContentType: 'image/jpeg',
              ACL: 'public-read'
            });
            
            // Clean up local thumbnail
            fs.unlinkSync(thumbnailPath);
          } catch (thumbnailError) {
            console.error(`[${jobId}] Thumbnail generation/upload failed:`, thumbnailError);
            // Fallback to first clip's thumbnail if available
            thumbnailUrl = clipDetails[0]?.thumbnail || 'https://example.com/default-thumbnail.jpg';
          }
          
          // Upload merged video to S3
          const s3Key = `merged-videos/${user.id}/${outputFileName}`;
          const s3Url = await uploadToS3(outputPath, s3Key, {
            ContentType: 'video/mp4',
            ACL: 'public-read'
          });

          if (!s3Url) {
            throw new Error('Failed to get S3 URL after upload');
          }

          // Save to database - ensure all required fields are included
          const finalVideo = new FinalVideo({
            userId: user.id,
            jobId,
            title: videoInfo.title || `Merged Video ${new Date().toLocaleDateString()}`,
            description: videoInfo.description || '',
            duration: totalDuration,
            videoUrl: s3Url,
            s3Url: s3Url, // Explicitly set both fields
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

          // Clean up temporary files
          fs.rmSync(tempJobDir, { recursive: true, force: true });
          fs.unlinkSync(outputPath, (err) => {
            if (err) console.error(`[${jobId}] Error deleting output file:`, err);
          });

          resolve({
            success: true,
            videoUrl: s3Url,
            videoId: finalVideo._id,
            thumbnailUrl,
            duration: totalDuration
          });
        } catch (err) {
          console.error(`[${jobId}] Post-merge error:`, err);
          reject(err);
        }
      })
      .on('error', (err) => {
        console.error(`[${jobId}] FFmpeg error:`, err);
        if (ffmpegProcess) {
          try {
            process.kill(ffmpegProcess.pid, 'SIGKILL');
          } catch (killErr) {
            console.error(`[${jobId}] Error killing FFmpeg process:`, killErr);
          }
        }
        fs.rmSync(tempJobDir, { recursive: true, force: true });
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath, (unlinkErr) => {
            if (unlinkErr) console.error(`[${jobId}] Error deleting output file:`, unlinkErr);
          });
        }
        reject(new Error(`Video processing failed: ${err.message}`));
      })
      .save(outputPath);
    });
  } catch (error) {
    console.error(`[${jobId}] Merge clips error:`, error);
    throw error;
  }
};

module.exports = {
  videoMergeClips,
  resolveVideoPath
};