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

# Create app directory and set permissions properly from the start
WORKDIR /app
RUN mkdir -p uploads tmp output && \
    chown -R node:node /app

# Copy package files first for better caching
COPY --chown=node:node package*.json ./

# Switch to node user for npm install
USER node

# Install app dependencies
RUN npm install

# Copy app source with correct permissions
COPY --chown=node:node . .

# Environment variables for configuration
ENV UPLOADS_DIR=/app/uploads \
    TEMP_DIR=/app/tmp \
    OUTPUT_DIR=/app/output \
    NODE_ENV=production

EXPOSE 4001

CMD ["npm", "start"]