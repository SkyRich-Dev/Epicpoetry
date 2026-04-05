# EC2 Deployment

This repo deploys cleanly to a single Ubuntu EC2 instance with:

- `nginx` serving the frontend from `artifacts/epic-poetry-cafe/dist/public`
- `pm2` running the API from `artifacts/api-server/dist/index.mjs`
- PostgreSQL provided through `DATABASE_URL`

## 1. Assumptions

- OS: Ubuntu 22.04 or 24.04
- App path: `/var/www/epicpoetry`
- Public HTTP port: `80`
- API private port: `3100`
- Frontend base path: `/`

## 2. Install Packages

```bash
sudo apt update
sudo apt install -y nginx git curl
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Verify:

```bash
node -v
npm -v
pm2 -v
nginx -v
```

## 3. Clone Repo

```bash
sudo mkdir -p /var/www
cd /var/www
sudo git clone https://github.com/SkyRich-Dev/Epicpoetry.git epicpoetry
sudo chown -R $USER:$USER /var/www/epicpoetry
cd /var/www/epicpoetry
```

## 4. Production `.env`

Create `/var/www/epicpoetry/.env`:

```env
NODE_ENV=production
BASE_PATH=/
WEB_PORT=4174
API_PORT=3100
VITE_API_BASE_URL=/api
SESSION_SECRET=replace-with-a-long-random-secret
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
```

Notes:

- `VITE_API_BASE_URL=/api` is recommended when frontend and API are behind the same Nginx host.
- Use a real random `SESSION_SECRET`.
- If PostgreSQL is on another server or RDS, allow inbound traffic from this EC2 instance.

## 5. Install Dependencies

```bash
cd /var/www/epicpoetry
npm install
```

## 6. Push Database Schema

This project uses Drizzle `push` rather than migrations:

```bash
cd /var/www/epicpoetry
npm run db:push
```

## 7. Build for Production

```bash
cd /var/www/epicpoetry
npm run build --workspace @workspace/api-server
npm run build --workspace @workspace/epic-poetry-cafe
```

Important:

- The current branch still has TypeScript typecheck failures, so do not use root `npm run build` yet.
- The workspace build commands above do complete successfully and produce deployable artifacts.

## 8. Start API with PM2

```bash
sudo mkdir -p /var/log/epicpoetry
cd /var/www/epicpoetry
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup systemd -u $USER --hp $HOME
```

Check status:

```bash
pm2 status
pm2 logs epicpoetry-api
curl http://127.0.0.1:3100/api/healthz
```

## 9. Configure Nginx

Copy the included config:

```bash
sudo cp /var/www/epicpoetry/deploy/nginx-epicpoetry.conf /etc/nginx/sites-available/epicpoetry
sudo ln -sf /etc/nginx/sites-available/epicpoetry /etc/nginx/sites-enabled/epicpoetry
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

## 10. Security Group

Allow inbound:

- `22` from your IP
- `80` from the internet
- `443` from the internet if you add SSL

You do not need to expose `3100` publicly if Nginx proxies to it locally.

## 11. Optional SSL with Certbot

If your domain points to the EC2 public IP:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

## 12. Deploy Updates

```bash
cd /var/www/epicpoetry
git pull
npm install
npm run db:push
npm run build --workspace @workspace/api-server
npm run build --workspace @workspace/epic-poetry-cafe
pm2 restart epicpoetry-api
sudo systemctl reload nginx
```

## 13. Rollback

If the latest pull breaks runtime:

```bash
cd /var/www/epicpoetry
git log --oneline -n 5
git checkout <previous-good-commit>
npm install
npm run build --workspace @workspace/api-server
npm run build --workspace @workspace/epic-poetry-cafe
pm2 restart epicpoetry-api
```

## 14. Runtime Checks

```bash
curl http://127.0.0.1:3100/api/healthz
curl http://your-ec2-public-ip/
pm2 logs epicpoetry-api --lines 100
sudo tail -n 100 /var/log/nginx/error.log
```

## 15. Known Current Risk

The latest pulled code still has typecheck regressions. Production builds succeed, but we should still clean those up after deployment so future CI and root builds are reliable.
