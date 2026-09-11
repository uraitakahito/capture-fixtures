# capture-fixtures — fixture-origin container.
# Multi-stage: build TypeScript in a full image, ship only prod deps + dist + site.

FROM node:26-bookworm-slim AS build
WORKDIR /app
# node:26 no longer ships corepack — it was unbundled from Node in 25, so the
# image has neither corepack nor pnpm. Installing it rather than merely
# enabling it: corepack is what reads `packageManager` from package.json and
# checks its sha512, which installing pnpm directly would skip.
RUN npm i -g corepack@0.35.0 && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts

# The fingerprint /__version reports. The build context has no .git
# (.dockerignore), so generate-version.mjs reads these rather than asking git.
# Left unset the image reports version=unknown revision=dev — itself a useful
# signal: it was baked without recording what it was baked from.
ARG GIT_TAG=
ENV GIT_TAG=$GIT_TAG
ARG GIT_REV=dev
ENV GIT_REV=$GIT_REV

# `prebuild` runs generate-version.mjs off the two ARGs above. pnpm skips
# pre/post scripts unless told otherwise, so this only works because
# pnpm-workspace.yaml sets enablePrePostScripts — and it fails in two different
# ways depending on the tree. Here, where the context carries no
# src/generated/, tsc stops with TS2307; in a working copy that already has one
# the build succeeds and bakes in a stale revision.
RUN pnpm run build

# The production tree, built in a stage of its own from nothing.
#
# Not `pnpm deploy`, which BrowserHive uses: that selects a project out of a
# workspace, and capture-fixtures's pnpm-workspace.yaml declares no packages — it exists
# only for allowBuilds and enablePrePostScripts, so `deploy` stops with
# ERR_PNPM_NOTHING_TO_DEPLOY.
#
# Nor `pnpm install --prod` on top of the build stage: pruning rewrites a
# node_modules holding the whole dev tree, and committing that layer wedged
# capping's builder for twenty minutes with the install itself reporting
# "Done in 267ms". Installing into an empty stage writes the two runtime
# packages and nothing else.
#
# --node-linker=hoisted gives the runtime stage a flat tree of real directories.
#
# The sibling repositories justify this flag by saying pnpm's default layout
# symlinks into a store the runtime stage will not have. That is not what
# happens: the links are relative and point at node_modules/.pnpm/, which is
# inside the directory being copied, so the store is only needed at install
# time. Measured, not assumed — an image built without the flag starts and
# answers /health, and the two trees differ by 8 files and 1 MB.
#
# It is kept because a runtime image should not depend on symlinks surviving
# `COPY --from`, image export and a registry round trip intact, and because a
# flat node_modules is what anything inspecting the shipped image will expect.
# Not because the default would break here.
FROM node:26-bookworm-slim AS deps
WORKDIR /deps
RUN npm i -g corepack@0.35.0 && corepack enable  # 上と同じ理由
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --node-linker=hoisted

FROM node:26-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /deps/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY site ./site
# Served on 0.0.0.0:8080 so a worker's Chrome (another VM) reaches it by IP.
EXPOSE 8080
CMD ["node", "dist/serve.js"]
