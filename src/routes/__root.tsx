import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-display font-bold text-hud hud-glow">404</h1>
        <h2 className="mt-4 text-xl font-display text-foreground">Lost in space</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This sector of the galaxy doesn't exist on any star chart.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-hud bg-transparent px-4 py-2 text-sm font-display text-hud transition-colors hover:bg-hud hover:text-background"
          >
            Return to base
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Cosmic Drift — First-Person Space Explorer" },
      { name: "description", content: "Pilot a starship through a procedurally generated galaxy. Discover planets, jump to lightspeed, and chart the cosmos." },
      { name: "author", content: "Cosmic Drift" },
      { property: "og:title", content: "Cosmic Drift — First-Person Space Explorer" },
      { property: "og:description", content: "Pilot a starship through a procedurally generated galaxy." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Inter:wght@300;400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
