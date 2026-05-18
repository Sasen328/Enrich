# Deploy ProspectSA — for non-technical operators

This guide assumes **zero coding experience**. Anyone who can install software and copy/paste commands can do it. By the end you'll have ProspectSA running on your own machine, then optionally on a server with a public web address.

If anything breaks, just send the error message back — I'll guide you through the fix.

---

## Part A · Run it on your own laptop (≈ 30 minutes)

### Step 1 · Install Docker Desktop

Docker is the program that runs ProspectSA in a "sandbox" so you don't have to install Node, PostgreSQL, Python, etc. separately.

- Go to https://www.docker.com/products/docker-desktop
- Download for **Mac** or **Windows** (pick the one that matches your laptop)
- Open the installer file and follow its prompts (defaults are fine)
- After install, **open Docker Desktop** (look for the whale icon). You'll see a whale icon in your menu bar / system tray when it's running.

Verify it works: open **Terminal** (Mac) or **PowerShell** (Windows) and paste:

```
docker --version
```

You should see something like `Docker version 27.x`. If you do, Docker is ready. If you see "command not found", restart your computer and try again.

### Step 2 · Get the ProspectSA code onto your laptop

You need [Git](https://git-scm.com/downloads) installed. Install it the same way as Docker if you don't have it (defaults are fine).

Then in Terminal / PowerShell:

```
cd Desktop
git clone https://github.com/Sasen328/ProspectSA_Full.git
cd ProspectSA_Full
```

That puts a folder called `ProspectSA_Full` on your Desktop and moves you inside it.

### Step 3 · Make your `.env` file (this is where your API keys live)

```
cp .env.docker .env
```

(On Windows PowerShell, use `copy .env.docker .env` instead.)

Now open the `.env` file in any text editor (TextEdit on Mac, Notepad on Windows, or VS Code). Paste your real keys into the placeholders. **At minimum you need ONE LLM key** — Anthropic, OpenAI, or OpenRouter. The cheapest option is to use OpenRouter with the free-models flag turned on:

```
OPENROUTER_API_KEY=sk-or-v1-...
NEXUS_PREFER_FREE_MODELS=true
TAVILY_API_KEY=tvly-dev-...        # optional but recommended
ANTHROPIC_API_KEY=sk-ant-...       # optional
OPENAI_API_KEY=sk-proj-...         # optional
```

Save the file.

> **How to get the keys (all free to sign up):**
> - OpenRouter: https://openrouter.ai/keys
> - Tavily: https://tavily.com (1000 free queries per month on the dev tier)
> - Anthropic Claude: https://console.anthropic.com
> - OpenAI: https://platform.openai.com/api-keys

### Step 4 · Start the app

In Terminal / PowerShell, from inside the `ProspectSA_Full` folder:

```
docker compose up --build
```

The **first time** this takes 5–10 minutes because Docker downloads everything. You'll see a lot of text scrolling. That's normal.

You'll know it's ready when you see lines like:

```
[db]  PostgreSQL ready to accept connections
[app] Server listening on port 3000
```

### Step 5 · Open it in your browser

Open any browser and go to:

```
http://localhost:3000
```

That's it. ProspectSA is running on your laptop.

### Step 6 · Stop / start later

To stop the app: in Terminal, press **Ctrl + C** (or **Cmd + C** on Mac).

To start it again later (much faster — no rebuild needed):

```
cd ~/Desktop/ProspectSA_Full
docker compose up
```

To completely shut down and free memory:

```
docker compose down
```

Your data is saved between restarts. To wipe everything and start fresh:

```
docker compose down -v
```

---

## Part B · Give it a permanent web address (so you can show others)

Two paths. Path B1 is fastest (free, temporary URL). Path B2 is the real "production" setup on a free always-on server.

### B1 · Free quick-share URL via Cloudflare Tunnel (≈ 5 minutes)

This gives you a public URL like `https://abc-random-words.trycloudflare.com` that anyone can open — as long as your laptop stays on and `docker compose` is still running.

1. Download Cloudflare's tunnel tool: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/  
   Pick "cloudflared" for your operating system. On Mac use `brew install cloudflared` if you have Homebrew.

2. **Keep `docker compose up` running** in your first Terminal.

3. Open a **second** Terminal window and run:

```
cloudflared tunnel --url http://localhost:3000
```

4. It will print a URL — `https://something-random.trycloudflare.com`. Share that URL with anyone. They can open ProspectSA in their browser, even from another country.

5. To stop sharing: press **Ctrl + C** in the second Terminal. The temporary URL dies.

### B2 · Real always-on server (free, with Oracle Cloud) — ≈ 1 hour first time

This puts the app on a small computer "in the cloud" that runs 24/7. Even when your laptop is off, ProspectSA stays online. Oracle Cloud has a **permanently free** tier that's big enough for this.

**Step-by-step:**

1. **Sign up for Oracle Cloud Free Tier** at https://www.oracle.com/cloud/free/  
   You need a credit card for identity verification, but they don't charge it.

2. After signing up, go to **Compute → Instances → Create instance**.

3. Choose these options:
   - **Image:** Ubuntu 22.04
   - **Shape:** "Ampere" → `VM.Standard.A1.Flex` → set **OCPUs = 4** and **Memory = 24 GB**. This is the "Always Free" ARM machine — it's huge for a free tier.
   - **Networking:** keep defaults; tick "Assign a public IPv4 address".
   - **SSH keys:** click "Generate a key pair for me" and **download both files**. Keep them safe — these are your laptop's password to log into the server.

4. Click **Create**. Wait 2 minutes; status goes from "Provisioning" to "Running". Copy the **Public IP Address** that appears (e.g. `129.213.45.67`).

5. **Connect to your new server.** On Mac/Linux:

```
chmod 600 ~/Downloads/ssh-key-<date>.key
ssh -i ~/Downloads/ssh-key-<date>.key ubuntu@<your-server-ip>
```

   On Windows, install **PuTTY** (free): https://www.putty.org/ and load the `.ppk` key. There's a 5-min PuTTY guide on https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/accessinginstance.htm

6. **Once you're SSH'd in, install Docker on the server** (paste these commands one by one):

```
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu
```

   **Log out and back in** so the docker permission takes effect:

```
exit
```

   Then SSH in again with the same command from Step 5.

7. **Open the firewall** so the world can reach port 3000:

```
sudo ufw allow 3000/tcp
sudo ufw allow 22/tcp
sudo ufw --force enable
```

   Also in the Oracle web console: go to your VCN → Security Lists → Default Security List → Add Ingress Rule: source `0.0.0.0/0`, destination port `3000`, TCP. Save.

8. **Clone the repo and start ProspectSA on the server:**

```
git clone https://github.com/Sasen328/ProspectSA_Full.git
cd ProspectSA_Full
cp .env.docker .env
nano .env
```

   In `nano`, paste your API keys (same ones from Part A · Step 3). Press **Ctrl + O** then **Enter** to save, then **Ctrl + X** to exit.

9. **Build and start:**

```
docker compose up -d --build
```

   The `-d` runs it in the background. First build takes 10–15 minutes on the free ARM tier.

10. **Open `http://<your-server-ip>:3000`** in any browser. Done — ProspectSA is now online 24/7.

11. **(Optional) Permanent domain name via Cloudflare Tunnel** — same as B1 but configured as a "named tunnel" so it runs as a service even after you log out:

```
sudo curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
cloudflared tunnel login                # opens browser, follow Cloudflare's prompts
cloudflared tunnel create prospectsa
cloudflared tunnel route dns prospectsa app.yourdomain.com
# create config file (see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/configuration-file/)
sudo cloudflared service install
```

   Or simpler — leave it on `http://<server-ip>:3000` for now.

---

## Part C · Common problems

| What you see | What to do |
|---|---|
| `docker: command not found` | Docker Desktop is not installed or not running. Open the Docker Desktop app and wait until the whale icon stops animating. |
| `port is already allocated` | Something else uses port 3000. Open `docker-compose.yml`, change `"3000:3000"` to `"4000:3000"`, then visit `http://localhost:4000` instead. |
| App opens but every page is blank / 401 errors | You set an `API_TOKEN` but the frontend doesn't know it. Either delete the `API_TOKEN=...` line from `.env` (dev only), or paste the same value into `artifacts/prospect-sa/.env.local` as `VITE_API_TOKEN=...` and rebuild. |
| `Lead Factory` works but returns nothing | Your LLM key is wrong or has no quota. Double-check it at the provider's dashboard. If you're using OpenRouter `:free` models, expect occasional rate-limit retries. |
| First sanctions scan is slow | Normal — it downloads OFAC + UN + EU sanctions lists on first call (~10s), then caches them for 24h. |
| Built but won't open in the browser | Wait another 30 seconds. The frontend takes time to compile on slower laptops. Then refresh `http://localhost:3000`. |
| Anything else | Copy the error message and paste it back to me; I'll walk you through it. |

---

## Part D · Updating the app later

When new changes land on `main`:

```
cd ~/Desktop/ProspectSA_Full       # or your server folder
git pull
docker compose up -d --build
```

That's the entire update flow.

---

## Part E · What it costs

| What | Cost |
|---|---|
| Docker | Free |
| Cloudflare Tunnel | Free |
| Oracle Cloud Always-Free VM | Free, forever, within the free-tier limits (4 ARM cores + 24 GB RAM is fine for ProspectSA) |
| Tavily search | Free (1000 queries/month dev tier) |
| OpenRouter `:free` LLM models | Free (rate-limited) |
| OpenAI / Anthropic / Gemini paid LLMs | Pay-as-you-go — only if you want premium quality |

If you only use OpenRouter + Tavily + Oracle Cloud, your **monthly cost is $0**.

---

## Final checklist

Before you call it deployed:

- [ ] `docker compose up` runs without errors
- [ ] `http://localhost:3000` (or your server IP) opens the dashboard
- [ ] You can run a Lead Factory job and see results
- [ ] If you set `API_TOKEN`, your frontend has `VITE_API_TOKEN` matching it
- [ ] If public: Cloudflare Tunnel or server IP opens from another device

You're done. Anything that breaks — send the message back to me.
