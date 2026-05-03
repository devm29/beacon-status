"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type SignInState } from "./actions";

const INITIAL: SignInState = { error: null };

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, INITIAL);
  return (
    <form action={action} className="grid gap-4 rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
      <div className="grid gap-1.5">
        <Label htmlFor="apiKey" className="text-[13px] font-medium">
          API key
        </Label>
        <Input
          id="apiKey"
          name="apiKey"
          type="password"
          autoComplete="off"
          placeholder="bk_…"
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "apiKey-error" : undefined}
        />
        {state.error ? (
          <p id="apiKey-error" role="alert" className="text-[12px] text-destructive">
            {state.error}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </Button>
    </form>
  );
}
