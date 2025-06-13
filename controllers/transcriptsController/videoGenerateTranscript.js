const { YoutubeTranscript } = require('youtube-transcript');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');
const fs = require('fs');

const generateTranscript = async ({ filePath, videoId, source }) => {
  try {
    console.log(`[Transcript] Generating for ${source} video: ${videoId || filePath}`);

    let transcript = {
      text: '',
      segments: [],
      language: 'en',
      duration: 0,
    };

    if (source === 'youtube' && videoId) {
      // Fetch YouTube transcript
      try {
        const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
        transcript.text = transcriptData.map(s => s.text).join(' ');
        transcript.segments = transcriptData.map((s, i) => ({
          id: `segment-${i}`,
          text: s.text,
          start: s.offset / 1000, // Convert ms to seconds
          end: (s.offset + s.duration) / 1000,
          duration: s.duration / 1000,
          confidence: null,
          words: [],
        }));
        transcript.duration = transcript.segments.length
          ? transcript.segments[transcript.segments.length - 1].end
          : 0;
      } catch (error) {
        console.error('[Transcript] YouTube transcript error:', error);
        throw new Error('No transcript available for this YouTube video');
      }
    } else if (source === 'upload' && filePath) {
      // Process uploaded video with Whisper
      try {
        const outputDir = path.dirname(filePath);
        const outputFile = path.join(outputDir, `transcript-${Date.now()}.json`);
        const command = `whisper ${filePath} --model small --output_format json --language en --output_dir ${outputDir}`;
        console.log(`[Transcript] Whisper command: ${command}`);

        const { stdout, stderr } = await execPromise(command);
        if (stderr) {
          console.warn('[Transcript] Whisper stderr:', stderr);
        }

        const transcriptJson = JSON.parse(fs.readFileSync(outputFile));
        transcript.text = transcriptJson.text || '';
        transcript.segments = transcriptJson.segments.map((s, i) => ({
          id: `segment-${i}`,
          text: s.text,
          start: s.start, // Already in seconds
          end: s.end,
          duration: s.end - s.start,
          confidence: s.confidence || null,
          words: s.words || [],
        }));
        transcript.duration = transcriptJson.info?.duration || transcript.segments[transcript.segments.length - 1]?.end || 0;
        fs.unlinkSync(outputFile); // Clean up
      } catch (error) {
        console.error('[Transcript] Whisper error:', error);
        throw new Error('Failed to generate transcript for uploaded video');
      }
    } else {
      throw new Error('Invalid source or missing parameters');
    }

    console.log(`[Transcript] Generated:`, JSON.stringify(transcript.segments.slice(0, 2), null, 2));

    return transcript;
  } catch (error) {
    console.error('[Transcript] Error:', error);
    throw new Error(`Transcription error: ${error.message}`);
  }
};

module.exports = { generateTranscript };