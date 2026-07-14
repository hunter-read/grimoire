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

See the main [README](../README.md#library-structure) for the full folder layout, but you can also just drop PDFs in and tidy up later.

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
 - WORKERS=2
 - SECRET_KEY=replace-this-with-a-long-random-string
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

Also replace the `SECRET_KEY` value with any long, random string - think of it as an internal password for the app. You can mash your keyboard or use a password generator:

```yaml
- SECRET_KEY=zx7k2mQpR9nLwT4vBcYeHs3JuAoDfGiN
```

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
