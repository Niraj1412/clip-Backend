const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error('Gemini API key is missing. Please check your .env file.');
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Track rate limits
let lastRequestTime = 0;
const REQUEST_DELAY = 1000; // 1 second delay between requests for free tier

// More accurate token counting function
const countTokens = (text) => {
    return Math.ceil(text.length / 4);
};

// Create chunks based on a maximum token count
const createTokenAwareChunks = (transcripts, maxTokensPerChunk = 40000) => {
    const reservedTokens = 5000;
    const effectiveMaxTokens = maxTokensPerChunk - reservedTokens;
    
    const chunks = [];
    let currentChunk = [];
    let currentChunkTokens = 0;
    
    for (let i = 0; i < transcripts.length; i++) {
        const transcript = transcripts[i];
        const transcriptJson = JSON.stringify(transcript, null, 2);
        const transcriptTokens = countTokens(transcriptJson);
        
        if (transcriptTokens > effectiveMaxTokens) {
            console.warn(`Transcript at index ${i} exceeds token limit (${transcriptTokens} tokens). Including it as a single chunk.`);
            
            if (currentChunk.length > 0) {
                chunks.push([...currentChunk]);
                currentChunk = [];
                currentChunkTokens = 0;
            }
            
            chunks.push([transcript]);
            continue;
        }
        
        if (currentChunkTokens + transcriptTokens > effectiveMaxTokens && currentChunk.length > 0) {
            chunks.push([...currentChunk]);
            currentChunk = [];
            currentChunkTokens = 0;
        }
        
        currentChunk.push(transcript);
        currentChunkTokens += transcriptTokens;
    }
    
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }
    
    return chunks;
};

