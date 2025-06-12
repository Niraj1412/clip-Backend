const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Video = require('../../model/uploadVideosSchema');
const FinalVideo = require('../../model/finalVideosSchema');
const { uploadToS3 } = require('../../utils/s3');
const ffmpeg = require('fluent-ffmpeg');

const configureFfmpeg = () => {
  let ffmpegPath;
  const isProduction = process.env.NODE_ENV === 'production';

  try {
    if (isProduction) {
      ffmpegPath = '/usr/bin/ffmpeg';
    } else {
      try {
        ffmpegPath = require('ffmpeg-static');
        console.log('Using ffmpeg-static path:', ffmpegPath);
      } catch (err) {
        ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
        console.warn('Falling back to system FFmpeg:', ffmpegPath);
      }
    }

    console.log(`Setting FFmpeg path to: ${ffmpegPath}`);
    ffmpeg.setFfmpegPath(ffmpegPath);

    const command = ffmpeg();
    command
      .on('start', () => console.log('FFmpeg verification started'))
      .on('error', err => {
        console.error('FFmpeg verification failed:', err);
        if (isProduction) {
          throw new Error(`FFmpeg verification failed in production: ${err.message}`);
        }
      })
      .on('end', () => console.log('FFmpeg is available for use'))
      .outputOptions(['-version'])
      .output(isProduction ? '/dev/null' : 'NUL')
      .run();
  } catch (err) {
    console.error('Error configuring FFmpeg:', err);
    if (isProduction) {
      throw new Error(`Failed to configure FFmpeg in production: ${err.message}`);
    }
  }
};

configureFfmpeg();

