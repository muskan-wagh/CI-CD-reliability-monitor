import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto block h-3 w-3 bg-[var(--primary)]" />
          <p className="technical mt-5 text-sm font-bold tracking-[0.16em]">ECHO</p>
          <h1 className="mt-4 text-2xl font-semibold">Create your Echo account.</h1>
        </div>
        <SignUp />
      </div>
    </main>
  );
}
