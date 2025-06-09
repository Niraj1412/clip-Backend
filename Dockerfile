FROM node:22

# Install system dependencies including FFmpeg
RUN apt-get update && \
    apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Install ffmpeg-static for fallback
RUN npm install -g ffmpeg-static

WORKDIR /app

# Create necessary directories with proper permissions
RUN mkdir -p /app/uploads && \
    mkdir -p /app/tmp && \
    mkdir -p /app/output

# Copy package files first (better caching)
COPY package*.json . 

# Install dependencies as root (needed for node_modules)
RUN npm install

# Now switch to non-root user for security
USER node

# Copy application files with correct permissions
COPY --chown=node:node . .

# Environment variables for configuration
ENV UPLOADS_DIR=/app/uploads \
    TEMP_DIR=/app/tmp \
    OUTPUT_DIR=/app/output \
    NODE_ENV=production

# Ensure the node user has write access to needed directories
RUN chown -R node:node /app/uploads && \
    chown -R node:node /app/tmp && \
    chown -R node:node /app/output

EXPOSE 4001

CMD ["npm", "start"]