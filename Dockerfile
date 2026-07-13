FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app

# Infisical CLI: lets the container pull runtime secrets (e.g.
# CLERK_SECRET_KEY) at startup instead of having them set manually in Dokploy.
# See docker-entrypoint.sh for how it's invoked.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl gnupg ca-certificates \
	&& curl -1sLf 'https://artifacts-cli.infisical.com/setup.deb.sh' | bash \
	&& apt-get update && apt-get install -y infisical \
	&& rm -rf /var/lib/apt/lists/*

COPY .output ./.output
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
