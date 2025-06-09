FROM node:22

# Install system dependencies including build tools for native modules
RUN apt-get update && \
    apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    wget \
    build-essential && \
    rm -rf /var/lib/apt/lists/*

# Create app directory structure
WORKDIR /app
RUN mkdir -p /app/uploads /app/tmp /app/output && \
    chown -R node:node /app

# Copy package files first for better caching
COPY --chown=node:node package*.json ./

# Install dependencies with proper build support
USER node
RUN npm install && \
    npm rebuild bcrypt --update-binary

# Alternative if you still need to skip some postinstall scripts:
# RUN npm install --ignore-scripts && \
#     npm rebuild bcrypt youtube-dl-exec --update-binary

# Copy application files
COPY --chown=node:node . .

# Environment variables
ENV UPLOADS_DIR=/app/uploads \
    TEMP_DIR=/app/tmp \
    OUTPUT_DIR=/app/output \
    NODE_ENV=production

EXPOSE 4001

CMD ["npm", "start"]