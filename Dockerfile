FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8790

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund --registry=https://registry.npmjs.org

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY contract ./contract
COPY dist ./dist

EXPOSE 8790

CMD ["npx", "--no-install", "tsx", "src/server/node.ts"]
