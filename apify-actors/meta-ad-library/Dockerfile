# Mirrors boxly_reddit_actor: the Apify Playwright+Chromium base image already
# bundles a matching Playwright + Chromium, so we never install browsers here.
FROM apify/actor-node-playwright-chrome:20

COPY package.json ./

RUN npm --quiet set progress=false \
 && npm install --omit=dev --omit=optional \
 && echo "Installed NPM packages:" \
 && (npm list --omit=dev --all || true)

COPY . ./

CMD npm start
