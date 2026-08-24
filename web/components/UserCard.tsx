"use client";

import { SignOutButton, UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";

/**
 * Sidebar account card: real Clerk session data with the account menu
 * (profile management + sign out) attached to the avatar.
 */
export default function UserCard() {
  const { isLoaded, isSignedIn, user } = useUser();

  if (!isLoaded) {
    return (
      <div className="user-card flex items-center gap-3 rounded-md border px-3 py-3">
        <span className="avatar bg-[var(--subtle)]" />
        <span className="min-w-0 flex-1" />
      </div>
    );
  }
  if (!isSignedIn || !user) return null;

  const name = user.fullName ?? user.username ?? "Signed in";
  const email = user.primaryEmailAddress?.emailAddress ?? "";

  return (
    <>
      <div className="user-card flex items-center gap-3 rounded-md border px-3 py-3">
        <UserButton
          appearance={{
            elements: {
              avatarBox: "h-8 w-8",
            },
          }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{name}</span>
          {email && (
            <span className="technical mt-1 block truncate text-[9px] text-[var(--muted-foreground)]">
              {email}
            </span>
          )}
        </span>
      </div>
      <SignOutButton>
        <Link
          href="/"
          className="mt-2 block px-3 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          Sign out
        </Link>
      </SignOutButton>
    </>
  );
}

/** Compact avatar-only account button for the top bar. */
export function TopbarUserButton() {
  return (
    <div className="flex items-center" aria-label="Account menu">
      <UserButton
        appearance={{
          elements: {
            avatarBox: "h-7 w-7",
          },
        }}
      />
    </div>
  );
}
