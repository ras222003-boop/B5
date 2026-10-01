FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.18.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
RUN pnpm rebuild esbuild @tailwindcss/oxide
COPY client ./client
COPY server ./server
COPY shared ./shared
COPY tsconfig.json tsconfig.node.json vite.config.ts ./

RUN pnpm build && pnpm prune --prod

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
