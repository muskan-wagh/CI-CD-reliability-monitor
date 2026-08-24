# Echo — dashboard

Next.js (App Router) frontend for Echo. Every failure leaves a signal.

```bash
npm run dev      # development server
npm run build    # production build
npm run lint     # eslint
```

Requires `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in
`.env.local` (Clerk authentication), plus `API_URL` pointing at the Echo API.
