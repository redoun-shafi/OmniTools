# OmniTools

Where Everyday Tools Become Superpowers.

OmniTools is a responsive personal toolbox built with HTML, CSS, and JavaScript. It is designed for GitHub Pages now and can grow into a Firebase-backed productivity platform later.

## Included tools

- Recipe Index Generator: search, filter, add, shuffle, and export recipes.
- DOCX to XLSX: convert recipe documents, match images, embed them in workbooks, and download ZIP files.
- Flow Automator: a Chrome extension for prompt queues and Google Labs Flow automation.

## Run locally

Open `index.html` in a browser, or serve the folder with any static file server. The browser-based tools process files locally. The Flow Automator remains a Chrome extension and is not executed by the website.

## GitHub Pages

1. Create a GitHub repository for this folder.
2. Push the project files to the `main` branch.
3. Open repository Settings, then Pages.
4. Set the source to **GitHub Actions**.
5. Open the generated Pages URL after the workflow completes.

The included `.github/workflows/pages.yml` deploys the static site automatically whenever changes reach `main`.

All website links use relative paths so the project works on a repository Pages URL as well as a custom domain.

## Future Firebase integration

The current version intentionally has no authentication or backend. Firebase Authentication can later provide email/password accounts, while Firestore can store user settings, favorites, recent tools, and subscriptions by Firebase `uid`. Passwords should never be stored manually in this project.
