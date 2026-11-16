# Installing HallFlix on a UGREEN NAS

No terminal needed. HallFlix runs beside Jellyfin and does not touch it or your media files.

## 1. Make a folder for HallFlix

In **Files**, inside your `docker` shared folder, create `hallflix`, and inside it two folders: `data` and `db`.

## 2. Create the project

1. Open the **Docker** app, go to **Project**, and press **Create**.
2. Name it `hallflix` and pick the `docker/hallflix` folder as its location.
3. Paste in the contents of [`docker-compose.yml`](docker-compose.yml).
4. Change the two lines marked `<-- CHANGE` so the left side is the shared folder that holds your movies and shows
   (for example `/volume1/Media`). If your `docker` folder is not on `volume1`, fix those paths too.
5. Press **Deploy**. The first start downloads about 600 MB.

## 3. Set it up

1. Open `http://<your NAS address>:8780` in a browser.
2. Create your admin profile and paste your TMDb key. The key is saved in HallFlix's database, nowhere else.
3. You land in the Studio. Under **Libraries**, press **Add a library**, pick **Movies** and browse to your movies folder.
   Do the same for **Shows**, and for a folder of **Pre-roll clips** if you have one.
4. The first scan starts by itself. Posters appear as titles are matched.

Folder naming that matches best: `Movies/Title (Year)/Title (Year).mkv` and `Shows/Show Name (Year)/Season 01/Show S01E01.mkv`.

## 4. Check the graphics chip

In the Studio, **Overview → Video converter** should say it is using the graphics chip. If it says "Using the processor",
HallFlix still plays everything, but converting 4K files will be slow. Most files play directly and never need converting.

## 5. Point hallflix.net at it (when you are ready)

In Cloudflare Zero Trust, change the tunnel's public hostname for `hallflix.net` from Jellyfin's port to `http://<NAS address>:8780`.
To go back, change it back. Nothing else needs undoing.

## Updating

In the Docker app, open the `hallflix` project and press **Redeploy** (pull the newest image). Your database and settings are kept.

## If something goes wrong

- **Deploy fails with "denied" or "unauthorized" while downloading the image:** the image is still private on GitHub. Open the repo on GitHub, click **Packages → hallflix-site → Package settings**, and under **Danger Zone** change the visibility to **Public**. Then deploy again.

- **Page does not open:** in the Docker app, check all three containers are running, and open the `hallflix` container's log.
- **"Folder not found" when adding a library:** the media path in the compose file does not match your share. Fix it and redeploy.
- **Deploy fails mentioning `/dev/dri`:** delete the two `devices:` lines from the compose file and redeploy (software conversion only).
