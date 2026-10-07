# Туннель с hub до сервиса «Референса» на sandbox (план 120): шлюз платформы
# стоит на hub, а сервис с базой, картинками и моделями — на sandbox, где
# хватает памяти (разведка US-0880). Образ — только ssh-клиент.
FROM alpine:3.20.3
RUN apk add --no-cache openssh-client
COPY tunnel.sh /tunnel.sh
ENTRYPOINT ["sh", "/tunnel.sh"]
