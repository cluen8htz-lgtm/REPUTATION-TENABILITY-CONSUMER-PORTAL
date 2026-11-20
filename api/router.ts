import { authRouter } from "./auth-router";
import { portalRouter } from "./portal-router";
import { fcbaRouter } from "./fcba-router";
import { repoRouter } from "./repo-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  portal: portalRouter,
  fcba: fcbaRouter, // Credit card billing error (FCBA/TILA)
  repo: repoRouter, // Self-help repossession (Article 9 + FDCPA + SEC)
});

export type AppRouter = typeof appRouter;
