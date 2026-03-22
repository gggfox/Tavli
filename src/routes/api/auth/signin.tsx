import { createFileRoute } from '@tanstack/react-router';
import { getSignInUrl } from '@workos/authkit-tanstack-react-start';

export const Route = createFileRoute('/api/auth/signin')({
  server: {
    handlers: {
      GET: async () => {
        const signInUrl = await getSignInUrl();
        return new Response(null, {
          status: 302,
          headers: {
            Location: signInUrl,
          },
        });
      },
    },
  },
});

