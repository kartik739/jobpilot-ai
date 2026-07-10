FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Standalone output layout:
#   .next/standalone/ — minimal server bundle (includes node_modules subset)
#   public/           — static assets served by Next.js
#   .next/static/     — hashed client chunks

# Reorganise for runtime
RUN cp -r .next/standalone/. . && \
    cp -r public .next/standalone/public && \
    cp -r .next/static .next/standalone/.next/static

EXPOSE 3000
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
