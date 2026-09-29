# Local development

The local Docker Compose setup starts PostgreSQL 18 and the Node.js application together. Docker Compose is the only prerequisite; no host PostgreSQL installation or `.env` file is needed.

```bash
docker compose -f docker-compose.local.yml up --build -d
docker compose -f docker-compose.local.yml ps
```

Open <http://localhost:3002/> for the world or <http://localhost:3002/admin.html> for the admin page. `GET /api/ready` returns HTTP 200 only when the application can reach a database with the core world tables. `GET /api/health` checks only that the HTTP process is running.

The database is initialized from `db_export.sql` on the **first** start of the PostgreSQL volume. This is a snapshot with sample data. Rebuilding the image does not reimport the dump or erase later changes. Local JWT and configuration encryption keys are generated once and kept in a separate Docker volume. Uploaded and generated assets also live in Docker volumes.

If the `virtual_world_local_state` volume was created by an earlier image and the app log shows `EACCES` for `/app/.local-state/secrets.json`, repair its ownership once without removing the volume:

```bash
docker compose -f docker-compose.local.yml run --rm --no-deps --user root --entrypoint sh app -c 'chown -R node:node /app/.local-state'
docker compose -f docker-compose.local.yml up --build -d
```

For logs and shutdown:

```bash
docker compose -f docker-compose.local.yml logs -f app
docker compose -f docker-compose.local.yml down
```

To inspect the local database without publishing its port:

```bash
docker compose -f docker-compose.local.yml exec postgres psql -U postgres -d virtual_world
```

`down` keeps all volumes. Do not use `down -v` if the local database or uploaded assets matter. After editing server or browser code, run `docker compose -f docker-compose.local.yml up --build -d` again to rebuild the application image.

This setup binds the web port to `127.0.0.1:3002`; PostgreSQL is available only to the application inside the Compose network. AI provider credentials and external federation are optional and disabled or absent by default. `npm start` remains available for a host installation with a separately configured PostgreSQL database; `npm run dev` starts Vite alone and does not replace the Express server.
