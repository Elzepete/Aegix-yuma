# Imágenes de aegix y de la consola. Se usan desde docker-compose.yml (targets «aegix» y «consola»).

FROM golang:1.22-alpine AS aegix-build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/intermediario ./cmd/intermediario

FROM alpine:3.20 AS aegix
# Usuario sin privilegios; datos/ le pertenece para que el volumen guarde la auditoría y su clave.
RUN adduser -D -u 10001 aegix && mkdir -p /app/datos && chown aegix /app/datos
WORKDIR /app
COPY --from=aegix-build /out/intermediario /usr/local/bin/intermediario
COPY config ./config
USER aegix
ENTRYPOINT ["intermediario", "-auditoria", "datos/decisiones.jsonl"]

# glibc para compilar: las dependencias nativas de Vite y Tailwind.
FROM node:20-slim AS consola-build
WORKDIR /src
COPY panel-etapa5/package.json panel-etapa5/package-lock.json ./
RUN npm ci
COPY panel-etapa5/ ./
RUN npm run build

# En ejecución el servidor solo usa módulos de Node: no hace falta node_modules.
FROM node:20-alpine AS consola
WORKDIR /app
COPY --from=consola-build /src/dist ./dist
COPY panel-etapa5/package.json panel-etapa5/proxy.mjs panel-etapa5/transacciones-prueba.mjs ./
USER node
ENV YUMA_PANEL_HOST=0.0.0.0
CMD ["node", "proxy.mjs"]
