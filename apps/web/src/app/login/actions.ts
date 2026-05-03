"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { API_KEY_COOKIE, ApiError, SIGNED_OUT_COOKIE } from "@/lib/api";
import { getMe } from "@/lib/queries";

export interface SignInState {
  error: string | null;
}

const KeySchema = z.string().trim().min(10, "Paste the full API key, it starts with bk_");

export async function signIn(_previous: SignInState, form: FormData): Promise<SignInState> {
  const parsed = KeySchema.safeParse(form.get("apiKey"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter an API key" };
  try {
    await getMe(parsed.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      return { error: "That key was not accepted. Check it and try again." };
    return { error: "Beacon's API is not reachable right now. Try again in a moment." };
  }
  const jar = await cookies();
  jar.set(API_KEY_COOKIE, parsed.data, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  jar.delete(SIGNED_OUT_COOKIE);
  redirect("/");
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(API_KEY_COOKIE);
  jar.set(SIGNED_OUT_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/login");
}
