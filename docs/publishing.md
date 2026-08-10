# Publishing guide (maintainers)

Short notes on the parts of this repository that are wired up but not yet switched on.

## Placeholders to replace

Two placeholder tokens are intentionally left in the docs. Grep for them before announcing the
project anywhere:

| Token | Where it appears | Replace with |
|---|---|---|
| `TODO-bmc-user` | `README.md`, `README.es.md` | Your Buy Me a Coffee username |
| `TODO-dockerhub-user` | `README.md`, `README.es.md` | Your Docker Hub username |

```bash
grep -rn "TODO-bmc-user\|TODO-dockerhub-user" README.md README.es.md docs/
```

## Buy Me a Coffee

1. Create the page at <https://buymeacoffee.com> and note your username (the last segment of
   `buymeacoffee.com/<username>`).
2. Replace every occurrence of `TODO-bmc-user` in `README.md` and `README.es.md` — it appears in
   the badge link at the top and in the *Support* / *Apoyar el proyecto* section at the bottom.

If you would rather drop the section entirely, delete the badge line and the Support section from
both READMEs — nothing else references it.

## Docker Hub publishing

`.github/workflows/docker.yml` builds and pushes `docker.io/<DOCKERHUB_USERNAME>/roganizo` on
every push to `main` (tag `latest`) and on every `v*` git tag (semver tags via
`docker/metadata-action`). The **entire job is gated** on `vars.DOCKERHUB_USERNAME != ''`, so
until you configure it the workflow runs and does nothing — no red X, no noise.

To activate it:

1. Create a Docker Hub account at <https://hub.docker.com> if you do not have one.
2. Create the repository `roganizo` under your account (or let the first push create it — a
   public repo is created automatically on push).
3. Generate an access token: **Account Settings → Personal access tokens → Generate new token**,
   with **Read & Write** permissions. Copy it; it is shown only once.
4. In this GitHub repository, go to **Settings → Secrets and variables → Actions**:
   - tab **Variables** → *New repository variable* → name `DOCKERHUB_USERNAME`, value your
     Docker Hub username.
   - tab **Secrets** → *New repository secret* → name `DOCKERHUB_TOKEN`, value the access token.
5. Push to `main` (or run the workflow manually) and check the run under **Actions**.
6. Update the README:
   - swap the placeholder Docker badge for the real one — the replacement is already written out
     in an HTML comment right below it, just substitute `TODO-dockerhub-user`;
   - in the *Quickstart* section, promote the commented-out `docker pull TODO-dockerhub-user/roganizo`
     line into a real code block and drop the "coming soon" paragraph.

   Do this in **both** `README.md` and `README.es.md`.

Releases: tag with `git tag v0.2.0 && git push --tags` to publish version-tagged images
(`0.2.0`, `0.2`) alongside `latest`.

## GitHub Pages demo

`.github/workflows/pages.yml` runs on every push to `main`:

1. Checkout, pnpm 11 (matching the Dockerfile and the `allowBuilds` field in
   `pnpm-workspace.yaml`), Node 22 with the pnpm cache.
2. `pnpm install --frozen-lockfile` — the whole workspace, so the lockfile stays authoritative.
3. `VITE_DEMO=1 pnpm --filter @roganizo/web build` — `VITE_DEMO=1` sets the Vite `base` to
   `/roganizo/` and makes the SPA run against fictional in-memory data with no backend.
4. `peaceiris/actions-gh-pages@v4` force-pushes `apps/web/dist` to the existing **`gh-pages`**
   branch using the automatic `GITHUB_TOKEN`.

Pages is configured to serve from the `gh-pages` branch (**Settings → Pages → Source: Deploy
from a branch**), so no change is needed there. The published site is
<https://uncheck4164.github.io/roganizo/>.

Notes:

- The workflow needs `permissions: contents: write` to push the branch — that is already set.
- If `gh-pages` is ever deleted, the action recreates it on the next run; just re-select it as
  the Pages source afterwards.
- Never commit real data into the demo: the demo dataset must stay fictional, since the site is
  public and unauthenticated.
