# Smart Examination Section — single container serving the API and the built SPA from one origin.
# Same-origin is deliberate: no CORS, and the SameSite=Lax session cookie works unchanged.

# ---------------------------------------------------------------- build stage
FROM node:22-slim AS build
WORKDIR /app

# devDependencies (vite, tsc, tailwind) are required to build, so NODE_ENV stays unset here
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

# ---------------------------------------------------------------- run stage
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The server runs TypeScript directly through tsx (a runtime dependency), so ship the sources.
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared

# Hosts override this; 3001 matches the local default.
ENV PORT=3001
EXPOSE 3001

# Not `npm start`: that uses cross-env, which is a devDependency and absent from this image.
CMD ["npm", "run", "start:server"]
