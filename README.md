# public.monster

90s-style `~/public_html` hosting on bunny.net

## Setup

1. Create project at [hanko.io](https://hanko.io)
2. In Hanko settings, add `http://localhost:3000` to allowed origins
3. Copy your Hanko API URL
4. Set environment variables:

```bash
export HANKO_API_URL=https://your-project-id.hanko.io
export BUNNY_API_KEY=xxx
export BUNNY_STORAGE_URL=xxx
```

That's it - the server injects `HANKO_API_URL` into the HTML automatically.

## Deploy

```bash
ansible-playbook deploy.yml
```

## Local

```bash
bun install
bun test
bun server.ts
```

## Features

- Hanko authentication (passwordless)
- File/folder upload with progress
- Recursive directory structure
- `/~username` URLs
- Proper Content-Type headers
