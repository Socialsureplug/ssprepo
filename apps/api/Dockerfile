FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @app/api --include-workspace-root=false --omit=dev || npm ci --workspace @app/api
COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=production
USER node
EXPOSE 4000
HEALTHCHECK CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
