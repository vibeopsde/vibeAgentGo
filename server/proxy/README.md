# vibeAgentGo Generic CORS Proxy

Dieser FastAPI-Service ist der Ziel-Server für den Caddy-Pfad `/api/proxy/`.

## Caddy-Konfiguration

Ersetze den alten `handle_path /api/proxy/*` Block durch:

```
handle /api/proxy* {
    reverse_proxy localhost:8002 {
        header_down Access-Control-Allow-Origin "https://vag.vibeops.de"
        header_down Access-Control-Allow-Methods "GET, POST, OPTIONS"
        header_down Access-Control-Allow-Headers "Content-Type, Authorization"
    }
}
```

Wichtig: `handle` statt `handle_path` verwenden, damit `/api/proxy/` an den FastAPI-Service weitergeleitet wird.

## Service

```bash
cp server/vag-proxy.service /etc/systemd/system/vag-proxy.service
systemctl daemon-reload
systemctl enable vag-proxy
systemctl start vag-proxy
```

## Test

```bash
curl "https://vag.vibeops.de/api/proxy/?url=https://www.tagesschau.de/xml/rss2/"
```
