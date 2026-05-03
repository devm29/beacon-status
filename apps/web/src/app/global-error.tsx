"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100dvh",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 17, fontWeight: 600 }}>Something went wrong</h1>
          <button type="button" onClick={reset} style={{ marginTop: 16 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