const resolveVideoPath = (filePath) => {
  console.log(`[Path Resolution] Attempting to resolve: ${filePath}`);

  if (!filePath) {
    throw new Error('File path is undefined or empty');
  }

  const uploadsBase = process.env.UPLOADS_DIR || '/app/backend/uploads';
  const filename = path.basename(filePath);
  const normalizedFilePath = filePath.replace(/\\/g, '/');

  const possiblePaths = [
    normalizedFilePath,
    path.join(uploadsBase, filename),
    path.join(uploadsBase, normalizedFilePath.replace(/^backend\/uploads\//, '')),
  ];

  console.log('[Path Resolution] Checking paths:', possiblePaths);

  for (const p of possiblePaths) {
    const normalizedPath = path.normalize(p);
    if (fs.existsSync(normalizedPath)) {
      console.log(`[Path Resolution] Found at: ${normalizedPath}, size: ${fs.statSync(normalizedPath).size} bytes`);
      return normalizedPath;
    }
  }

  const debugInfo = {
    cwd: process.cwd(),
    environment: process.env.NODE_ENV,
    uploadsBase,
    originalPath: filePath,
    checkedPaths: possiblePaths,
  };
  console.error('[Path Resolution] Debug info:', debugInfo);

  try {
    const uploadsContent = fs.readdirSync(uploadsBase);
    console.log(`[Path Resolution] Contents of ${uploadsBase}:`, uploadsContent);
  } catch (err) {
    console.error(`[Path Resolution] Could not read ${uploadsBase}:`, err);
  }

  throw new Error(`Could not resolve path for: ${filePath}\nTried paths:\n${possiblePaths.join('\n')}`);
};

const videoMergeClips = async (jobId, clips, user) => {
  if (!jobId) {
    throw new Error('Job ID is required');
  }
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error('Clips must be a non-empty array');
  }
  if (!user || !user.id) {
    throw new Error('User object with ID is required');
  }

  console.log(`[${jobId}] Processing ${clips.length} clips for user ${user.id}`);
  const tempDir = path.join(process.env.TEMP_DIR || '/app/tmp', `merge-${jobId}`);
  const outputDir = process.env.OUTPUT_DIR || '/app/output';
  const outputFilename = `merged-${uuidv4()}.mp4`;
  const outputPath = path.join(outputDir, outputFilename);

  try {
    // Create directories
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    // Validate clips
    clips.forEach((clip, index) => {
      if (!clip.videoId || !clip.startTime || !clip.endTime) {
        throw new Error(`Invalid clip at index ${index}: missing videoId, startTime, or endTime`);
      }
    });

    // Prepare clip segments
    const clipFiles = [];
    for (const clip of clips) {
      const video = await Video.findById(clip.videoId);
      if (!video) throw new Error(`Video not found: ${clip.videoId}`);
      console.log(`[Debug] Video URL from DB: ${video.videoUrl}`);

      const resolvedPath = resolveVideoPath(video.videoUrl);
      const tempClipPath = path.join(tempDir, `clip-${uuidv4()}.mp4`);

      console.log(`[${jobId}] Processing clip from ${resolvedPath} [${clip.startTime}s - ${clip.endTime}s]`);

      // Extract clip with re-encoding
      await new Promise((resolve, reject) => {
        ffmpeg(resolvedPath)
          .setStartTime(clip.startTime)
          .setDuration(clip.endTime - clip.startTime)
          .outputOptions([
            '-c:v libx264',
            '-preset fast',
            '-crf 23',
            '-c:a aac',
            '-b:a 192k',
            '-movflags +faststart',
            '-f mp4',
          ])
          .output(tempClipPath)
          .on('start', commandLine => console.log(`[${jobId}] FFmpeg command: ${commandLine}`))
          .on('progress', progress => console.log(`[${jobId}] Processing: ${progress.percent}% done`))
          .on('error', err => {
            console.error(`[${jobId}] FFmpeg error:`, err);
            reject(err);
          })
          .on('end', () => {
            console.log(`[${jobId}] Clip extracted to ${tempClipPath}`);
            resolve();
          })
          .run();
      });

      clipFiles.push(tempClipPath);
    }

    // Create concat list file
    const concatListPath = path.join(tempDir, 'concat.txt');
    const concatContent = clipFiles.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(concatListPath, concatContent);
    console.log(`[${jobId}] Concat list created at ${concatListPath}`);

    // Merge clips
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions([
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-c:a aac',
          '-b:a 192k',
          '-movflags +faststart',
          '-f mp4',
        ])
        .output(outputPath)
        .on('start', commandLine => console.log(`[${jobId}] Merge FFmpeg command: ${commandLine}`))
        .on('progress', progress => console.log(`[${jobId}] Merging: ${progress.percent}% done`))
        .on('error', err => {
          console.error(`[${jobId}] Merge FFmpeg error:`, err);
          reject(err);
        })
        .on('end', () => {
          console.log(`[${jobId}] Merged video created at ${outputPath}`);
          resolve();
        })
        .run();
    });

    // Verify output file
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Merged video not found at ${outputPath}`);
    }
    const stats = fs.statSync(outputPath);
    console.log(`[${jobId}] Output file size: ${stats.size} bytes`);

    // Upload to S3
    const s3Key = `final-videos/${outputFilename}`;
    const s3Url = await uploadToS3(outputPath, s3Key, {
      ContentType: 'video/mp4',
      ACL: 'public-read',
    });
    console.log(`[${jobId}] Uploaded to S3: ${s3Url}`);

    // Save to database
    const finalVideo = new FinalVideo({
      userId: user.id,
      clipsInfo: clips,
      fileNames3: outputFilename,
      s3Url,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await finalVideo.save();
    console.log(`[${jobId}] Saved to database with ID: ${finalVideo._id}`);

    return {
      success: true,
      videoUrl: s3Url,
      finalVideoId: finalVideo._id,
    };
  } catch (error) {
    console.error(`[${jobId}] Merge error:`, error);
    throw error;
  } finally {
    // Cleanup
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      console.log(`[${jobId}] Cleaned up temporary files`);
    } catch (cleanupErr) {
      console.error(`[${jobId}] Cleanup error:`, cleanupErr);
    }
  }
};

module.exports = { resolveVideoPath, videoMergeClips };