import { createFileRoute } from '@tanstack/react-router';
import { signOut } from '@workos/authkit-tanstack-react-start';

export const Route = createFileRoute('/api/auth/signout')({
  server: {
    handlers: {
      GET: async () => {
        await signOut();
        // signOut() should redirect, but if it doesn't, redirect to home
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/',
          },
        });
      },
    },
  },
});
