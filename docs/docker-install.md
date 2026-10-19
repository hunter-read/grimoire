# Getting Started with Docker

This guide is for people who have never used Docker before. It will walk you through installing Docker and running Grimoire on your computer - no technical background required.

> **Note:** This guide sets up Grimoire for **local access only** - meaning you can use it from your own computer (and other devices on your home network). Making it accessible to friends outside your network requires additional steps such as port forwarding, a VPN, or a reverse proxy, which are outside the scope of this guide.

---

## What is Docker?

Docker is a tool that lets you run applications in a self-contained package called a **container**. You don't need to install Python, configure databases, or set up servers - Docker handles all of that for you. Installing Docker is the only technical step required to run Grimoire.

---

## Step 1 - Install Docker

Follow the instructions for your operating system below.

### Windows

1. Make sure you are running **Windows 10 (version 2004 or later)** or **Windows 11**.
2. Go to [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/) and click **Download for Windows**.
3. Run the installer (`Docker Desktop Installer.exe`) and follow the prompts. When asked, leave **Use WSL 2 instead of Hyper-V** checked (this is the recommended option).
4. Once installation finishes, restart your computer if prompted.
5. Open **Docker Desktop** from the Start menu. The first launch may take a minute or two. You will see a whale icon in your system tray when Docker is running.

> If you see a message about enabling virtualization, you may need to enable it in your BIOS/UEFI settings. Search for your computer model + "enable virtualization" for instructions specific to your hardware.

### macOS

1. Go to [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/) and click **Download for Mac**.
 - If your Mac has an **Apple Silicon chip** (M1, M2, M3, or M4), choose **Mac with Apple Silicon**.
 - If your Mac has an **Intel chip**, choose **Mac with Intel Chip**.
 - Not sure? Click the Apple menu () → **About This Mac**. Look for "Apple M" (Apple Silicon) or "Intel" in the chip/processor line.
2. Open the downloaded `.dmg` file and drag Docker to your Applications folder.
3. Open Docker from your Applications folder. You will be asked to allow the installation of a helper component - enter your password when prompted.
4. Docker is ready when you see the whale icon in your menu bar.

### Linux

The exact steps vary by distribution. The official Docker documentation covers all major distros:

