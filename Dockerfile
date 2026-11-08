# Node runtime for Cloud Run (or any container host). Serves build/node.js on $PORT.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
# Includes optionalDependencies (Firestore, KMS) for the gcloud option.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY public ./public
USER node
EXPOSE 8080
CMD ["node", "build/node.js"]
