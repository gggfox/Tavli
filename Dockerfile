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

# Hit the app's /health route (curl is already installed above and kept in the
# image). --start-period gives Nitro time to boot before failures count; a
# failing healthcheck marks the container unhealthy so a bad redeploy is a
# signal instead of a silent 502.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
	CMD curl -fsS http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
