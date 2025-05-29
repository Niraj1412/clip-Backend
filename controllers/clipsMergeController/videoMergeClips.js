const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Video = require('../../model/uploadVideosSchema');
const FinalVideo = require('../../model/finalVideosSchema');
const { uploadToS3 } = require('../../utils/s3');

// Configure FFmpeg path
const ffmpegPath = process.env.NODE_ENV === 'production' 
  ? process.env.FFMPEG_PATH || '/usr/bin/ffmpeg'
  : require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

// Helper to normalize video formats
const normalizeVideo = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',
        '-preset fast',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-crf 23',
        '-max_muxing_queue_size 1024' // Prevent muxing errors
      ])
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
};

const videoMergeClips = async (clips, user, videoInfo = {}) => {
  const jobId = uuidv4();
  console.log(`[${jobId}] Starting video merge process`);

  try {
    // Validate input
    if (!clips || clips.length === 0) {
      throw new Error('No clips provided for merging');
    }

    // Create working directories
    const tempDir = path.join(__dirname, '../../../tmp', jobId);
    const outputDir = path.join(__dirname, '../../../output');
    
    [tempDir, outputDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Normalize all input videos first
    const normalizedClips = await Promise.all(
      clips.map(async (clip, index) => {
        const video = await Video.findById(clip.videoId);
        if (!video) throw new Error(`Video not found for ID: ${clip.videoId}`);

        const resolvedPath = resolveVideoPath(video.videoUrl);
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`Video file not found at: ${resolvedPath}`);
        }

        const normalizedPath = path.join(tempDir, `normalized_${index}.mp4`);
        await normalizeVideo(resolvedPath, normalizedPath);

        return {
          path: normalizedPath,
          startTime: clip.startTime,
          endTime: clip.endTime,
          duration: clip.endTime - clip.startTime,
          videoId: clip.videoId.toString(),
          title: clip.title || video.title,
          thumbnail: video.thumbnailUrl,
          originalVideoTitle: video.title
        };
      })
    );

    // Calculate total duration
    const totalDuration = normalizedClips.reduce((sum, clip) => sum + clip.duration, 0);

    // Merge videos
    const outputFileName = `merged_${jobId}.mp4`;
    const outputPath = path.join(outputDir, outputFileName);
    const startTime = Date.now();

    console.log(`[${jobId}] Starting FFmpeg merge process`);

    return new Promise((resolve, reject) => {
      const command = ffmpeg();
      let ffmpegProcess;

      // Add all normalized input files
      normalizedClips.forEach(clip => {
        command.input(clip.path)
          .inputOptions([`-ss ${clip.startTime}`])
          .inputOptions([`-to ${clip.endTime}`]);
      });

      // Set up FFmpeg command with robust settings
      command.complexFilter([
        {
          filter: 'concat',
          options: { 
            n: normalizedClips.length, 
            v: 1, 
            a: 1,
            unsafe: 1 // Allow potentially unsafe operations
          },
          outputs: ['v', 'a']
        }
      ])
      .outputOptions([
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '22',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
        '-max_muxing_queue_size', '1024', // Prevent muxing errors
        '-threads', '2' // Limit thread usage
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
          
          // Generate thumbnail (simplified for example)
          const thumbnailUrl = normalizedClips[0]?.thumbnail || '';

          // Upload to S3
          const s3Key = `merged-videos/${user.id}/${outputFileName}`;
          const s3Url = await uploadToS3(outputPath, s3Key, {
            ContentType: 'video/mp4',
            ACL: 'public-read'
          });

          // Save to database
          const finalVideo = new FinalVideo({
            userId: user.id.toString(),
            title: videoInfo.title || `Merged Video ${new Date().toLocaleDateString()}`,
            description: videoInfo.description || '',
            jobId,
            duration: totalDuration,
            s3Url,
            thumbnailUrl,
            userEmail: user.email || '',
            userName: user.name || '',
            sourceClips: normalizedClips.map(clip => ({
              videoId: clip.videoId,
              title: clip.title,
              startTime: clip.startTime,
              endTime: clip.endTime,
              duration: clip.duration,
              thumbnail: clip.thumbnail,
              originalVideoTitle: clip.originalVideoTitle
            })),
            stats: {
              totalClips: normalizedClips.length,
              totalDuration,
              processingTime: Date.now() - startTime,
              mergeDate: new Date()
            }
          });

          await finalVideo.save();

          // Clean up
          fs.rmSync(tempDir, { recursive: true, force: true });
          fs.unlinkSync(outputPath);

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
      .on('error', (err, stdout, stderr) => {
        console.error(`[${jobId}] FFmpeg error:`, err);
        console.error(`[${jobId}] FFmpeg stdout:`, stdout);
        console.error(`[${jobId}] FFmpeg stderr:`, stderr);
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
  videoMergeClips
};