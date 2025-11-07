# 🌐 public.monster 🌐

**Remember when the web was fun?**

Back in the 90s, you could just drop some HTML files in your `~/public_html` folder and BAM — your site was live for the whole world to see. No build steps. No frameworks. No deployment pipelines. Just pure, unfiltered creativity.

**We want that feeling back.**

## What is this?

`public.monster` brings back the magic of `~/public_html` hosting for a new generation of web artists.

- 🎨 Upload your HTML, CSS, images — whatever
- 🚀 Your site goes live instantly at `public.monster/~yourusername`
- 🔐 Passwordless auth (because it's 2025, not 1995)
- 💾 Recursive folder uploads (drag your whole site)
- ✨ That sweet, sweet 90s aesthetic

## The Vibe

- Teal backgrounds ✓
- Comic Sans ✓  
- Outset borders ✓
- Blinking text ✓
- Your personal corner of the web ✓

## How it works

1. **Sign up** — Enter your email, get a magic link (no passwords!)
2. **Upload** — Drag files or folders
3. **Share** — Your site is live at `/~yourusername`

That's it. No webpack. No npm install. No "building for production."

Just HTML. Just vibes.

## Tech Stack (for the nerds)

- **Runtime:** Bun
- **Auth:** Hanko (passwordless)
- **Storage:** Local filesystem (or Bunny Storage for prod)
- **Hosting:** Bunny.net edge containers
- **Lines of code:** ~250 (we keep it simple)

## Run Locally

```bash
git clone https://github.com/dmytri/public-monster.git
cd public-monster
bun install
bun test
bun server.ts
```

Visit `http://localhost:3000` and start uploading!

## Deploy

```bash
# Set your env vars
export HANKO_API_URL=https://your-project.hanko.io
export DOCKERHUB_USERNAME=yourname
export DOCKERHUB_TOKEN=xxx
export BUNNY_API_KEY=xxx

# Deploy
ansible-playbook deploy.yml
```

## Philosophy

> "The web was built by amateurs. That's what made it great."

We believe:
- The web should be **fun** again
- Hosting should be **simple**
- Everyone deserves their own **corner of the internet**
- Comic Sans is **underrated**

## Credits

Built with ❤️ by [dmytri.to](https://dmytri.to)

Inspired by GeoCities, Angelfire, and the wild west web of the 90s.

---

**Now go make something weird.**
