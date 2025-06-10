FROM node:22

# Install system dependencies including FFmpeg
RUN apt-get update && \
    apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Create directories with correct permissions
RUN mkdir -p /app/backend/uploads /app/uploads /app/tmp /app/output && \
    chown -R node:node /app/backend/uploads /app/uploads /app/tmp /app/output

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json .

# Install dependencies as node user, including ffmpeg-static locally
USER node
RUN npm install && \
    npm install ffmpeg-static

# Copy application code
COPY . .

# Set environment variables
ENV UPLOADS_DIR=/app/backend/uploads
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV TEMP_DIR=/app/tmp
ENV OUTPUT_DIR=/app/output

EXPOSE 4001

CMD ["npm", "start"]