// Enhanced rate limit handling
const callGeminiWithRetry = async (messages, modelName, temperature, maxRetries = 5) => {
    let retries = 0;
    const model = genAI.getGenerativeModel({ model: modelName });
    
    while (retries <= maxRetries) {
        try {
            // Enforce rate limiting
            const now = Date.now();
            const timeSinceLastRequest = now - lastRequestTime;
            
            if (timeSinceLastRequest < REQUEST_DELAY) {
                const delay = REQUEST_DELAY - timeSinceLastRequest;
                console.log(`Rate limiting: Waiting ${delay}ms before next request`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            // Convert messages to Gemini format
            const geminiMessages = messages.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            }));
            
            const chat = model.startChat({
                history: geminiMessages.slice(0, -1),
                generationConfig: { 
                    temperature,
                    maxOutputTokens: 4000 // Limit output size to stay within quotas
                }
            });
            
            lastRequestTime = Date.now();
            const result = await chat.sendMessage(geminiMessages[geminiMessages.length - 1].parts[0].text);
            const response = await result.response;
            return response.text();
        } catch (error) {
            if (error.status === 429) {
                // Parse the retry delay from the error if available
                let retryAfter = 60000; // Default 1 minute
                
                try {
                    const retryInfo = error.errorDetails?.find(d => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
                    if (retryInfo && retryInfo.retryDelay) {
                        const match = retryInfo.retryDelay.match(/(\d+)s/);
                        if (match) {
                            retryAfter = parseInt(match[1]) * 1000;
                        }
                    }
                } catch (e) {
                    console.error('Error parsing retry info:', e);
                }
                
                if (retries < maxRetries) {
                    console.log(`Rate limit exceeded. Retrying after ${retryAfter/1000} seconds... (Attempt ${retries + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, retryAfter));
                    retries++;
                } else {
                    throw new Error(`Rate limit exceeded after ${maxRetries} retries. Please try again later or upgrade your plan.`);
                }
            } else if (error.message.includes('quota')) {
                throw new Error('You have exceeded your daily quota. Please check your billing or try again tomorrow.');
            } else {
                throw error;
            }
        }
    }
};

const generateClips = async (req, res) => {
    try {
        const { transcripts, customPrompt } = req.body;

        if (!transcripts || !Array.isArray(transcripts) || transcripts.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid or missing transcripts data"
            });
        }

        console.log("Generating clips from transcripts:", transcripts.length);
        
        const allTranscriptsJson = JSON.stringify(transcripts, null, 2);
        const totalTokens = countTokens(allTranscriptsJson);
        console.log(`Total estimated tokens in all transcripts: ${totalTokens}`);

        // Reduce chunk size to stay within free tier limits
        const transcriptChunks = createTokenAwareChunks(transcripts, 20000);
        console.log(`Split transcripts into ${transcriptChunks.length} token-aware chunks`);
        
        transcriptChunks.forEach((chunk, idx) => {
            const chunkJson = JSON.stringify(chunk, null, 2);
            const chunkTokens = countTokens(chunkJson);
            console.log(`Chunk ${idx+1}: ${chunk.length} transcripts, ~${chunkTokens} tokens`);
        });

        let potentialSegments = [];
        
        for (let i = 0; i < transcriptChunks.length; i++) {
            const chunk = transcriptChunks[i];
            const isFirstChunk = i === 0;
            const isLastChunk = i === transcriptChunks.length - 1;
            
            const messages = [
                {
                    role: "system",
                    content: "You are a precise transcript processor and master storyteller with an emphasis on narrative cohesion and accuracy. When generating clips, you must maintain the exact wording from the source material while creating a compelling narrative flow. Never modify, paraphrase, or correct the original transcript text. Your task is to identify the most meaningful segments across transcripts and weave them into a coherent story. Produce only valid JSON arrays with accurate numeric values and exact transcript quotes. Accuracy and fidelity to the original content remain your highest priority while creating an engaging storyline."
                }
            ];
            
            if (potentialSegments.length > 0 && !isFirstChunk) {
                messages.push({
                    role: "user",
                    content: `Important segments identified from previous chunks (for reference only):\n${JSON.stringify(potentialSegments, null, 2)}`
                });
                
                messages.push({
                    role: "assistant",
                    content: "I've noted these important segments from previous chunks and will consider them as I analyze the next chunk."
                });
            }
            
            let chunkPrompt;
            
            if (!isLastChunk) {
                chunkPrompt = `
USER CONTEXT: ${customPrompt || "Generate engaging clips from the transcript with accurate timestamps."}

TASK: This is chunk ${i+1} of ${transcriptChunks.length} of transcript data. 

Please analyze these transcripts and identify the most important 5-10 segments that could be part of a cohesive narrative. For each segment, provide:
1. The videoId
2. The exact transcript text (do not modify it)
3. The start and end times

Return the segments as a JSON array in this format:
[
  {
    "videoId": "string",
    "transcriptText": "exact quote from transcript",
    "startTime": number,
    "endTime": number,
    "notes": "brief explanation of why this segment is important to the narrative"
  }
]

Transcript Chunk ${i+1}/${transcriptChunks.length}:
${JSON.stringify(chunk, null, 2)}`;
            } else {
                chunkPrompt = `
USER CONTEXT: ${customPrompt || "Generate engaging clips from the transcript with accurate timestamps."}

TASK: This is the final chunk (${i+1} of ${transcriptChunks.length}) of transcript data.

Now that you have analyzed all chunks of transcript data, please create a cohesive narrative story by selecting and combining the most meaningful segments from ALL chunks, including those from previous important segments list and this final chunk.

IMPORTANT: Return ONLY a valid JSON array with the final clip selections. All numbers should be fixed to 2 decimal places. DO NOT use JavaScript expressions or functions.

OUTPUT FORMAT:
[
  {
    "videoId": "string",
    "transcriptText": "exact quote from transcript - do not modify or paraphrase",
    "startTime": number (add buffer of -2.00 if start > 2.00),
    "endTime": number (add buffer of +2.00)
  }
]

RULES:
1. TIMESTAMPS:
   - Use exact numbers with 2 decimal places
   - Add 2.00 second buffer at start (if start > 2.00)
   - Add 2.00 second buffer at end
   - Minimum 0.50 second gap between clips
   - Duration: 3.00-60.00 seconds
   - No overlapping segments, if a clip has 6.00 to 10.00, the other clip shouldn't starting time 6.00 to 10.00 !important

2. CONTENT ACCURACY:
   - Use EXACT quotes from transcripts without modification
   - Never paraphrase or reword the transcript content
   - Retain all verbal nuances from the original
   - Include complete sentences with their full context
   - Maintain perfect accuracy of the spoken content

3. NARRATIVE STORYTELLING:
   - Build a coherent story with a beginning, middle, and end
   - Select segments that connect logically and thematically
   - Create smooth transitions between different transcript segments
   - Ensure the assembled clips tell a compelling, unified story
   - Identify and highlight key narrative elements across transcripts

4. SELECTION CRITERIA:
   - Maintain narrative flow and story progression
   - Focus on relevant, meaningful content
   - Remove filler content and digressions
   - Prioritize clarity and articulation
   - Select segments with clear speech and minimal background noise
   - Choose segments that contribute meaningfully to the story arc

Here are the important segments from previous chunks:
${JSON.stringify(potentialSegments, null, 2)}

Current (final) chunk data:
${JSON.stringify(chunk, null, 2)}

Remember: Return ONLY a valid JSON array with proper numeric values (no expressions). While creating a compelling narrative is important, transcript accuracy is still the highest priority.`;
            }

            const promptTokens = countTokens(chunkPrompt);
            console.log(`Chunk ${i+1} prompt: ~${promptTokens} tokens`);

            messages.push({
                role: "user",
                content: chunkPrompt
            });

            console.log(`Processing chunk ${i+1}/${transcriptChunks.length}...`);
            
            try {
                const responseContent = await callGeminiWithRetry(
                    messages,
                    "gemini-1.5-pro-latest",
                    0.2
                );

                if (isLastChunk) {
                    console.log("Final response received from Gemini");

                    let jsonMatch;
                    try {
                        jsonMatch = responseContent.match(/\[\s*\{.*\}\s*\]/s);
                        const jsonContent = jsonMatch ? jsonMatch[0] : responseContent;
                        
                        JSON.parse(jsonContent);
                        
                        return res.status(200).json({
                            success: true,
                            data: {
                                script: jsonContent
                            },
                            message: "Video script generated successfully"
                        });
                    } catch (jsonError) {
                        console.error("Invalid JSON response from Gemini:", responseContent);
                        return res.status(500).json({
                            success: false,
                            message: "Failed to generate valid JSON response",
                            error: jsonError.message
                        });
                    }
                } else {
                    try {
                        const jsonMatch = responseContent.match(/\[\s*\{.*\}\s*\]/s);
                        if (jsonMatch) {
                            const segmentsFromChunk = JSON.parse(jsonMatch[0]);
                            potentialSegments = [...potentialSegments, ...segmentsFromChunk].slice(-30);
                            console.log(`Added ${segmentsFromChunk.length} potential segments from chunk ${i+1}`);
                        } else {
                            console.warn(`No valid JSON segments found in response for chunk ${i+1}`);
                        }
                    } catch (error) {
                        console.warn(`Error parsing segments from chunk ${i+1}: ${error.message}`);
                    }
                    
                    console.log(`Chunk ${i+1} processed successfully`);
                }
                
            } catch (error) {
                console.error(`Error processing chunk ${i+1}:`, error);
                
                return res.status(500).json({
                    success: false,
                    message: error.message || "Failed to generate video script",
                    error: error.message
                });
            }
        }
    } catch (error) {
        console.error("General error in generateClips:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to generate video script",
            error: error.message
        });
    }
};

module.exports = generateClips;