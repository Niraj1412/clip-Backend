const { AssemblyAI } = require('assemblyai');
const path = require('path');
const fs = require('fs');

const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY,
});

const generateTranscript = async ({ filePath, videoId, source }) => {
  try {
    console.log(`[Transcript] Generating for ${source} video: ${videoId || filePath}`);

    let audioUrl = filePath;

    // Handle local files for uploaded videos
    if (source === 'upload' && filePath) {
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Video file not found at: ${resolvedPath}`);
      }

      console.log('[Transcript] Uploading file to AssemblyAI...');
      const fileStream = fs.createReadStream(resolvedPath);
      audioUrl = await client.files.upload(fileStream);
    } else if (source === 'youtube' && videoId) {
      // For YouTube, assume filePath is a URL or fetch audio separately
      if (!filePath) {
        throw new Error('No audio URL provided for YouTube video');
      }
      audioUrl = filePath; // Expect filePath to be a direct audio URL
    } else {
      throw new Error('Invalid source or missing parameters');
    }

    console.log('[Transcript] Submitting for transcription...');
    let transcript = await client.transcripts.create({
      audio_url: audioUrl,
      speaker_labels: true,
      auto_highlights: true,
      disfluencies: true,
      format_text: true,
    });

    // Poll for completion with timeout
    const startTime = Date.now();
    const timeout = 600000; // 10 minutes

    while (transcript.status !== 'completed' && transcript.status !== 'error') {
      if (Date.now() - startTime > timeout) {
        throw new Error('Transcription timeout');
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
      transcript = await client.transcripts.get(transcript.id);
      console.log(`[Transcript] Status: ${transcript.status}`);
    }

    if (transcript.status === 'error') {
      throw new Error(transcript.error);
    }

    // Convert milliseconds to seconds
    const result = {
      text: transcript.text || '',
      duration: transcript.audio_duration ? transcript.audio_duration / 1000 : 0, // Seconds
      language: transcript.language || 'en',
      segments: transcript.utterances?.map((u, i) => ({
        id: `segment-${i}`,
        start: u.start / 1000, // Convert ms to seconds
        end: u.end / 1000, // Convert ms to seconds
        duration: (u.end - u.start) / 1000, // Seconds
        text: u.text,
        speaker: u.speaker,
        confidence: transcript.confidence || null,
        words: u.words || [],
      })) || [],
    };

    console.log(`[Transcript] Generated:`, JSON.stringify(result.segments.slice(0, 2), null, 2));

    return result;
  } catch (error) {
    console.error('[Transcript] Failed:', error);
    throw new Error(`Transcription error: ${error.message}`);
  }
};

module.exports = { generateTranscript };