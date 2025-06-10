FROM node:22

# Install system dependencies including FFmpeg
RUN apt-get update && \
    apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Create necessary directories
RUN mkdir -p /app/backend/uploads && \
    mkdir -p /app/uploads && \
    mkdir -p /app/tmp && \
    mkdir -p /app/output

# Install ffmpeg-static for fallback
RUN npm install -g ffmpeg-static

WORKDIR /app

COPY package*.json . 

RUN npm install 

COPY . .

# Set environment variables
ENV UPLOADS_DIR=/app/backend/uploads
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV TEMP_DIR=/app/tmp
ENV OUTPUT_DIR=/app/output

EXPOSE 4001

CMD ["npm", "start"]