import { createFileRoute } from '@tanstack/react-router';
import { getSignUpUrl } from '@workos/authkit-tanstack-react-start';

export const Route = createFileRoute('/api/auth/signup')({
  server: {
    handlers: {
      GET: async () => {
        const signUpUrl = await getSignUpUrl();
        return new Response(null, {
          status: 302,
          headers: {
            Location: signUpUrl,
          },
        });
      },
    },
  },
});