1. Visit [https://docs.docker.com/engine/install/](https://docs.docker.com/engine/install/) and select your Linux distribution from the left sidebar.
2. Follow the installation steps for your distro. Most users will use the **apt** or **dnf** package manager method.
3. After installing, run the post-installation step to use Docker without `sudo`:
   ```bash
   sudo usermod -aG docker $USER
   ```
   Then log out and back in for the change to take effect.
4. Verify Docker is working by opening a terminal and running:
   ```bash
   docker run hello-world
   ```
   You should see a message that says "Hello from Docker!"

---

## Step 2 - Create Your Folders

Create two folders somewhere on your computer:

- One for your **library** (PDFs, maps, tokens) - for example `Documents/grimoire/library`
- One for **app data** (database, thumbnails, search index) - for example `Documents/grimoire/data`

Inside `library`, create three subfolders:

```
library/
├── books/
├── maps/
└── tokens/
```

Inside `books/`, create a subfolder for each game system you own, then place your PDFs inside. For example:

```
library/
└── books/
    └── Dungeons and Dragons 5e/
        └── core/
            ├── Players Handbook.pdf
            └── Dungeon Masters Guide.pdf
```

See the main [Library structure](library-structure.md) for the full folder layout, but you can also just drop PDFs in and tidy up later.

---

## Step 3 - Create the Compose File

Create a new file called `docker-compose.yml` in your Grimoire folder (e.g. `Documents/grimoire/docker-compose.yml`) and paste in the contents below.

Then update the two lines marked with `YOUR` to point to the folders you created in Step 2. Path format differs by OS - see the examples beneath the file.

```yaml
services:
  grimoire:
    image: hunterreadca/grimoire:latest
    container_name: grimoire
    restart: unless-stopped
    ports:
 - "9481:9481"
    environment:
 - LIBRARY_PATH=/library
 - DATA_PATH=/data
 - WORKERS=1
 - VALKEY_URL=redis://valkey:6379/0
    volumes:
 - /YOUR/LIBRARY/FOLDER:/library:ro
 - /YOUR/GRIMOIRE/DATA/FOLDER:/data
    depends_on:
 - valkey

  valkey:
    image: valkey/valkey:8-alpine
    container_name: grimoire-valkey
    restart: unless-stopped
    volumes:
 - valkey-data:/data

volumes:
  valkey-data:
```

### Volume path format by OS

Volume paths are written as `your-folder-path:/library:ro` - the part before the `:` is the path on your computer.

**Windows**

Use forward slashes and include the drive letter:

```yaml
volumes:
 - C:/Users/YourName/Documents/grimoire/library:/library:ro
 - C:/Users/YourName/Documents/grimoire/data:/data
```

**macOS**

```yaml
volumes:
 - /Users/YourName/Documents/grimoire/library:/library:ro
 - /Users/YourName/Documents/grimoire/data:/data
```

You can also use `~` as a shorthand for your home folder:

```yaml
volumes:
 - ~/Documents/grimoire/library:/library:ro
 - ~/Documents/grimoire/data:/data
```

**Linux**

```yaml
volumes:
 - /home/yourname/grimoire/library:/library:ro
 - /home/yourname/grimoire/data:/data
```

### Secret key

`SECRET_KEY` is the internal password Grimoire uses to sign login sessions. You do
not have to set it - if you leave it out, Grimoire generates a random one the first
time it starts and saves it in your data folder, so you stay logged in across
restarts.

If you would rather set it yourself, generate a random value of at least 32 characters,
for example with `openssl rand -hex 32` or a password generator, and paste it in:

```yaml
- SECRET_KEY=<paste the generated value here>
```

Never copy a value from documentation or a forum post, and do not use a placeholder
like `change-me`. A known signing key would let anyone sign in as any user on your
instance, so Grimoire refuses to start on values that have appeared in its own docs.
See [the FAQ](faq.md#grimoire-wont-start-and-the-log-mentions-secret_key) if you hit
that error.

Save the file when you are done.

---

## Step 4 - Run Grimoire

### Windows

1. Open **Command Prompt** or **PowerShell** (`Win + R`, type `cmd` or `powershell`, press Enter).
2. Navigate to your Grimoire folder:
   ```
   cd C:\Users\YourName\Documents\grimoire
   ```
3. Start the app:
   ```
   docker compose up -d
   ```

### macOS

1. Open **Terminal** (search for it in Spotlight with `Cmd + Space`).
2. Navigate to your Grimoire folder:
   ```bash
   cd ~/Documents/grimoire
   ```
3. Start the app:
   ```bash
   docker compose up -d
   ```

### Linux

1. Open a terminal.
2. Navigate to your Grimoire folder:
   ```bash
   cd ~/grimoire
   ```
3. Start the app:
   ```bash
   docker compose up -d
   ```

---

## Step 5 - Open Grimoire

Once the command finishes, open your web browser and go to:

```
http://localhost:9481
```

The first time you visit, you will be prompted to create an admin account. Pick a username and password - this is your login for the app.

Grimoire will start indexing your library in the background. For large collections this can take several minutes. You can already browse the app while it works.

---

## Stopping and Starting Grimoire

**To stop Grimoire** (it will not delete any data):

Open a terminal in your Grimoire folder and run:
```bash
docker compose down
```

**To start it again later:**
```bash
docker compose up -d
```

Docker Desktop must be running before you can start the app. On Windows and macOS, launch Docker Desktop from the Start menu or Applications folder first.

---

## Updating Grimoire

To pull the latest version:

```bash
docker compose pull
docker compose up -d
```

Your library and all your data (bookmarks, metadata, accounts) are stored in a separate volume and will not be affected by updates.

---

## Which user Grimoire runs as

You don't need to set anything here - this is for people who want to know, or to choose.

Grimoire does not run as root. The container starts as root just long enough to get your
data folder ready, then switches to an ordinary user before Grimoire starts. That way, if a
bad PDF or a third-party add-on ever found a hole in Grimoire, it would not have root
access to your files.

By default it runs as **whoever owns your library folder**, so files Grimoire creates there
(uploads, exported sidecars) belong to you, just like the rest of your library. If your
library folder belongs to root, it uses the owner of your data folder instead, and if that
belongs to root too, it uses the built-in `grimoire` user (uid and gid `1000`).

On each start it also makes sure everything in your data folder (and a `BACKUP_DIR` set in
the container's environment) belongs to that user. After updating from a version that ran as
root, the first start hands the old root-owned files over, which can take a moment with a
large thumbnail cache. Your library is never changed. A backup folder chosen in Settings
rather than with `BACKUP_DIR` is left as it is; if that user can't write to it, the log says
so, and you can give it access on the host or set `BACKUP_DIR` instead.

Your setup keeps working as it did, whatever it is. If the chosen user could not read your
library, could not write to a library that root could write to (one mounted without `:ro`),
or could not write to your data folder (for example a network share that refuses to change
file owners), Grimoire stays root and says so in the log (`docker compose logs grimoire`),
along with how to fix it. Symlinks, `lost+found`, and entries that user owns itself at the
top of the library don't count towards that check.

### Choosing the user: `PUID` and `PGID`

To pick the user yourself, set `PUID` and `PGID`. This is the same convention Unraid and
LinuxServer images use. Find your own ids with `id -u` and `id -g` on Linux:

```yaml
    environment:
      - PUID=1000
      - PGID=1000
```

Unraid's usual owner is `PUID=99` and `PGID=100`. When you set these, Grimoire always
uses them, even if that user can't reach everything, so check the log after a change.
`PUID=0` keeps Grimoire running as root.

### Running as a fixed user: `--user`

You can also start the container as an unprivileged user from the start, with `user:` in
compose, `docker run --user`, or `runAsUser` in Kubernetes. Grimoire then skips all of the
above and runs as that user. Nothing can change file owners in this mode, so your data
folder must already be writable by that user. On an install that used to run as root, fix
it once on the host first:

```bash
sudo chown -R 1000:1000 /path/to/grimoire/data
```

```yaml
services:
  grimoire:
    image: hunterreadca/grimoire:latest
    user: "1000:1000"
```

In Kubernetes, set `runAsUser: 1000`, `runAsGroup: 1000` and `fsGroup: 1000` in the pod's
`securityContext`, which also satisfies `runAsNonRoot: true`.

### Rootless Podman and Docker

Under rootless Podman (including Quadlets) or rootless Docker, "root" inside the container
is already your own unprivileged account on the host, so Grimoire stays as it. Files it
creates belong to you, as before. Setting `PUID`/`PGID` still switches to that user inside
the container. Podman's `--userns=keep-id` runs the container as your own uid, which works
the same as `--user`.

---

## Troubleshooting

**The page won't load at `localhost:9481`**
- Make sure Docker Desktop is running (check for the whale icon in your taskbar/menu bar).
- Run `docker compose up -d` again from your Grimoire folder and wait a few seconds before refreshing.
- Check whether the container reports itself healthy with `docker ps` - the `STATUS` column shows `(healthy)` once Grimoire is serving. If it stays `(unhealthy)`, run `docker compose logs grimoire` to see why.

**I see an error about the port being in use**
- Something else on your computer is using port 9481. In `docker-compose.yml`, change `"9481:9481"` to `"9482:9481"` (or any other unused port) and then access the app at `http://localhost:9482`.

**My PDFs are not showing up**
- Double-check the library path in `docker-compose.yml` - make sure it points to the right folder and uses the correct path format for your OS.
- After adding new files, use the **Rescan** button in the Grimoire sidebar to pick them up.

**Windows: Docker says WSL 2 is not installed**
- Open PowerShell as Administrator and run `wsl --install`, then restart your computer and try again.
