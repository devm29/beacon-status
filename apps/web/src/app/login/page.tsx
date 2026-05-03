import { RadioTower } from "lucide-react";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-md">
            <RadioTower className="size-6" strokeWidth={1.75} aria-hidden />
          </span>
          <h1 className="text-[28px] leading-[34px] font-semibold tracking-tight">Sign in to Beacon</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">Use an API key for your organization.</p>
        </div>
        <SignInForm />
        {process.env.NODE_ENV !== "production" && (
          <p className="mt-6 text-center text-[12px] text-muted-foreground">
            Running the demo? The seeded key is{" "}
            <code className="font-mono">bk_demo_acme_local_development_key</code>.
          </p>
        )}
      </div>
    </main>
  );
}
