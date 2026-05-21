FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app

COPY .output ./.output

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
